// firesale: the on-stream half of a fourthwall chat giveaway. fourthwall announces a giveaway in twitch chat,
// this starts a run on the /firesale browser source — looping music, FIRESALE across the middle, and every
// chatter who types !enter bouncing around the frame like a dvd logo. fourthwall announces the winner in chat
// when it's over and that name goes up in the middle.
//
// SEVERAL GIVEAWAYS CAN BE OPEN AT ONCE, so this holds a LIST of runs, not one. the important consequences:
//   * !enter carries no way to name a giveaway, so one !enter enters the chatter into every run currently
//     taking entries — but only those. someone who typed before a later giveaway opened is not in it, which is
//     why two overlapping runs have similar-but-different entrant counts.
//   * fourthwall's winner announcement names the GIFTER and the PRIZE ("@x won LaCroixFans' gift of a 3 Foil
//     Packs — 10 Years Running"), and those match the start announcement's gifter and prize exactly. that pair
//     is the join key, so a winner is routed to the run it actually belongs to rather than guessed at.
//
// the runs are LIVE state, not config: they live on the session and are never persisted (dbUpdate is
// field-explicit, so nothing here reaches the database). a restart mid-giveaway loses the entrants, which is
// right — the source comes back idle rather than resurrecting a giveaway that finished while the process was
// down. firesaleSettings IS persisted, and this file owns validating it.
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
const MAX_RUNS = 4;           // concurrent giveaways; past this the oldest is dropped to make room
// a giveaway of several items is announced as one message PER WINNER, all naming the same gifter and prize, so a
// run collects a list. bounded so a malformed/repeated stream of announcements can't grow it without end.
const MAX_WINNERS = 25;
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
    // played once when a giveaway's winner goes up. the looping bed stops at the same moment (see below), so
    // this lands in the clear rather than fighting the music.
    winSound: "congratulations-you-won.mp3",
    winVolume: 1,
    // used when the announcement doesn't say how long ("in the next N seconds")
    fallbackSec: 180,
    // whether the entry countdown is shown ON STREAM. off by default: the announcement's "180 seconds" is what
    // fourthwall says, not something we can verify against how long it really keeps the giveaway open, and a
    // countdown that hits 0:00 while chat is still entering is worse than no countdown at all. the entry window
    // still runs either way — this only governs whether viewers see the clock.
    showCountdown: false,
    // how long to hold on DRAWING… waiting for fourthwall's winner announcement before drawing one ourselves
    drawGraceSec: 60,
    // how long a winner stays up before that run leaves the screen
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
        winSound: typeof r.winSound === "string" ? r.winSound.slice(0, 200) : d.winSound,
        winVolume: Math.min(1, Math.max(0, Number.isFinite(Number(r.winVolume)) ? Number(r.winVolume) : d.winVolume)),
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

// fourthwall html-escapes its own product names — its api returns "collector&#39;s items" — and the giveaway
// announcement carries that through verbatim, so an apostrophe would land on stream as a literal &#39;.
// this must run BEFORE the regexes below, not just on the text we display: the winner announcement writes the
// possessive as "PSkaller&#39;s gift of", which the 's? in the winner pattern would never match, and the winner
// would silently fail to route to its giveaway.
const NAMED_ENTITIES: { [name: string]: string } = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0",
};

export function decodeEntities(text: string): string {
    return String(text || "").replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
        if (body[0] === "#"){
            const hex = body[1] === "x" || body[1] === "X";
            const n = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
            // leave anything out of range as it was rather than throwing on fromCodePoint
            if (!Number.isFinite(n) || n < 1 || n > 0x10ffff)
                return whole;
            try {
                return String.fromCodePoint(n);
            } catch {
                return whole;
            }
        }
        const named = NAMED_ENTITIES[body.toLowerCase()];
        return named === undefined ? whole : named;
    });
}

