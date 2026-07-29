import axios from "axios";
import { TimerUserSession } from "../types";
import { TWITCH_SUBS_POLL_TIME, TWITCH_SUBS_FAIL_BACKOFF_MS, TWITCH_SUBS_ALERT_AFTER, FW_HTTP_TIMEOUT } from "../config";
import { emitSync } from "../bus";
import { whSend } from "../notify";
import { diag } from "../diag";

// live ACTIVE subscriber count + sub points for the /subcount browser sources. unlike the all-time tallies
// (subCountTwitch etc.), which only ever count up from chat/sub events, this is a snapshot of who is
// subscribed right now — so it falls on its own as subs lapse, cancel or fail to renew.
//
// helix/subscriptions reports total + points in one call, but only to the BROADCASTER's own user token
// carrying channel:read:subscriptions. app tokens and moderator tokens are both refused, and twitch has no
// pasteable api key for it, so the streamer authorizes once and we keep the refresh token. refresh tokens
// for a confidential client don't expire on their own, which is what makes this survive a weeks-long
// subathon unattended.
//
// authorization uses the DEVICE CODE flow, not the redirect/callback one: twitch requires https on oauth
// redirect urls, and this app is served over plain http on a lan address, so a callback can't be registered
// at all. the device flow needs no redirect url — twitch hands us a short code, the streamer types it in on
// any device, and we poll until they've approved.
const HELIX = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";
export const TWITCH_SUBS_SCOPE = "channel:read:subscriptions";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export function normalizeTwitchSubs(raw: any): { clientId: string, clientSecret: string, refreshToken: string, broadcasterId: string } {
    const t = raw || {};
    const str = (v: any, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    return {
        clientId: str(t.clientId, 100),
        clientSecret: str(t.clientSecret, 200),
        refreshToken: str(t.refreshToken, 500),
        broadcasterId: str(t.broadcasterId, 50),
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

// step one of the device flow: ask twitch for a short code. nothing is granted yet — the streamer has to go
// type this code in. note the parameter is "scopes" here, plural, unlike everywhere else in twitch's oauth.
export async function startTwitchSubsDeviceAuth(session: TimerUserSession){
    const t = (session.connections && session.connections.twitchSubs) || {};
    if (!t.clientId)
        throw new Error("Save the Client ID first.");
    const res = await axios.post(`${OAUTH}/device`, new URLSearchParams({
        client_id: t.clientId,
        scopes: TWITCH_SUBS_SCOPE,
    }).toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: FW_HTTP_TIMEOUT,
    });
    const d = res.data || {};
    const deviceCode = typeof d.device_code === "string" ? d.device_code : "";
    const userCode = typeof d.user_code === "string" ? d.user_code : "";
    if (!deviceCode || !userCode)
        throw new Error("Twitch didn't return a device code.");
    const expiresIn = Math.max(60, Math.trunc(Number(d.expires_in) || 1800));
    // twitch tells us how often it's willing to be asked; honour it rather than picking our own rate
    const interval = Math.max(1, Math.trunc(Number(d.interval) || 5));
    session.twitchSubsPending = {
        deviceCode,
        userCode,
        verificationUri: typeof d.verification_uri === "string" && d.verification_uri
            ? d.verification_uri
            : "https://www.twitch.tv/activate",
        expiresAt: Date.now() + expiresIn * 1000,
        interval,
    };
    return session.twitchSubsPending;
}

// step two: poll until the streamer approves. "authorization_pending" is the normal answer the whole time
// they're still typing, so it must not read as a failure. resolves true once tokens are stored.
export async function pollTwitchSubsDeviceAuth(session: TimerUserSession): Promise<boolean> {
    const p = session.twitchSubsPending;
    const t = (session.connections && session.connections.twitchSubs) || {};
    if (!p || !t.clientId)
        return false;
    if (Date.now() > p.expiresAt){
        session.twitchSubsPending = undefined;
        throw new Error("That code expired before it was entered. Start again.");
    }
    const body: any = {
        client_id: t.clientId,
        device_code: p.deviceCode,
        grant_type: DEVICE_GRANT,
        scopes: TWITCH_SUBS_SCOPE,
    };
    // sending the secret keeps this a confidential client, whose refresh tokens are reusable — a public
    // client's are single-use, so one missed write would strand us with a dead token
    if (t.clientSecret)
        body.client_secret = t.clientSecret;
    let res;
    try {
        res = await axios.post(`${OAUTH}/token`, new URLSearchParams(body).toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: FW_HTTP_TIMEOUT,
        });
    } catch (err: any) {
        const d = (err && err.response && err.response.data) || {};
        const msg = String(d.message || d.error || "");
        if (/authorization_pending|slow_down/i.test(msg))
            return false; // still waiting on the streamer; keep polling
        session.twitchSubsPending = undefined;
        throw err;
    }
    const refreshToken = res.data && res.data.refresh_token;
    const accessToken = res.data && res.data.access_token;
    if (typeof refreshToken !== "string" || !refreshToken){
        session.twitchSubsPending = undefined;
        throw new Error("Twitch didn't return a refresh token.");
    }
    // validate tells us who the token belongs to and which scopes it really carries, so a missing scope is
    // caught here rather than surfacing as a confusing 401 on the first poll
    const v = await axios.get(`${OAUTH}/validate`, {
        headers: { Authorization: `OAuth ${accessToken}` },
        timeout: FW_HTTP_TIMEOUT,
    });
    const scopes: string[] = (v.data && v.data.scopes) || [];
    session.twitchSubsPending = undefined;
    if (!scopes.includes(TWITCH_SUBS_SCOPE))
        throw new Error(`That authorization is missing the ${TWITCH_SUBS_SCOPE} scope.`);
    const broadcasterId = String((v.data && v.data.user_id) || "");
    if (!broadcasterId)
        throw new Error("Twitch didn't say which channel that authorization is for.");
    session.connections.twitchSubs = normalizeTwitchSubs({ ...t, refreshToken, broadcasterId });
    session.twitchSubsLogin = String((v.data && v.data.login) || "");
    return true;
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

// drives the wait for the streamer to type the code in. lives on the session (not a socket) so closing or
// reloading the dashboard mid-authorization doesn't abandon it, and the pending code is re-shown on sync.
// onDone runs once the tokens are stored, so the caller can start the subs poller.
export function runTwitchSubsDeviceAuth(session: TimerUserSession, onDone: () => void){
    const pending = session.twitchSubsPending;
    if (!pending)
        return;
    const tick = async () => {
        // a second authorization started, or something cleared it — stop rather than race the newer one
        if (!session.twitchSubsPending || session.twitchSubsPending.deviceCode !== pending.deviceCode){
            clearInterval(timer);
            return;
        }
        try {
            const done = await pollTwitchSubsDeviceAuth(session);
            if (!done)
                return;
            clearInterval(timer);
            session.twitchSubsError = "";
            emitSync(session.userId);
            onDone();
        } catch (err: any) {
            clearInterval(timer);
            session.twitchSubsPending = undefined;
            session.twitchSubsError = err && err.response ? describeError(err) : (err && err.message) || "Authorization failed.";
            emitSync(session.userId);
        }
    };
    const timer = setInterval(tick, pending.interval * 1000);
}

export function connectTwitchSubs(session: TimerUserSession){
    // label logs by the watched channel, not the operator account that logged in
    const watching = session.connections.twitch.channel || session.name;
    let timer: NodeJS.Timeout | number = 0;
    let polling = false;   // in-flight guard: a slow cycle must not let the interval stack overlapping polls
    let token = "";        // current access token, refreshed on demand
    let stopped = false;
    let failures = 0;      // consecutive failures, driving the backoff below
    let nextAttemptAt = 0; // while backing off, ticks before this are skipped
    let alerted = false;   // so a long outage pings once, not every retry

    const backoffFor = (n: number) =>
        TWITCH_SUBS_FAIL_BACKOFF_MS[Math.min(n - 1, TWITCH_SUBS_FAIL_BACKOFF_MS.length - 1)];

    async function poll(){
        if (polling || stopped)
            return;
        if (Date.now() < nextAttemptAt) // backing off after a failure; the interval keeps ticking regardless
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
            // emitSync broadcasts the whole settings payload to every socket this user has open — dashboard,
            // timer, each counter source, the alert and activity pages. at this cadence that's worth doing only
            // when the numbers actually moved; the per-socket 5s force sync covers general freshness, and these
            // counts change a handful of times an hour, not every poll.
            const changed = session.subsActive !== counts.total
                || session.subsPoints !== counts.points
                || !session.twitchSubsStatus; // also catches the first read and recovery from an outage
            session.subsActive = counts.total;
            session.subsPoints = counts.points;
            session.twitchSubsError = "";
            session.twitchSubsLastOkAt = Date.now();
            failures = 0;
            nextAttemptAt = 0;
            if (!session.twitchSubsStatus){
                session.twitchSubsStatus = true;
                console.log(`Reading ${watching}'s active subs from Twitch!`);
            }
            if (alerted){ // only worth announcing a recovery if we announced the outage
                alerted = false;
                whSend(`**Twitch active subs recovered** for ${watching}.`);
            }
            if (changed)
                emitSync(session.userId);
        } catch (err: any) {
            session.twitchSubsStatus = false;
            session.twitchSubsError = describeError(err);
            token = ""; // force a refresh next cycle; a stale token is the likeliest cause
            failures++;
            const wait = backoffFor(failures);
            nextAttemptAt = Date.now() + wait;
            const r = err && err.response;
            diag(`TWITCHSUBS ${watching}: poll failed (${failures} in a row, next try in ${Math.round(wait / 1000)}s): ${r ? `${r.status} ${JSON.stringify(r.data)}` : (err && err.message)}`);
            // a months-long marathon can't rely on someone watching the dashboard, so say something once the
            // failures look real rather than like a blip
            if (!alerted && failures >= TWITCH_SUBS_ALERT_AFTER){
                alerted = true;
                whSend(`**Twitch active subs stopped working** for ${watching}: ${session.twitchSubsError} Retrying every ${Math.round(wait / 60000)}m. The browser sources are showing a dash until it's fixed.`);
            }
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
