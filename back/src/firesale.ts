// firesale: the on-stream half of a fourthwall chat giveaway. fourthwall announces the giveaway in twitch chat,
// this starts a run on the /firesale browser source — looping music, FIRESALE across the middle, and every
// chatter who types !enter bouncing around the frame like a dvd logo. fourthwall announces the winner in chat
// when it's over and that name goes up in the middle for a bit.
//
// the run is LIVE state, not config: it lives on the session and is never persisted (dbUpdate is field-explicit,
// so nothing here reaches the database). a restart mid-giveaway loses the entrants, which is right — the source
// comes back idle rather than resurrecting a giveaway that finished while the process was down.
// firesaleSettings IS persisted, and this file owns validating it.
//
// the winner is always fourthwall's, never ours: it's the name that gets the redeem link, so an overlay picking
// its own would contradict chat. we only draw one ourselves if the announcement never turns up (drawGraceSec).

import { TimerUserSession } from "./types";
import { emitFiresale, emitTerminal, reportError } from "./bus";

const MAX_NAME = 25;          // twitch's own username ceiling
const MAX_PRIZE = 200;
const MAX_URL = 300;
// every entrant is kept for the draw, but a giveaway that pulls thousands must not grow without bound
const MAX_ENTRANTS = 5000;
const MAX_BOUNCERS = 200;     // ceiling on what the source is asked to animate at once
const PUSH_COALESCE = 250;    // ms; a busy !enter burst becomes ~4 pushes a second, not one per chatter

