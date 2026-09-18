import axios from "axios";
import { TimerUserSession } from "../types";
import { FW_HTTP_TIMEOUT } from "../config";
import { emitSync, emitTerminal } from "../bus";

// the bot account: the identity this app SPEAKS and MODERATES as. reading chat needs nobody (tmi connects
// anonymously — see platforms/twitch.ts), but saying something or timing somebody out needs an account, and
// timing out needs that account to be a moderator in the channel.
//
// NOTHING HERE GOES THROUGH IRC. twitch deprecated chat commands over IRC in february 2023 and removed them
// days later, so /timeout down the chat socket is silently ignored now — it has to be helix. and since we're
// calling helix for moderation anyway, messages go the same way (helix/chat/messages) rather than opening a
// second, authenticated irc connection: one credential path, one refresh, and no long-lived socket carrying a
// token that expires under it every few hours.
//
// authorization is the DEVICE CODE flow, same as the sub-count connection and for the same reason: twitch
// requires https on oauth redirect urls and this app is served over plain http, so there is no callback to
// register. twitch hands us a short code, it gets typed in at twitch.tv/activate, and we poll until approved.
//
// THE CODE MUST BE ENTERED WHILE LOGGED INTO TWITCH AS THE BOT. twitch grants the token to whoever is signed
// in, so doing it on the streamer's own login authorizes the wrong account — which is why the login that came
// back is stored and shown on the tab, rather than assumed.

const HELIX = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

// user:write:chat lets it talk; moderator:manage:banned_users is the timeout; moderator:manage:announcements
// is the highlighted /announce line a prize landing is called out with. the last two only WORK if the account
// is also a mod in the channel — the scope is permission to ask, being a mod is permission to be obeyed, and
// twitch checks both.
// a bot authorized before announcements were added here carries a token WITHOUT that scope, and it keeps
// working: botAnnounce falls back to a plain message and says once, on the terminal, to re-authorize.
export const TWITCH_BOT_SCOPES = "user:write:chat moderator:manage:banned_users moderator:manage:announcements";

// per user: twitch has refused an announcement from this token (missing scope, or the bot isn't a mod), so
// don't keep asking — every prize would otherwise cost two refused requests before the plain line goes out.
// cleared by a fresh authorization or a logout.
const announceRefused: { [userId: number]: boolean } = {};

// a user access token lasts about four hours, so it's minted from the refresh token and reused until it
// stops working. kept in memory only: there's no point persisting something with that lifetime.
const tokens: { [userId: number]: { token: string, at: number } } = {};
const TOKEN_TTL = 3 * 3600 * 1000;

// login -> twitch user id. ids are what helix wants and logins are what chat gives us, and the mapping never
// changes for an account, so it's worth not asking twice.
const idCache: { [userId: number]: { [login: string]: string } } = {};

export function normalizeTwitchBot(raw: any): { clientId: string, clientSecret: string, refreshToken: string, botId: string, botLogin: string } {
    const t = raw || {};
    const str = (v: any, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    return {
        // left blank, the sub-count connection's twitch app is used instead — see appFor(). most setups have
        // one twitch app and no reason to make a second.
        clientId: str(t.clientId, 100),
        clientSecret: str(t.clientSecret, 200),
        refreshToken: str(t.refreshToken, 500),
        botId: str(t.botId, 50),
        botLogin: str(t.botLogin, 50),
    };
}

// which twitch application to authorize through: the bot's own, or the one the sub-count connection already
// has. the credentials identify the APP, never the account — the account is whoever types the code in — so
// sharing one between the two connections is normal and saves setting up a second app for nothing.
export function appFor(session: TimerUserSession): { clientId: string, clientSecret: string, shared: boolean } {
    const b = (session.connections && session.connections.twitchBot) || {};
    if (b.clientId)
        return { clientId: b.clientId, clientSecret: b.clientSecret, shared: false };
    const s = (session.connections && session.connections.twitchSubs) || {};
    return { clientId: s.clientId || "", clientSecret: s.clientSecret || "", shared: !!s.clientId };
}

// authorized far enough to actually do something?
export function twitchBotReady(session: TimerUserSession): boolean {
    const b = (session.connections && session.connections.twitchBot) || {};
    return !!(appFor(session).clientId && b.refreshToken && b.botId);
}

export function describeError(err: any): string {
    const res = err && err.response;
    const d = (res && res.data) || {};
    const msg = String(d.message || d.error || (err && err.message) || "");
    if (!res)
        return msg || "Couldn't reach Twitch.";
    if (res.status === 401)
        return `Twitch rejected the bot's authorization (401${msg ? ` — ${msg}` : ""}). Authorize it again.`;
    if (res.status === 403)
        return `Twitch refused it (403${msg ? ` — ${msg}` : ""}). The bot has to be a moderator in the channel — type "/mod ${(d && d.login) || "botname"}" in chat.`;
    if (res.status === 429)
        return "Twitch is rate limiting the bot; it'll catch up.";
    return `Twitch returned ${res.status}${msg ? ` — ${msg}` : ""}.`;
}

// ---------------------------------------------------------------------------
// authorizing
// ---------------------------------------------------------------------------

export async function startTwitchBotDeviceAuth(session: TimerUserSession){
    const app = appFor(session);
    if (!app.clientId)
        throw new Error("No Twitch app to authorize through — paste a Client ID, or set up the Sub Count connection first.");
    const res = await axios.post(`${OAUTH}/device`, new URLSearchParams({
        client_id: app.clientId,
        scopes: TWITCH_BOT_SCOPES, // "scopes", plural, unlike everywhere else in twitch's oauth
    }).toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: FW_HTTP_TIMEOUT,
    });
    const d = res.data || {};
    const deviceCode = typeof d.device_code === "string" ? d.device_code : "";
    const userCode = typeof d.user_code === "string" ? d.user_code : "";
    if (!deviceCode || !userCode)
        throw new Error("Twitch didn't return a device code.");
    session.twitchBotPending = {
        deviceCode,
        userCode,
        verificationUri: typeof d.verification_uri === "string" && d.verification_uri ? d.verification_uri : "https://www.twitch.tv/activate",
        expiresAt: Date.now() + Math.max(60, Math.trunc(Number(d.expires_in) || 1800)) * 1000,
        interval: Math.max(1, Math.trunc(Number(d.interval) || 5)),
    };
    return session.twitchBotPending;
}

