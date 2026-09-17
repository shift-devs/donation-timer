// the chat seam: everything this app SAYS or DOES in twitch chat, and the roster of who is talking.
//
// reading chat needs no identity — tmi.js connects anonymously and that's what platforms/twitch.ts does. but
// saying something, or timing somebody out, needs an account, and timing out needs that account to be a mod
// in the channel. that's the bot connection (platforms/twitchBot.ts), and until one is authorized everything
// here reports to the dashboard terminal instead of happening, rather than failing silently.
//
// none of it goes through the chat socket. twitch removed moderation commands over IRC in february 2023, so
// a "/timeout" sent down it is simply ignored now; it has to be helix. messages go the same way for the sake
// of one credential path (see the note in twitchBot.ts).
//
// callers ask for what they want — say this, time that person out — and never touch a client or a token, so
// none of the above is visible from the prizes that use it.

import { TimerUserSession } from "./types";
import { emitTerminal } from "./bus";
import { twitchBotReady, botSay, botTimeout, resolveUserIds, reportBotError, describeError } from "./platforms/twitchBot";

const MAX_CHATTERS = 2000;       // roster ceiling; the oldest are dropped past it
const MAX_TIMEOUT_SEC = 3600;    // twitch's own ceiling for a timeout is 2 weeks; this is ours, and plenty
// how far back somebody must have spoken to count as "in chat right now". a minute is too short (plenty of
// people are reading, not typing) and an hour is too long (it would sweep up people who left before the
// stream's last break).
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

// say something in chat. with no bot authorized this lands on the dashboard terminal, where the operator can
// read it out — which is worth more than silently dropping it.
export function chatSay(session: TimerUserSession, message: string){
    const text = String(message || "").slice(0, 450); // twitch cuts a message off around 500
    if (!text)
        return;
    if (!twitchBotReady(session)){
        emitTerminal(session.userId, `CHAT (would say): ${text}`);
        return;
    }
    // nothing awaits this: a chat line is not worth holding up the prize, the sub handler or the reel that
    // triggered it, and a failure has somewhere to go on its own
    botSay(session, text).catch((err) => reportBotError(session, "saying something in chat", err));
}

// time a batch of people out. taken as a batch rather than one at a time because helix works in user IDS,
// not logins — resolving them is one request for up to a hundred people, against one per person.
// returns what was attempted; the caller does the reporting, since one terminal line per person during a
// nuke would bury everything else.
export async function chatTimeoutMany(session: TimerUserSession, logins: string[], seconds: number, reason: string): Promise<number> {
    const secs = Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.trunc(seconds)));
    const clean = logins.map((l) => String(l || "").replace(/^@/, "").trim().toLowerCase()).filter(Boolean);
    if (!clean.length || !twitchBotReady(session))
        return 0;
    let done = 0;
    try {
        const ids = await resolveUserIds(session, clean);
        for (const login of clean){
            const id = ids[login];
            if (!id)
                continue; // renamed, deleted, or never existed — drop them rather than fail the batch
            try {
                await botTimeout(session, id, secs, reason);
                done++;
            } catch (err: any) {
                // one refusal must not cost the rest of the batch. twitch refuses a mod or the broadcaster
                // with a 400, which is expected enough not to be worth a line of its own.
                if (!(err && err.response && err.response.status === 400))
                    reportBotError(session, `timing out ${login}`, err);
            }
        }
    } catch (err) {
        reportBotError(session, "timing out a batch of chatters", err);
    }
    return done;
}

