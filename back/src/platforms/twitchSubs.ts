import axios from "axios";
import { TimerUserSession } from "../types";
import { TWITCH_SUBS_POLL_TIME, FW_HTTP_TIMEOUT } from "../config";
import { emitSync } from "../bus";
import { diag } from "../diag";

// live ACTIVE subscriber count + sub points for the /subcount browser sources. unlike the all-time tallies
// (subCountTwitch etc.), which only ever count up from chat/sub events, this is a snapshot of who is
// subscribed right now — so it falls on its own as subs lapse, cancel or fail to renew.
//
// helix/subscriptions reports total + points in one call, but only to the BROADCASTER's own user token
// carrying channel:read:subscriptions. app tokens and moderator tokens are both refused, and twitch has no
// pasteable api key for it, so the streamer authorizes once against their own twitch app and we keep the
// refresh token. refresh tokens for a confidential client don't expire on their own, which is what makes
// this survive a weeks-long subathon unattended.
const HELIX = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";
export const TWITCH_SUBS_SCOPE = "channel:read:subscriptions";

export function normalizeTwitchSubs(raw: any): { clientId: string, clientSecret: string, refreshToken: string, broadcasterId: string, redirectUri: string } {
    const t = raw || {};
    const str = (v: any, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    return {
        clientId: str(t.clientId, 100),
        clientSecret: str(t.clientSecret, 200),
        refreshToken: str(t.refreshToken, 500),
        broadcasterId: str(t.broadcasterId, 50),
        // twitch compares this byte-for-byte against the app registration AND requires the same value again at
        // code exchange, so it's stored once rather than re-derived on each side (the operator may authorize
        // from a different origin than the page that handles the redirect)
        redirectUri: str(t.redirectUri, 500),
    };
}

// is this session set up far enough to poll? (credentials pasted AND the one-time authorize done)
export function twitchSubsReady(session: TimerUserSession): boolean {
    const t = (session.connections && session.connections.twitchSubs) || {};
    return !!(t.clientId && t.clientSecret && t.refreshToken);
}

// turn a twitch oauth/helix failure into a short human message for the connections ui
export function describeError(err: any): string {
    const r = err && err.response;
    if (!r)
        return err && err.code === "ECONNABORTED"
            ? "Timed out reaching Twitch."
            : `Couldn't reach Twitch (${(err && err.message) || "network error"}).`;
    const body = r.data || {};
    const msg = body.message || body.error_description || body.error || "";
    if (r.status === 401)
        return `Twitch rejected the authorization (401${msg ? ` — ${msg}` : ""}). Re-authorize below.`;
    if (r.status === 403)
        return `Twitch refused the request (403${msg ? ` — ${msg}` : ""}). The token must belong to the broadcaster and carry ${TWITCH_SUBS_SCOPE}.`;
    if (r.status === 400)
        return `Twitch rejected the request (400${msg ? ` — ${msg}` : ""}). Check the Client ID and Secret.`;
    return `Twitch returned ${r.status}${msg ? ` — ${msg}` : ""}.`;
}

// the url the streamer visits once to grant access. state carries nothing secret — the code it comes back
// with is useless without the client secret, which never leaves the server.
export function twitchSubsAuthUrl(clientId: string, redirectUri: string): string {
    const p = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: TWITCH_SUBS_SCOPE,
        // always re-prompt: otherwise a streamer who already approved gets bounced straight back and can't
        // tell whether anything happened
        force_verify: "true",
    });
    return `${OAUTH}/authorize?${p.toString()}`;
}

// one-time: swap the authorize code for a refresh token and remember whose channel it is. throws with a
// human message on anything unexpected so the ui can show it.
export async function exchangeTwitchSubsCode(session: TimerUserSession, code: string){
    const t = (session.connections && session.connections.twitchSubs) || {};
    if (!t.clientId || !t.clientSecret)
        throw new Error("Save the Client ID and Secret first.");
    // the exact string the authorize link was built with — reusing it is what makes the exchange match
    const redirectUri = t.redirectUri;
    if (!redirectUri)
        throw new Error("No redirect URL stored — start the authorization from the Connections tab.");
    const res = await axios.post(`${OAUTH}/token`, new URLSearchParams({
        client_id: t.clientId,
        client_secret: t.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
    }).toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: FW_HTTP_TIMEOUT,
    });
    const refreshToken = res.data && res.data.refresh_token;
    const accessToken = res.data && res.data.access_token;
    if (typeof refreshToken !== "string" || !refreshToken)
        throw new Error("Twitch didn't return a refresh token.");
    // validate tells us who the token belongs to and which scopes it really carries, so a missing scope is
    // caught here rather than surfacing as a confusing 401 on the first poll
    const v = await axios.get(`${OAUTH}/validate`, {
        headers: { Authorization: `OAuth ${accessToken}` },
        timeout: FW_HTTP_TIMEOUT,
    });
    const scopes: string[] = (v.data && v.data.scopes) || [];
    if (!scopes.includes(TWITCH_SUBS_SCOPE))
        throw new Error(`That authorization is missing the ${TWITCH_SUBS_SCOPE} scope.`);
    const broadcasterId = String((v.data && v.data.user_id) || "");
    if (!broadcasterId)
        throw new Error("Twitch didn't say which channel that authorization is for.");
    session.connections.twitchSubs = normalizeTwitchSubs({ ...t, refreshToken, broadcasterId });
    return { login: String((v.data && v.data.login) || "") };
}