export async function pollTwitchBotDeviceAuth(session: TimerUserSession): Promise<boolean> {
    const p = session.twitchBotPending;
    const app = appFor(session);
    if (!p || !app.clientId)
        return false;
    if (Date.now() > p.expiresAt){
        session.twitchBotPending = undefined;
        throw new Error("That code expired before it was entered. Start again.");
    }
    const body: any = {
        client_id: app.clientId,
        device_code: p.deviceCode,
        grant_type: DEVICE_GRANT,
        scopes: TWITCH_BOT_SCOPES,
    };
    // as a confidential client the refresh token is reusable; a public client's is single-use, and one
    // missed write would strand the bot with a dead token mid-stream
    if (app.clientSecret)
        body.client_secret = app.clientSecret;
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
            return false; // still waiting on whoever is typing it in
        session.twitchBotPending = undefined;
        throw err;
    }
    const refreshToken = res.data && res.data.refresh_token;
    const accessToken = res.data && res.data.access_token;
    if (typeof refreshToken !== "string" || !refreshToken){
        session.twitchBotPending = undefined;
        throw new Error("Twitch didn't return a refresh token.");
    }
    // validate says which ACCOUNT this is and which scopes it really carries. both matter here: authorizing
    // while signed in as the streamer instead of the bot is the easiest mistake to make, and it would
    // otherwise only show up as the bot talking under the wrong name.
    const v = await axios.get(`${OAUTH}/validate`, {
        headers: { Authorization: `OAuth ${accessToken}` },
        timeout: FW_HTTP_TIMEOUT,
    });
    const scopes: string[] = (v.data && v.data.scopes) || [];
    session.twitchBotPending = undefined;
    for (const need of TWITCH_BOT_SCOPES.split(" "))
        if (!scopes.includes(need))
            throw new Error(`That authorization is missing the ${need} scope.`);
    const botId = String((v.data && v.data.user_id) || "");
    const botLogin = String((v.data && v.data.login) || "");
    if (!botId)
        throw new Error("Twitch didn't say which account that authorization is for.");
    const b = (session.connections && session.connections.twitchBot) || {};
    session.connections.twitchBot = normalizeTwitchBot({ ...b, refreshToken, botId, botLogin });
    delete tokens[session.userId];
    delete announceRefused[session.userId]; // a new token may well be the one that carries the scope
    return true;
}

// drives the wait for the code to be typed in. lives on the session so closing the dashboard mid-authorize
// doesn't abandon it. mirrors runTwitchSubsDeviceAuth.
export function runTwitchBotDeviceAuth(session: TimerUserSession, onDone: () => void){
    const pending = session.twitchBotPending;
    if (!pending)
        return;
    const tick = async () => {
        // a second authorization started, or the session went away under us — stop rather than keep asking
        // twitch about a code nobody is waiting for
        if (session.loggedOut || !session.twitchBotPending || session.twitchBotPending.deviceCode !== pending.deviceCode){
            clearInterval(timer);
            return;
        }
        try {
            if (!await pollTwitchBotDeviceAuth(session))
                return;
            clearInterval(timer);
            session.twitchBotError = "";
            emitSync(session.userId);
            onDone();
        } catch (err: any) {
            clearInterval(timer);
            // the code is dead either way, so clear it: the tab hides Authorize while one is outstanding,
            // and leaving it set would show the operator a code that can never work and no way to retry
            session.twitchBotPending = undefined;
            session.twitchBotError = describeError(err);
            emitSync(session.userId);
        }
    };
    const timer = setInterval(tick, pending.interval * 1000);
}