// one person, with a reason when it doesn't work. the batch version above swallows refusals because a nuke
// has thirty of them and nobody wants thirty lines; a ray gun shot is a single deliberate act by a viewer
// who spent something on it, so it owes them an answer — and lets the caller hand the charge back.
export async function chatTimeoutOne(session: TimerUserSession, login: string, seconds: number, reason: string): Promise<{ ok: boolean, message: string }> {
    const who = String(login || "").replace(/^@/, "").trim().toLowerCase();
    const secs = Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.trunc(seconds)));
    if (!who)
        return { ok: false, message: "nobody was named" };
    if (!twitchBotReady(session))
        return { ok: false, message: "there's no bot account connected" };
    try {
        const ids = await resolveUserIds(session, [who]);
        if (!ids[who])
            return { ok: false, message: `there's nobody on Twitch called ${who}` };
        await botTimeout(session, ids[who], secs, reason);
        return { ok: true, message: "" };
    } catch (err: any) {
        // twitch refuses a moderator or the broadcaster with a 400, which isn't a fault worth reporting as
        // one — it's the answer to the question
        if (err && err.response && err.response.status === 400)
            return { ok: false, message: `${who} can't be timed out` };
        reportBotError(session, `timing out ${who}`, err);
        return { ok: false, message: describeError(err) };
    }
}

// whether a batch of timeouts will actually happen, so the caller can say which it is
export function canTimeout(session: TimerUserSession): boolean {
    return twitchBotReady(session);
}

// ---------------------------------------------------------------------------
// who is in chat right now
// ---------------------------------------------------------------------------
//
// built from the messages we already read, because there is no reliable way to ask: twitch's viewer list
// endpoint is gone for third parties, and the JOIN/PART membership events only cover small channels and lag
// badly. so "active chatter" means what it says — somebody who has actually typed recently — which is also
// the fairer definition for a prize that punishes chat.
//
// transient, like a firesale run: a restart empties it and the next few minutes of chat fill it back in.

export function chatters(session: TimerUserSession): { [login: string]: { name: string, t: number, mod: boolean } } {
    if (!session.chatters || typeof session.chatters !== "object")
        session.chatters = {};
    return session.chatters;
}

export function recordChatter(session: TimerUserSession, login: string, displayName: string, isMod: boolean){
    const key = String(login || "").toLowerCase().trim();
    if (!key)
        return;
    const list = chatters(session);
    list[key] = { name: String(displayName || login).slice(0, 25), t: Date.now(), mod: !!isMod };
    if (Object.keys(list).length <= MAX_CHATTERS)
        return;
    // over the ceiling: drop the ones who spoke longest ago, since they're the least likely to still be here
    const stale = Object.keys(list).sort((a, b) => list[a].t - list[b].t);
    for (const k of stale.slice(0, stale.length - MAX_CHATTERS))
        delete list[k];
}

// everyone who has spoken inside the window and can actually be timed out. MODS AND THE BROADCASTER ARE
// LEFT OUT on purpose: twitch refuses a timeout on them, so counting them would make "half of chat" a lie —
// the prize would report ten and hit six.
export function activeChatters(session: TimerUserSession, windowMs = ACTIVE_WINDOW_MS): string[] {
    const list = chatters(session);
    const cutoff = Date.now() - windowMs;
    return Object.keys(list).filter((k) => list[k].t >= cutoff && !list[k].mod);
}

// the login behind a DISPLAY name, for anyone who has spoken. twitch's own autocomplete inserts the display
// name, which for most accounts is the login with different capitals — but an account with a localised name
// ("さくら" for the login "sakura123") has no relationship between the two at all, and typing what chat
// actually shows you would otherwise always miss.
export function chatterByDisplayName(session: TimerUserSession, name: any): string {
    const want = String(name || "").trim().toLowerCase();
    if (!want)
        return "";
    const list = chatters(session);
    for (const login of Object.keys(list))
        if (String(list[login].name || "").trim().toLowerCase() === want)
            return login;
    return "";
}

export function chatterName(session: TimerUserSession, login: string): string {
    const row = chatters(session)[String(login || "").toLowerCase()];
    return (row && row.name) || login;
}

// drop everyone who has gone quiet, so a session that has been up for weeks isn't carrying a roster of
// people who left on day one. called from the roster write path, which is the only thing that grows it.
export function pruneChatters(session: TimerUserSession, windowMs = ACTIVE_WINDOW_MS){
    const list = chatters(session);
    const cutoff = Date.now() - windowMs;
    for (const k of Object.keys(list))
        if (list[k].t < cutoff)
            delete list[k];
}
