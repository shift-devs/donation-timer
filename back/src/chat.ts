// the chat seam: everything this app would SAY or DO in twitch chat, and the roster of who is talking.
//
// reading chat needs no identity — tmi.js connects anonymously and that's what platforms/twitch.ts does. but
// SAYING something, or timing somebody out, needs an account, and timing out needs that account to be a mod
// in the channel. that account doesn't exist yet, so everything outbound funnels through here and reports to
// the dashboard terminal instead of happening. when the bot lands, this file is the only one that changes:
// callers already ask for what they want rather than reaching for the tmi client themselves.
//
// it isn't a stub, though — sendable() checks whether the connected client actually has an identity, so the
// moment the tmi client is built with real credentials these start working with no further wiring. an
// anonymous tmi connection gets a "justinfan12345" username, which is how we tell the two apart.

import { TimerUserSession } from "./types";
import { emitTerminal, reportError } from "./bus";

const MAX_CHATTERS = 2000;       // roster ceiling; the oldest are dropped past it
const MAX_TIMEOUT_SEC = 3600;    // twitch's own ceiling for a timeout is 2 weeks; this is ours, and plenty
// how far back somebody must have spoken to count as "in chat right now". a minute is too short (plenty of
// people are reading, not typing) and an hour is too long (it would sweep up people who left before the
// stream's last break).
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

// is there an account behind this connection, or are we reading anonymously?
function sendable(session: TimerUserSession): boolean {
    const client: any = session.conTMI;
    if (!client || typeof client.getUsername !== "function")
        return false;
    const me = String(client.getUsername() || "");
    return !!me && !/^justinfan/i.test(me);
}

function channelOf(session: TimerUserSession): string {
    return String((session.connections && session.connections.twitch && session.connections.twitch.channel) || "");
}

// say something in chat. until the bot account exists this lands on the dashboard terminal, where the
// operator can read it out — which is worth more than silently dropping it.
export function chatSay(session: TimerUserSession, message: string){
    const text = String(message || "").slice(0, 450); // twitch cuts a message off around 500
    if (!text)
        return;
    if (!sendable(session)){
        emitTerminal(session.userId, `CHAT (would say): ${text}`);
        return;
    }
    try {
        (session.conTMI as any).say(channelOf(session), text);
    } catch (err) {
        reportError(session.userId, "saying something in chat", err);
    }
}

// time somebody out. needs the account to be a MOD in the channel, so it fails loudly rather than quietly if
// it ever gets called without that — a nuke that silently does nothing would look like a broken prize.
export function chatTimeout(session: TimerUserSession, login: string, seconds: number, reason: string){
    const who = String(login || "").replace(/^@/, "").trim();
    const secs = Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.trunc(seconds)));
    if (!who)
        return;
    if (!sendable(session))
        return; // the caller reports the batch; one line per person would bury the terminal
    try {
        (session.conTMI as any).timeout(channelOf(session), who, secs, reason).catch((err: any) => {
            // tmi rejects with twitch's own notice, e.g. "bad_timeout_admin" for a mod or the broadcaster
            emitTerminal(session.userId, `Couldn't time out ${who}: ${(err && err.message) || err}`);
        });
    } catch (err) {
        reportError(session.userId, `timing out ${who}`, err);
    }
}

// whether a batch of timeouts will actually happen, so the caller can say which it is
export function canTimeout(session: TimerUserSession): boolean {
    return sendable(session);
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