// ---------------------------------------------------------------------------
// talking to helix as the bot
// ---------------------------------------------------------------------------

async function accessToken(session: TimerUserSession): Promise<string> {
    const cached = tokens[session.userId];
    if (cached && Date.now() - cached.at < TOKEN_TTL)
        return cached.token;
    const app = appFor(session);
    const b = session.connections.twitchBot;
    const res = await axios.post(`${OAUTH}/token`, new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: "refresh_token",
        refresh_token: b.refreshToken,
    }).toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: FW_HTTP_TIMEOUT,
    });
    const token = res.data && res.data.access_token;
    if (typeof token !== "string" || !token)
        throw new Error("Twitch didn't return an access token.");
    // twitch may rotate the refresh token; persist it or the next refresh fails
    const rotated = res.data && res.data.refresh_token;
    if (typeof rotated === "string" && rotated && rotated !== b.refreshToken)
        session.connections.twitchBot = normalizeTwitchBot({ ...b, refreshToken: rotated });
    tokens[session.userId] = { token, at: Date.now() };
    return token;
}

// one retry on a 401: the cached token may have been revoked or expired early, and re-minting costs one
// request against losing a timeout mid-nuke.
async function asBot<T>(session: TimerUserSession, call: (token: string, clientId: string) => Promise<T>): Promise<T> {
    const app = appFor(session);
    try {
        return await call(await accessToken(session), app.clientId);
    } catch (err: any) {
        if (!(err && err.response && err.response.status === 401))
            throw err;
        delete tokens[session.userId];
        return call(await accessToken(session), app.clientId);
    }
}

// the channel the bot is acting in. helix wants ids, and the broadcaster's is already known when the
// sub-count connection is set up; otherwise it's resolved from the channel name like anybody else's.
async function broadcasterId(session: TimerUserSession): Promise<string> {
    const subs = (session.connections && session.connections.twitchSubs) || {};
    if (subs.broadcasterId)
        return subs.broadcasterId;
    const channel = String((session.connections && session.connections.twitch && session.connections.twitch.channel) || "");
    const ids = await resolveUserIds(session, [channel]);
    return ids[channel.toLowerCase()] || "";
}

// logins -> twitch user ids, a hundred at a time (helix's own ceiling for this endpoint). unknown logins
// simply don't come back, which is how a deleted or renamed account falls out rather than failing the batch.
export async function resolveUserIds(session: TimerUserSession, logins: string[]): Promise<{ [login: string]: string }> {
    const cache = idCache[session.userId] || (idCache[session.userId] = {});
    const want = logins.map((l) => String(l || "").toLowerCase().trim()).filter((l) => l && !cache[l]);
    const unique = Array.from(new Set(want));
    for (let i = 0; i < unique.length; i += 100){
        const batch = unique.slice(i, i + 100);
        const res = await asBot(session, (token, clientId) => axios.get(`${HELIX}/users`, {
            headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId },
            params: { login: batch },
            timeout: FW_HTTP_TIMEOUT,
            paramsSerializer: (p: any) => {
                const q = new URLSearchParams();
                for (const l of p.login)
                    q.append("login", l);
                return q.toString();
            },
        }));
        for (const u of (res.data && res.data.data) || [])
            cache[String(u.login || "").toLowerCase()] = String(u.id || "");
    }
    const out: { [login: string]: string } = {};
    for (const l of logins){
        const key = String(l || "").toLowerCase().trim();
        if (cache[key])
            out[key] = cache[key];
    }
    return out;
}

// say something in the channel, as the bot
export async function botSay(session: TimerUserSession, message: string){
    const b = session.connections.twitchBot;
    const broadcaster = await broadcasterId(session);
    if (!broadcaster)
        throw new Error("Couldn't work out which channel to talk in.");
    await asBot(session, (token, clientId) => axios.post(`${HELIX}/chat/messages`, {
        broadcaster_id: broadcaster,
        sender_id: b.botId,
        message: String(message || "").slice(0, 500),
    }, {
        headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId, "Content-Type": "application/json" },
        timeout: FW_HTTP_TIMEOUT,
    }));
}