// mint a fresh access token from the stored refresh token. kept in memory only — there's no point
// persisting something that dies in a few hours.
async function freshAccessToken(session: TimerUserSession): Promise<string> {
    const t = session.connections.twitchSubs;
    const res = await axios.post(`${OAUTH}/token`, new URLSearchParams({
        client_id: t.clientId,
        client_secret: t.clientSecret,
        grant_type: "refresh_token",
        refresh_token: t.refreshToken,
    }).toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: FW_HTTP_TIMEOUT,
    });
    const token = res.data && res.data.access_token;
    if (typeof token !== "string" || !token)
        throw new Error("Twitch didn't return an access token.");
    // twitch may hand back a rotated refresh token; persist it or the next refresh fails
    const rotated = res.data && res.data.refresh_token;
    if (typeof rotated === "string" && rotated && rotated !== t.refreshToken)
        session.connections.twitchSubs = normalizeTwitchSubs({ ...t, refreshToken: rotated });
    return token;
}

// first=1 keeps the page tiny — total and points are top-level on the response, so we never page the
// subscriber list itself
export async function fetchActiveSubs(session: TimerUserSession, accessToken: string): Promise<{ total: number, points: number }> {
    const t = session.connections.twitchSubs;
    const res = await axios.get(`${HELIX}/subscriptions`, {
        headers: { Authorization: `Bearer ${accessToken}`, "Client-Id": t.clientId },
        params: { broadcaster_id: t.broadcasterId, first: 1 },
        timeout: FW_HTTP_TIMEOUT,
        paramsSerializer: (p: any) => new URLSearchParams(p).toString(),
    });
    return {
        // total excludes the broadcaster's own sub, which is what twitch reports via the api
        total: Math.max(0, Math.trunc(Number(res.data && res.data.total) || 0)),
        points: Math.max(0, Math.trunc(Number(res.data && res.data.points) || 0)),
    };
}

export function connectTwitchSubs(session: TimerUserSession){
    // label logs by the watched channel, not the operator account that logged in
    const watching = session.connections.twitch.channel || session.name;
    let timer: NodeJS.Timeout | number = 0;
    let polling = false;   // in-flight guard: a slow cycle must not let the interval stack overlapping polls
    let token = "";        // current access token, refreshed on demand
    let stopped = false;

    async function poll(){
        if (polling || stopped)
            return;
        polling = true;
        try {
            if (!token)
                token = await freshAccessToken(session);
            let counts;
            try {
                counts = await fetchActiveSubs(session, token);
            } catch (err: any) {
                // an expired access token is the normal case, not an error — refresh once and retry before
                // reporting anything to the ui
                if (err && err.response && err.response.status === 401){
                    token = await freshAccessToken(session);
                    counts = await fetchActiveSubs(session, token);
                } else {
                    throw err;
                }
            }
            session.subsActive = counts.total;
            session.subsPoints = counts.points;
            session.twitchSubsError = "";
            session.twitchSubsLastOkAt = Date.now();
            if (!session.twitchSubsStatus){
                session.twitchSubsStatus = true;
                console.log(`Reading ${watching}'s active subs from Twitch!`);
            }
            emitSync(session.userId);
        } catch (err: any) {
            session.twitchSubsStatus = false;
            session.twitchSubsError = describeError(err);
            token = ""; // force a refresh next cycle; a stale token is the likeliest cause
            const r = err && err.response;
            diag(`TWITCHSUBS ${watching}: poll failed: ${r ? `${r.status} ${JSON.stringify(r.data)}` : (err && err.message)}`);
            emitSync(session.userId);
        } finally {
            polling = false;
        }
    }

    poll();
    timer = setInterval(poll, TWITCH_SUBS_POLL_TIME);

    return {
        disconnect(){
            stopped = true;
            if (timer){
                clearInterval(timer);
                timer = 0;
            }
            session.twitchSubsStatus = false;
        }
    };
}