// "NEW GIVEAWAY - !ENTER TO WIN. LaCroixFans gifted a 3 Foil Packs — 10 Years Running to the chat.
//  Type !ENTER in the next 180 seconds for a chance to win. quickster.gg/products/foils"
export function parseGiveawayStart(text: string): { seconds: number, prize: string, gifter: string, url: string } | null {
    const s = decodeEntities(text);
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

// "GIVEAWAY WINNER ANNOUNCEMENT! @thewondermentmoogle won LaCroixFans' gift of a 3 Foil Packs — 10 Years
//  Running! https://quickster.gg/redeem to redeem."
// the gifter and prize come back too: with several giveaways open they're what says WHICH one this winner is
// for. a gifter whose name ends in s is written "LaCroixFans'" with no trailing s, hence 's?.
export function parseGiveawayWinner(text: string): { winner: string, gifter: string, prize: string } | null {
    const s = decodeEntities(text);
    if (!/giveaway\s+winner/i.test(s))
        return null;
    const full = s.match(/@([a-zA-Z0-9_]{2,25})\s+won\s+(.+?)'s?\s+gift\s+of\s+(?:an?\s+)?(.+?)\s*[!.]?\s*(?:https?:\/\/|$)/i);
    if (full)
        return {
            winner: full[1],
            gifter: full[2].trim().slice(0, MAX_NAME),
            prize: full[3].trim().slice(0, MAX_PRIZE),
        };
    // wording changed but the @name survived — still worth reporting, just without anything to match on
    const bare = s.match(/@([a-zA-Z0-9_]{2,25})\s+won\b/i) || s.match(/@([a-zA-Z0-9_]{2,25})/);
    return bare ? { winner: bare[1], gifter: "", prize: "" } : null;
}

// the trailing product/redeem link. takes the last domain-looking token so a url anywhere earlier in the
// sentence doesn't win over the one fourthwall puts at the end.
function lastUrl(s: string): string {
    const hits = String(s || "").match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi);
    return hits && hits.length ? hits[hits.length - 1].slice(0, MAX_URL) : "";
}

// ---------------------------------------------------------------------------
// the runs
// ---------------------------------------------------------------------------

// phase timers, per run, keyed by user. deliberately not on the session: a Timeout is not state anyone should
// be able to serialize, sync or copy, and keeping them here means clearing a run can never leave one behind.
const timers: { [userId: number]: { push?: any, runs: { [runId: string]: { end?: any, grace?: any, hold?: any } } } } = {};

function slots(userId: number){
    return timers[userId] || (timers[userId] = { runs: {} });
}

function runSlots(userId: number, runId: string){
    const t = slots(userId);
    return t.runs[runId] || (t.runs[runId] = {});
}

function clearRunTimers(userId: number, runId: string){
    const t = slots(userId).runs[runId];
    if (!t)
        return;
    clearTimeout(t.end);
    clearTimeout(t.grace);
    clearTimeout(t.hold);
    delete slots(userId).runs[runId];
}

function clearAllTimers(userId: number){
    const t = slots(userId);
    for (const id of Object.keys(t.runs))
        clearRunTimers(userId, id);
}

export function getFiresale(session: TimerUserSession): any {
    if (!session.firesale || !Array.isArray(session.firesale.runs))
        session.firesale = { nonce: 0, seq: 0, runs: [] };
    return session.firesale;
}

export function firesaleRuns(session: TimerUserSession): any[] {
    return getFiresale(session).runs;
}

// runs still taking entries — the ones an !enter joins
function runningRuns(session: TimerUserSession): any[] {
    return firesaleRuns(session).filter((r) => r.phase === "running");
}

// ---------------------------------------------------------------------------
// what the browser source is handed
// ---------------------------------------------------------------------------

// the bouncing field is the UNION of everyone entered in any run still on screen — including one that has
// already been won, so the field stays full through its winner reveal instead of thinning out. capped at
// maxBouncers. the per-run counts travel separately in `runs` — those are what differ between two overlapping
// giveaways, and what the overlay lists next to each prize.
export function firesaleView(session: TimerUserSession): any {
    const f = getFiresale(session);
    const cfg = firesaleSettings(session);
    const runs = f.runs;

    // union in entry order, deduped. a name entered in two runs shouldn't bounce twice.
    const seen = new Set<string>();
    const union: string[] = [];
    for (const r of runs)
        for (const n of r.entrants){
            const k = n.toLowerCase();
            if (!seen.has(k)){
                seen.add(k);
                union.push(n);
            }
        }

    return {
        active: runs.length > 0,
        nonce: f.nonce,
        names: union.slice(-cfg.maxBouncers),
        total: union.length,
        // one entry per concurrent giveaway, oldest first, each with its own deadline, count and winner
        runs: runs.map((r: any) => ({
            id: r.id,
            phase: r.phase,
            startedAt: r.startedAt,
            endsAt: r.endsAt,
            prize: r.prize,
            gifter: r.gifter,
            url: r.url,
            winners: r.winners,
            // when the LAST winner went up. the source needs it to tell "this just resolved" from "i reconnected
            // while a winner was already on screen", so a reload doesn't replay the win sound.
            wonAt: r.wonAt,
            total: r.entrants.length,
        })),
        command: cfg.command,
        showCountdown: cfg.showCountdown,
        music: cfg.music,
        volume: cfg.volume,
        announcer: cfg.announcer,
        announcerVolume: cfg.announcerVolume,
        winSound: cfg.winSound,
        winVolume: cfg.winVolume,
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

// ---------------------------------------------------------------------------
// starting / ending a run
// ---------------------------------------------------------------------------

// a giveaway is identified by its gifter+prize while it's open, so a repeated announcement (twitch can deliver
// the same one twice, e.g. on a reconnect) doesn't open a second run for the same giveaway.
function sameGiveaway(r: any, gifter: string, prize: string): boolean {
    return r.prize === prize && r.gifter === gifter;
}

export function startFiresale(session: TimerUserSession, opts: { seconds?: number, prize?: string, gifter?: string, url?: string } = {}): any {
    const cfg = firesaleSettings(session);
    const f = getFiresale(session);
    const seconds = numIn(opts.seconds, 5, 3600, cfg.fallbackSec);
    const prize = String(opts.prize || "").slice(0, MAX_PRIZE);
    const gifter = String(opts.gifter || "").slice(0, MAX_NAME);

    // at the cap, drop the oldest to make room — better to lose the one closest to finishing than to ignore a
    // giveaway that's actively taking entries
    if (f.runs.length >= MAX_RUNS){
        const dropped = f.runs.shift();
        if (dropped){
            clearRunTimers(session.userId, dropped.id);
            emitTerminal(session.userId, `FIRESALE — ${MAX_RUNS} giveaways already on screen, dropped the oldest (${dropped.prize || dropped.id}).`);
        }
    }

    f.seq = (f.seq || 0) + 1;
    const run = {
        id: `r${f.seq}`,
        phase: "running",
        startedAt: Date.now(),
        endsAt: Date.now() + seconds * 1000,
        prize,
        gifter,
        url: String(opts.url || "").slice(0, MAX_URL),
        // every winner announced for this giveaway, in the order they were announced
        winners: [] as string[],
        wonAt: 0,
        // display names in entry order; `seen` dedupes on the login so one chatter can't enter twice
        entrants: [] as string[],
        seen: new Set<string>(),
    };
    // the music is one bed for the whole batch, so the nonce (which restarts it) only moves when the overlay
    // goes from empty to busy — not every time another giveaway joins one already on screen
    if (!f.runs.length)
        f.nonce = (f.nonce || 0) + 1;
    f.runs.push(run);

    runSlots(session.userId, run.id).end = setTimeout(() => {
        try {
            beginDraw(session, run.id);
        } catch (err) {
            reportError(session.userId, "ending a firesale entry window", err);
        }
    }, seconds * 1000);

    emitTerminal(session.userId, `FIRESALE started — ${seconds}s to !${cfg.command}${prize ? ` for ${prize}` : ""}${f.runs.length > 1 ? ` (${f.runs.length} running at once)` : ""}`, true);
    pushFiresale(session);
    return run;
}

// entry window closed for one run. hold it on DRAWING… and wait for fourthwall to announce its winner, because
// that's the name that actually gets the prize. only if the announcement never comes do we pick one ourselves.
export function beginDraw(session: TimerUserSession, runId: string){
    const run = firesaleRuns(session).find((r) => r.id === runId);
    if (!run || run.phase !== "running")
        return;
    const cfg = firesaleSettings(session);
    clearRunTimers(session.userId, run.id);
    run.phase = "drawing";
    pushFiresale(session);

    runSlots(session.userId, run.id).grace = setTimeout(() => {
        try {
            const cur = firesaleRuns(session).find((r) => r.id === runId);
            if (!cur || cur.phase !== "drawing")
                return;
            if (!cur.entrants.length){
                emitTerminal(session.userId, `FIRESALE ended — nobody entered${cur.prize ? ` for ${cur.prize}` : ""}.`);
                endRun(session, cur.id);
                return;
            }
            const pick = cur.entrants[Math.floor(Math.random() * cur.entrants.length)];
            emitTerminal(session.userId, `FIRESALE — no winner announcement from Fourthwall${cur.prize ? ` for ${cur.prize}` : ""}, drew ${pick} locally.`);
            declareFiresaleWinner(session, pick, cur.id);
        } catch (err) {
            reportError(session.userId, "drawing a firesale winner", err);
        }
    }, cfg.drawGraceSec * 1000);
}

// one !enter joins every run still taking entries. returns how many it was added to (0 = nothing open, or the
// chatter is already in all of them).
export function addFiresaleEntry(session: TimerUserSession, login: string, displayName: string): number {
    const key = String(login || "").toLowerCase().trim();
    if (!key)
        return 0;
    let added = 0;
    for (const run of runningRuns(session)){
        if (run.seen.has(key) || run.entrants.length >= MAX_ENTRANTS)
            continue;
        run.seen.add(key);
        run.entrants.push(String(displayName || login).slice(0, MAX_NAME));
        added++;
    }
    if (added)
        pushSoon(session);
    return added;
}

// a winner for one run goes up in the middle; that run leaves the screen winnerHoldSec after its LAST winner
// while any other giveaways carry on. accepted from any phase of a live run: fourthwall's announcement is the
// authority, so if it lands early (clock drift, a giveaway cut short) it wins over our own countdown rather than
// being ignored.
// APPENDS rather than replaces. a giveaway of several items is announced one message per winner, all naming the
// same gifter and prize, so they all route to this same run — overwriting would flip the name on screen and leave
// only the last one. the hold restarting on each arrival is deliberate: it keeps the whole list up for the full
// hold after the last winner lands, instead of expiring while they're still trickling in.
export function declareFiresaleWinner(session: TimerUserSession, name: string, runId?: string){
    const runs = firesaleRuns(session);
    if (!runs.length)
        return;
    // no run named: take the one closest to needing a winner — the oldest already drawing, else the oldest
    const run = runId
        ? runs.find((r) => r.id === runId)
        : (runs.find((r) => r.phase === "drawing") || runs[0]);
    if (!run)
        return;
    const clean = String(name || "").replace(/^@/, "").slice(0, MAX_NAME);
    if (!clean)
        return;
    // the same announcement delivered twice must not list the same person twice
    if (run.winners.some((w: string) => w.toLowerCase() === clean.toLowerCase()))
        return;
    if (run.winners.length >= MAX_WINNERS)
        return;
    const cfg = firesaleSettings(session);
    clearRunTimers(session.userId, run.id);
    run.phase = "winner";
    run.winners.push(clean);
    run.wonAt = Date.now();
    const nth = run.winners.length;
    emitTerminal(session.userId, `FIRESALE winner${nth > 1 ? ` #${nth}` : ""}: ${clean}${run.prize ? ` — ${run.prize}` : ""} (${run.entrants.length} entered)`, true);
    pushFiresale(session);

    runSlots(session.userId, run.id).hold = setTimeout(() => {
        try {
            endRun(session, run.id);
        } catch (err) {
            reportError(session.userId, "clearing a finished firesale", err);
        }
    }, cfg.winnerHoldSec * 1000);
}

// take one run off the screen, leaving any others alone
export function endRun(session: TimerUserSession, runId: string){
    const f = getFiresale(session);
    const i = f.runs.findIndex((r: any) => r.id === runId);
    if (i === -1)
        return;
    clearRunTimers(session.userId, runId);
    f.runs.splice(i, 1);
    pushFiresale(session);
}

// clear the whole overlay. keeps the nonce/seq so the next batch is still seen as new.
export function stopFiresale(session: TimerUserSession){
    const f = getFiresale(session);
    clearAllTimers(session.userId);
    f.runs = [];
    pushFiresale(session);
}

// tear down on logout so a timer can't fire against a detached session
export function endFiresaleTimers(userId: number){
    clearAllTimers(userId);
    const t = slots(userId);
    clearTimeout(t.push);
    delete timers[userId];
}

// ---------------------------------------------------------------------------
// the "firesale <action>" command, from the dashboard terminal or from chat
// ---------------------------------------------------------------------------

// one implementation so the two can't drift. returns a line for whoever ran it, the same contract
// setTextBoxText uses.
export function runFiresaleCommand(session: TimerUserSession, cmd: { action: string, seconds: number, name: string }): { ok: boolean, message: string } {
    const cfg = firesaleSettings(session);
    const runs = firesaleRuns(session);
    if (cmd.action === "start"){
        const seconds = numIn(cmd.seconds, 5, 3600, cfg.fallbackSec);
        startFiresale(session, { seconds });
        const n = firesaleRuns(session).length;
        return { ok: true, message: `Firesale started — ${seconds}s to !${cfg.command}.${n > 1 ? ` ${n} now running at once.` : ""}` };
    }
    if (cmd.action === "stop"){
        if (!runs.length)
            return { ok: false, message: "No firesale is running." };
        const n = runs.length;
        stopFiresale(session);
        return { ok: true, message: n > 1 ? `Cleared all ${n} giveaways.` : "Firesale cleared." };
    }
    if (cmd.action === "draw"){
        const open = runningRuns(session);
        if (!open.length)
            return { ok: false, message: "No firesale is taking entries right now." };
        // closes every open giveaway: with more than one running, picking just some would be arbitrary
        for (const r of open)
            beginDraw(session, r.id);
        return {
            ok: true,
            message: open.length > 1
                ? `Entries closed on ${open.length} giveaways (${open.map((r) => `${r.prize || r.id}: ${r.entrants.length}`).join(", ")}). Waiting on Fourthwall.`
                : `Entries closed — ${open[0].entrants.length} in. Waiting on Fourthwall's winner.`,
        };
    }
    // winner
    if (!runs.length)
        return { ok: false, message: "No firesale is running." };
    const target = runs.find((r) => r.phase === "drawing") || runs[0];
    declareFiresaleWinner(session, cmd.name, target.id);
    return { ok: true, message: `Firesale winner set to ${cmd.name}${target.prize ? ` for ${target.prize}` : ""}.` };
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

    const win = parseGiveawayWinner(body);
    if (win){
        const runs = firesaleRuns(session);
        if (runs.length){
            // route it by gifter+prize — with several giveaways open, that pair is what says which one this
            // winner belongs to. no match (or a reworded announcement with nothing to match on) falls back to
            // the run closest to needing a winner, which is what declareFiresaleWinner does with no id.
            const match = win.prize
                ? runs.find((r) => sameGiveaway(r, win.gifter, win.prize))
                    || runs.find((r) => r.prize === win.prize)
                : undefined;
            if (match){
                declareFiresaleWinner(session, win.winner, match.id);
                return true;
            }
            // nothing matched. only fall back to a run that is actually WAITING for a winner — a giveaway still
            // taking entries can't be the one this announcement is about, and pinning the name to it would put
            // a wrong winner on stream while people are still entering. with none waiting, say so and leave the
            // screen alone; the operator has "Set winner" on the tab.
            // prefer a giveaway already handing out winners (a later item of a multi-item one), then one
            // still waiting on its first
            const waiting = runs.find((r) => r.phase === "winner") || runs.find((r) => r.phase === "drawing");
            if (!waiting){
                emitTerminal(session.userId, `FIRESALE — winner announcement for "${win.prize || win.winner}" matched no giveaway that's waiting on one; ignored.`);
                return true;
            }
            emitTerminal(session.userId, `FIRESALE — winner announcement for "${win.prize || win.winner}" didn't match on name; applying it to "${waiting.prize || waiting.id}", which was waiting.`);
            declareFiresaleWinner(session, win.winner, waiting.id);
        }
        return true;
    }

    const start = parseGiveawayStart(body);
    if (start){
        if (!cfg.enabled){
            emitTerminal(session.userId, `Fourthwall giveaway detected, but the firesale overlay is turned off.`);
            return true;
        }
        // the same announcement delivered twice (a chat reconnect can replay one) must not open a second run
        // for the same giveaway
        if (start.prize && firesaleRuns(session).some((r) => r.phase === "running" && sameGiveaway(r, start.gifter, start.prize)))
            return true;
        startFiresale(session, { seconds: start.seconds || cfg.fallbackSec, prize: start.prize, gifter: start.gifter, url: start.url });
        return true;
    }

    return false;
}