// say something as an ANNOUNCEMENT: the highlighted, banner-style line twitch draws for /announce, which is
// what makes a prize landing stand out from the chatter around it instead of scrolling past in it.
// helix's endpoint wants the bot to be a mod and the token to carry moderator:manage:announcements. when
// twitch refuses for either reason the line is SAID instead, plainly — the point is that chat hears it, and
// a bot that predates the scope must not go quiet the day this shipped. the refusal is remembered so the
// fallback is taken straight away from then on, and explained once on the terminal.
export async function botAnnounce(session: TimerUserSession, message: string, color = "primary"){
    if (announceRefused[session.userId]){
        await botSay(session, message);
        return;
    }
    const b = session.connections.twitchBot;
    const broadcaster = await broadcasterId(session);
    if (!broadcaster)
        throw new Error("Couldn't work out which channel to talk in.");
    try {
        await asBot(session, (token, clientId) => axios.post(`${HELIX}/chat/announcements`, {
            message: String(message || "").slice(0, 500),
            color,
        }, {
            headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId, "Content-Type": "application/json" },
            // moderator_id is the account announcing and must match the token; broadcaster_id is the channel
            params: { broadcaster_id: broadcaster, moderator_id: b.botId },
            timeout: FW_HTTP_TIMEOUT,
            paramsSerializer: (p: any) => new URLSearchParams(p).toString(),
        }));
    } catch (err: any) {
        const status = err && err.response && err.response.status;
        if (status !== 401 && status !== 403)
            throw err; // a network blip or a rate limit: the caller reports it like any other failure
        announceRefused[session.userId] = true;
        emitTerminal(session.userId, `BOT — Twitch refused an announcement (${status}: ${describeError(err)}) Saying it as a plain message instead. To get the highlighted line, make sure ${b.botLogin || "the bot"} is a mod and hit Re-authorize on the Connections tab so its token carries moderator:manage:announcements.`);
        await botSay(session, message);
    }
}

// time somebody out. a timeout is a ban with a duration, on the same endpoint — no duration would be a
// permanent ban, so it is always sent.
export async function botTimeout(session: TimerUserSession, targetUserId: string, seconds: number, reason: string){
    const b = session.connections.twitchBot;
    const broadcaster = await broadcasterId(session);
    if (!broadcaster || !targetUserId)
        return;
    await asBot(session, (token, clientId) => axios.post(`${HELIX}/moderation/bans`, {
        data: {
            user_id: targetUserId,
            duration: Math.min(1209600, Math.max(1, Math.trunc(seconds))), // twitch's own ceiling is 2 weeks
            reason: String(reason || "").slice(0, 500),
        },
    }, {
        headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId, "Content-Type": "application/json" },
        // moderator_id is the account DOING it and must match the token; broadcaster_id is the channel
        params: { broadcaster_id: broadcaster, moderator_id: b.botId },
        timeout: FW_HTTP_TIMEOUT,
        paramsSerializer: (p: any) => new URLSearchParams(p).toString(),
    }));
}

// a one-off check that the authorization actually works, for the connections tab's "Test" button: say
// nothing, ban nobody, just prove the token mints and twitch knows who the bot is.
export async function testTwitchBot(session: TimerUserSession): Promise<string> {
    const b = session.connections.twitchBot;
    const broadcaster = await broadcasterId(session);
    if (!broadcaster)
        return "Authorized, but I can't work out the channel's Twitch id — set the channel on the Twitch connection.";
    // moderation/moderators, filtered to the bot, answers "is it a mod here" without changing anything
    const res = await asBot(session, (token, clientId) => axios.get(`${HELIX}/moderation/moderators`, {
        headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId },
        params: { broadcaster_id: broadcaster, user_id: b.botId },
        timeout: FW_HTTP_TIMEOUT,
        paramsSerializer: (p: any) => new URLSearchParams(p).toString(),
    }));
    const isMod = !!((res.data && res.data.data) || []).length;
    return isMod
        ? `${b.botLogin || "The bot"} is authorized and is a moderator — timeouts will work.`
        : `${b.botLogin || "The bot"} is authorized but is NOT a moderator in the channel, so timeouts will be refused. Type "/mod ${b.botLogin}" in chat.`;
}

export function forgetTwitchBot(userId: number){
    delete tokens[userId];
    delete idCache[userId];
    delete announceRefused[userId];
}

// surface a failure without letting it escape into whatever chat handler triggered it
export function reportBotError(session: TimerUserSession, what: string, err: any){
    const msg = describeError(err);
    session.twitchBotError = msg;
    emitTerminal(session.userId, `BOT — ${what}: ${msg}`);
    emitSync(session.userId);
}