export const DEFAULT_FIRESALE = {
    // auto-start when fourthwall announces a giveaway. off = the dashboard/terminal starts runs by hand.
    enabled: true,
    // whose announcements count. blank accepts any mod/broadcaster, which is the escape hatch if fourthwall
    // ever posts under a different login.
    botName: "fourthwall",
    // what chatters type to enter, without the "!"
    command: "enter",
    // a file in public/media, looped for the whole run
    music: "firesale.mp3",
    volume: 0.6,
    // one-shot stinger played over the top of the music when a run starts. only ever fires for a giveaway that
    // has JUST begun — a source connecting (or reconnecting) into a firesale already in progress picks up the
    // music loop but must not blast the announcer at whatever moment OBS happened to load it.
    announcer: "firesale announcer.mp3",
    announcerVolume: 1,
    // used when the announcement doesn't say how long ("in the next N seconds")
    fallbackSec: 180,
    // whether the entry countdown is shown ON STREAM. off by default: the announcement's "180 seconds" is what
    // fourthwall says, not something we can verify against how long it really keeps the giveaway open, and a
    // countdown that hits 0:00 while chat is still entering is worse than no countdown at all. the entry window
    // still runs either way — this only governs whether viewers see the clock.
    showCountdown: false,
    // how long to hold on DRAWING… waiting for fourthwall's winner announcement before drawing one ourselves
    drawGraceSec: 60,
    // how long the winner stays up before the source goes idle
    winnerHoldSec: 15,
    // how many names bounce at once; the rest are still entered and still counted. the source shrinks the type
    // to suit, so raising this packs the frame rather than overflowing it.
    maxBouncers: 120,
    bgColor: "transparent",
    titleColor: "#ff2d0f",
    nameColor: "#ffffff",
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const TRANSPARENT = "transparent";

function hexOr(v: any, fallback: string, extra?: string): string {
    const s = typeof v === "string" ? v.trim() : "";
    if (extra && s === extra)
        return s;
    return HEX.test(s) ? s : fallback;
}

function numIn(v: any, min: number, max: number, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function normalizeFiresale(raw: any): any {
    const d = DEFAULT_FIRESALE;
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
        botName: typeof r.botName === "string" ? r.botName.trim().replace(/^@/, "").slice(0, MAX_NAME) : d.botName,
        // stored without the "!" so the ui and the chat matcher can't disagree about whether it's there
        command: (typeof r.command === "string" ? r.command.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.command,
        music: typeof r.music === "string" ? r.music.slice(0, 200) : d.music,
        volume: Math.min(1, Math.max(0, Number.isFinite(Number(r.volume)) ? Number(r.volume) : d.volume)),
        announcer: typeof r.announcer === "string" ? r.announcer.slice(0, 200) : d.announcer,
        announcerVolume: Math.min(1, Math.max(0, Number.isFinite(Number(r.announcerVolume)) ? Number(r.announcerVolume) : d.announcerVolume)),
        fallbackSec: numIn(r.fallbackSec, 5, 3600, d.fallbackSec),
        showCountdown: r.showCountdown === undefined ? d.showCountdown : !!r.showCountdown,
        drawGraceSec: numIn(r.drawGraceSec, 0, 900, d.drawGraceSec),
        winnerHoldSec: numIn(r.winnerHoldSec, 1, 300, d.winnerHoldSec),
        maxBouncers: numIn(r.maxBouncers, 1, MAX_BOUNCERS, d.maxBouncers),
        bgColor: hexOr(r.bgColor, d.bgColor, TRANSPARENT),
        titleColor: hexOr(r.titleColor, d.titleColor),
        nameColor: hexOr(r.nameColor, d.nameColor),
    };
}

export function firesaleSettings(session: TimerUserSession): any {
    return session.firesaleSettings || (session.firesaleSettings = normalizeFiresale(null));
}

// ---------------------------------------------------------------------------
// parsing fourthwall's two announcements
// ---------------------------------------------------------------------------

// "NEW GIVEAWAY - !ENTER TO WIN. LaCroixFans gifted a 3 Foil Packs — 10 Years Running to the chat.
//  Type !ENTER in the next 180 seconds for a chance to win. quickster.gg/products/foils"
export function parseGiveawayStart(text: string): { seconds: number, prize: string, gifter: string, url: string } | null {
    const s = String(text || "");
    // both halves are required: "new giveaway" alone would also match a streamer talking about one
    if (!/new\s+giveaway/i.test(s) || !/!\s*enter/i.test(s))
        return null;

    const dur = s.match(/in\s+the\s+next\s+(\d+)\s*second/i);
    // the gifter/prize sentence. [^.!] can't cross the sentence boundary before it, so the gifter is just the
    // name and not everything back to "NEW GIVEAWAY"
    const gift = s.match(/([^.!]+?)\s+gifted\s+(?:an?\s+)?(.+?)\s+to\s+the\s+chat/i);
    return {
        seconds: dur ? Math.min(3600, Math.max(5, parseInt(dur[1], 10))) : 0, // 0 = caller's fallback
        gifter: gift ? gift[1].trim().slice(0, MAX_NAME) : "",
        prize: gift ? gift[2].trim().slice(0, MAX_PRIZE) : "",
        url: lastUrl(s),
    };
}

// "GIVEAWAY WINNER ANNOUNCEMENT! @thewondermentmoogle won LaCroixFans' gift of a 3 Foil Packs …"
export function parseGiveawayWinner(text: string): string | null {
    const s = String(text || "");
    if (!/giveaway\s+winner/i.test(s))
        return null;
    // anchored on " won" so an @mention inside the prize name can't be mistaken for the winner; the bare
    // fallback covers a wording change that keeps the @name but drops the verb
    const won = s.match(/@([a-zA-Z0-9_]{2,25})\s+won\b/i) || s.match(/@([a-zA-Z0-9_]{2,25})/);
    return won ? won[1] : null;
}

// the trailing product/redeem link. takes the last domain-looking token so a url anywhere earlier in the
// sentence doesn't win over the one fourthwall puts at the end.
function lastUrl(s: string): string {
    const hits = String(s || "").match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi);
    return hits && hits.length ? hits[hits.length - 1].slice(0, MAX_URL) : "";
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

// phase timers, keyed by user. deliberately not on the session: a Timeout is not state anyone should be able
// to serialize, sync or copy, and keeping them here means clearing a run can never leave one behind.
const timers: { [userId: number]: { end?: any, grace?: any, hold?: any, push?: any } } = {};

function slots(userId: number){
    return timers[userId] || (timers[userId] = {});
}

function clearTimers(userId: number){
    const t = slots(userId);
    clearTimeout(t.end);
    clearTimeout(t.grace);
    clearTimeout(t.hold);
    t.end = t.grace = t.hold = undefined;
}

function blank(){
    return {
        active: false,
        phase: "idle" as string,
        nonce: 0,
        startedAt: 0,
        endsAt: 0,
        prize: "",
        gifter: "",
        url: "",
        winner: "",
        // display names in entry order; `seen` dedupes on the login so one chatter can't fill the screen
        entrants: [] as string[],
        seen: new Set<string>(),
    };
}

export function getFiresale(session: TimerUserSession): any {
    return session.firesale || (session.firesale = blank());
}

// what the browser source is handed. only the tail of the entrant list travels: the source animates the most
// recent maxBouncers names and shows `total` for everyone else, so a giveaway that pulls hundreds stays
// readable (and cheap to animate) instead of turning the frame into confetti.
export function firesaleView(session: TimerUserSession): any {
    const f = getFiresale(session);
    const cfg = firesaleSettings(session);
    return {
        active: f.active,
        phase: f.phase,
        nonce: f.nonce,
        // the source needs this to tell "this giveaway just started" from "i connected into one already
        // running", which is what decides whether the announcer fires
        startedAt: f.startedAt,
        endsAt: f.endsAt,
        prize: f.prize,
        gifter: f.gifter,
        url: f.url,
        winner: f.winner,
        total: f.entrants.length,
        names: f.entrants.slice(-cfg.maxBouncers),
        command: cfg.command,
        showCountdown: cfg.showCountdown,
        music: cfg.music,
        volume: cfg.volume,
        announcer: cfg.announcer,
        announcerVolume: cfg.announcerVolume,
        bgColor: cfg.bgColor,
        titleColor: cfg.titleColor,
        nameColor: cfg.nameColor,
    };
}

export function pushFiresale(session: TimerUserSession){
    emitFiresale(session.userId, firesaleView(session));
}

// a burst of !enter would otherwise be one full push per chatter; collapse them into one every PUSH_COALESCE ms.
// phase changes call pushFiresale directly — those must never wait.
function pushSoon(session: TimerUserSession){
    const t = slots(session.userId);
    if (t.push)
        return;
    t.push = setTimeout(() => {
        t.push = undefined;
        try {
            pushFiresale(session);
        } catch (err) {
            reportError(session.userId, "pushing the firesale state", err);
        }
    }, PUSH_COALESCE);
}

export function startFiresale(session: TimerUserSession, opts: { seconds?: number, prize?: string, gifter?: string, url?: string } = {}){
    const cfg = firesaleSettings(session);
    const prev = getFiresale(session);
    clearTimers(session.userId);
    const seconds = numIn(opts.seconds, 5, 3600, cfg.fallbackSec);
    const f = blank();
    // a fresh nonce every run, carried past the old one so a source that missed the end of the last firesale
    // still sees this as a new one and resets its bouncers
    f.nonce = (prev.nonce || 0) + 1;
    f.active = true;
    f.phase = "running";
    f.startedAt = Date.now();
    f.endsAt = f.startedAt + seconds * 1000;
    f.prize = String(opts.prize || "").slice(0, MAX_PRIZE);
    f.gifter = String(opts.gifter || "").slice(0, MAX_NAME);
    f.url = String(opts.url || "").slice(0, MAX_URL);
    session.firesale = f;

    slots(session.userId).end = setTimeout(() => {
        try {
            beginDraw(session);
        } catch (err) {
            reportError(session.userId, "ending the firesale entry window", err);
        }
    }, seconds * 1000);

    emitTerminal(session.userId, `FIRESALE started — ${seconds}s to !${cfg.command}${f.prize ? ` for ${f.prize}` : ""}`, true);
    pushFiresale(session);
}

// entry window closed. hold on DRAWING… and wait for fourthwall to announce its winner, because that's the
// name that actually gets the prize. only if the announcement never comes do we pick one ourselves.
export function beginDraw(session: TimerUserSession){
    const f = getFiresale(session);
    if (!f.active || f.phase !== "running")
        return;
    const cfg = firesaleSettings(session);
    clearTimers(session.userId);
    f.phase = "drawing";
    pushFiresale(session);

    slots(session.userId).grace = setTimeout(() => {
        try {
            const cur = getFiresale(session);
            if (!cur.active || cur.phase !== "drawing")
                return;
            if (!cur.entrants.length){
                emitTerminal(session.userId, `FIRESALE ended — nobody entered.`);
                stopFiresale(session);
                return;
            }
            const pick = cur.entrants[Math.floor(Math.random() * cur.entrants.length)];
            emitTerminal(session.userId, `FIRESALE — no winner announcement from Fourthwall, drew ${pick} locally.`);
            declareFiresaleWinner(session, pick);
        } catch (err) {
            reportError(session.userId, "drawing a firesale winner", err);
        }
    }, cfg.drawGraceSec * 1000);
}

export function addFiresaleEntry(session: TimerUserSession, login: string, displayName: string): boolean {
    const f = getFiresale(session);
    if (!f.active || f.phase !== "running")
        return false;
    const key = String(login || "").toLowerCase().trim();
    if (!key || f.seen.has(key))
        return false;
    if (f.entrants.length >= MAX_ENTRANTS)
        return false;
    f.seen.add(key);
    f.entrants.push(String(displayName || login).slice(0, MAX_NAME));
    pushSoon(session);
    return true;
}

// the winner goes up in the middle and the run ends after winnerHoldSec. accepted from any phase of a live run:
// fourthwall's announcement is the authority, so if it lands early (clock drift, a giveaway cut short) it wins
// over our own countdown rather than being ignored.
export function declareFiresaleWinner(session: TimerUserSession, name: string){
    const f = getFiresale(session);
    if (!f.active)
        return;
    const cfg = firesaleSettings(session);
    clearTimers(session.userId);
    f.phase = "winner";
    f.winner = String(name || "").replace(/^@/, "").slice(0, MAX_NAME);
    emitTerminal(session.userId, `FIRESALE winner: ${f.winner} (${f.entrants.length} entered)`, true);
    pushFiresale(session);

    slots(session.userId).hold = setTimeout(() => {
        try {
            stopFiresale(session);
        } catch (err) {
            reportError(session.userId, "clearing the firesale", err);
        }
    }, cfg.winnerHoldSec * 1000);
}

// clear the source. keeps the nonce so the next run is still seen as new.
export function stopFiresale(session: TimerUserSession){
    const prev = getFiresale(session);
    clearTimers(session.userId);
    const f = blank();
    f.nonce = prev.nonce || 0;
    session.firesale = f;
    pushFiresale(session);
}

// tear down on logout so a timer can't fire against a detached session
export function endFiresaleTimers(userId: number){
    clearTimers(userId);
    const t = slots(userId);
    clearTimeout(t.push);
    delete timers[userId];
}

// the "firesale <action>" command, from the dashboard terminal or from chat — one implementation so the two
// can't drift. returns a line for whoever ran it, the same contract setTextBoxText uses.
export function runFiresaleCommand(session: TimerUserSession, cmd: { action: string, seconds: number, name: string }): { ok: boolean, message: string } {
    const cfg = firesaleSettings(session);
    const f = getFiresale(session);
    if (cmd.action === "start"){
        const seconds = numIn(cmd.seconds, 5, 3600, cfg.fallbackSec);
        startFiresale(session, { seconds });
        return { ok: true, message: `Firesale started — ${seconds}s to !${cfg.command}.` };
    }
    if (cmd.action === "stop"){
        if (!f.active)
            return { ok: false, message: "No firesale is running." };
        stopFiresale(session);
        return { ok: true, message: "Firesale cleared." };
    }
    if (cmd.action === "draw"){
        if (!f.active || f.phase !== "running")
            return { ok: false, message: "No firesale is taking entries right now." };
        beginDraw(session);
        return { ok: true, message: `Entries closed — ${f.entrants.length} in. Waiting on Fourthwall's winner.` };
    }
    // winner
    if (!f.active)
        return { ok: false, message: "No firesale is running." };
    declareFiresaleWinner(session, cmd.name);
    return { ok: true, message: `Firesale winner set to ${cmd.name}.` };
}

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

// one entry point for every twitch chat line, whether it arrived as a normal message or as an announcement
// (fourthwall posts both of its giveaway lines as announcements, which tmi.js reports as `usernotice`).
// returns true if the line was consumed as firesale traffic and the caller should stop processing it.
// `isMod` covers the broadcaster too — announcements can only come from those, so it doubles as the authority
// check when no bot name is configured.
export function handleFiresaleChat(session: TimerUserSession, login: string, displayName: string, text: string, isMod: boolean): boolean {
    const cfg = firesaleSettings(session);
    const body = String(text || "").trim();
    const who = String(login || "").toLowerCase();

    // a chatter entering. checked first and open to everyone — entries are the one thing here that isn't
    // mod-only, and gating them behind the announcement checks would cost every chat line two regexes.
    if (body.replace(/^!/, "").split(/\s+/)[0].toLowerCase() === cfg.command && body.startsWith("!")){
        addFiresaleEntry(session, who, displayName || login);
        return true;
    }

    // announcements from fourthwall (or, with no bot name set, any mod). a non-mod could otherwise start a
    // firesale by pasting the announcement text into chat.
    const fromBot = cfg.botName ? who === cfg.botName.toLowerCase() : isMod;
    if (!fromBot)
        return false;

    const winner = parseGiveawayWinner(body);
    if (winner){
        if (getFiresale(session).active)
            declareFiresaleWinner(session, winner);
        return true;
    }

    const start = parseGiveawayStart(body);
    if (start){
        if (!cfg.enabled){
            emitTerminal(session.userId, `Fourthwall giveaway detected, but the firesale overlay is turned off.`);
            return true;
        }
        // a second giveaway supersedes whatever is on screen rather than being dropped
        startFiresale(session, { seconds: start.seconds || cfg.fallbackSec, prize: start.prize, gifter: start.gifter, url: start.url });
        return true;
    }

    return false;
}
