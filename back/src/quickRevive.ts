// quick revive: a timed challenge the operator starts by hand from the mystery box tab. chat is given so many
// seconds to put up so many SUB POINTS, and the /mysterybox browser source shows the clock running down and
// the points climbing. hit the goal and the win sound plays and the win message goes up; run out of time and
// the fail sound and message do instead. nothing else happens — it's a moment on stream, not a prize.
//
// sub points are weighted the way twitch weights them for the sub-count sources (and the way the /subcount
// "subpoints" number reads): a tier 1 or prime sub is 1, tier 2 is 2, tier 3 is 6. a gift bomb of five tier
// 1s is 5. a youtube or kick membership has no tiers to weigh, so it's 1 each.
//
// LIVE STATE ONLY. the settings (how long, how many, which sounds) ride the mystery box config blob, so they
// persist with it; the run itself never does — a process that dies mid-challenge comes back idle, like a
// firesale or a spin does. there is no wallet here and nothing owed, so there's nothing to lose by that.
//
// one at a time, and never on top of a box: the source is one frame, and a reel spinning behind a countdown
// would be two things shouting at once. mysterybox.ts refuses "!mb open" while this runs for the same reason.
//
// THE SAME MACHINERY RUNS THE CHANT PRIZE. "say movies 20 times in 60 seconds for +5 minutes" is the same
// thing with a different counter: a clock, a goal, a number climbing toward it, a win and a fail. so a run
// is a CHALLENGE with a spec — what's being counted, what the words on screen are, what winning pays — and
// the quick revive is one spec (built from the tab's settings) while a chant prize is another (built from the
// prize that landed). the source draws both the same way and the tab watches both the same way.
//
// a chant prize is ROUNDS of that, warioware-style: it carries a list of chants, each round draws one at
// random, clearing it starts the next straight away with a fresh clock, and only the last one pays. failing
// any round fails the lot.

import { TimerUserSession, TimerEvent } from "./types";
import { emitQuickRevive, emitTerminal, reportError } from "./bus";
import { chatAnnounce } from "./chat";
import { addToEndTime } from "./timer";

const MAX_PATH = 300;
const MAX_TEXT = 80;

export const DEFAULT_QUICK_REVIVE = {
    // how long chat gets, in seconds
    seconds: 60,
    // how many sub points they have to put up in that time
    points: 10,
    // the heading on stream while it runs
    title: "QUICK REVIVE",
    // a file in public/media, looped for as long as the clock is running. stops the moment it's decided.
    music: "",
    musicVolume: 0.6,
    // one-shots and the words that go up with them
    winSound: "",
    winVolume: 1,
    winText: "REVIVED!",
    failSound: "",
    failVolume: 1,
    failText: "YOU DIED",
    // how long the result stays on screen before the source goes back to drawing nothing
    holdSec: 8,
    // call the start and the result out in chat, as highlighted twitch announcements (through the bot
    // account, or to the terminal without one). if twitch won't take an announcement from this bot — missing
    // permission, not a mod — chat.ts sends the same line as a plain message instead.
    announce: true,
};

function str(v: any, max: number): string {
    return typeof v === "string" ? v.slice(0, max) : "";
}

function numIn(v: any, min: number, max: number, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function vol(v: any, fallback: number): number {
    return Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : fallback));
}

export function normalizeQuickRevive(raw: any): any {
    const d = DEFAULT_QUICK_REVIVE;
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        seconds: numIn(r.seconds, 5, 3600, d.seconds),
        points: numIn(r.points, 1, 100000, d.points),
        title: str(r.title, MAX_TEXT).trim() || d.title,
        music: str(r.music, MAX_PATH),
        musicVolume: vol(r.musicVolume, d.musicVolume),
        winSound: str(r.winSound, MAX_PATH),
        winVolume: vol(r.winVolume, d.winVolume),
        winText: str(r.winText, MAX_TEXT).trim() || d.winText,
        failSound: str(r.failSound, MAX_PATH),
        failVolume: vol(r.failVolume, d.failVolume),
        failText: str(r.failText, MAX_TEXT).trim() || d.failText,
        holdSec: numIn(r.holdSec, 1, 60, d.holdSec),
        announce: r.announce === undefined ? d.announce : !!r.announce,
    };
}

// the settings live inside the mystery box blob (mysterybox.ts normalizes them in with the rest), so this
// only ever reads; it never has to create the parent.
export function qrSettings(session: TimerUserSession): any {
    const mb = session.mysteryBoxSettings;
    return (mb && mb.quickRevive) || normalizeQuickRevive(null);
}

// ---------------------------------------------------------------------------
// what a sub is worth
// ---------------------------------------------------------------------------

// twitch's own weighting, the one its sub-points figure uses. anything that isn't a sub or a membership is
// worth nothing here — bits and donations are somebody else's game.
export function subPointsFor(event: TimerEvent): number {
    const count = Math.max(1, Math.trunc(Number(event.count) || 1));
    if (event.platform === "twitch" && event.kind === "sub"){
        const tier = Math.trunc(Number(event.tier) || 1);
        const each = tier >= 3 ? 6 : tier === 2 ? 2 : 1;
        return each * count;
    }
    if ((event.platform === "youtube" || event.platform === "kick") && event.kind === "member")
        return count;
    return 0;
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

// everything a run needs to know about itself, fixed at the start. it's copied onto the live state rather
// than read back from the settings while it runs, so retuning the tab mid-run can't move the goalposts.
export interface ChallengeSpec {
    // what's being counted: sub points (the quick revive) or chat lines saying a phrase (the chant prize)
    kind: "subpoints" | "chant"
    title: string
    // an instruction line under the title, for a run whose title alone doesn't say what to do
    subtitle: string
    // the counter's label on screen, e.g. "SUB POINTS" / "TIMES SAID"
    unit: string
    seconds: number
    goal: number
    music: string
    musicVolume: number
    winSound: string
    winVolume: number
    winText: string
    failSound: string
    failVolume: number
    failText: string
    holdSec: number
    announce: boolean
    // chant only: what chat has to say THIS ROUND (drawn from `chants`), and what clearing every round buys
    // (seconds on the timer). `seconds` and `goal` above are this round's too.
    phrase: string
    rewardSeconds: number
    // chant only: the lines have to be CONSECUTIVE — any line that doesn't say the phrase puts the count
    // back to zero. off = every line that says it counts, whatever comes between.
    streak: boolean
    // chant only: how many rounds have to be cleared, and the pool each round is drawn from
    rounds: number
    chants: Chant[]
    // how the reward shows up in the timer log
    label: string
}

// one thing chat can be asked to say: the phrase, how many lines have to say it, and how long they get
export interface Chant {
    phrase: string
    times: number
    seconds: number
}

// phase timers per user, off the session for the usual reason: a Timeout is not state anyone should serialize
// or sync, and ending a run must never leave one behind.
const timers: { [userId: number]: { end?: any, done?: any } } = {};

function slots(userId: number){
    return timers[userId] || (timers[userId] = {});
}

export function getQuickRevive(session: TimerUserSession): any {
    if (!session.quickRevive || typeof session.quickRevive !== "object")
        session.quickRevive = { nonce: 0, phase: "idle", startedAt: 0, endsAt: 0, goal: 0, points: 0, resultAt: 0, resetAt: 0, round: 0, roundAt: 0, lastChant: -1, spec: null };
    return session.quickRevive;
}

// is a challenge on screen right now? this is what mysterybox.ts checks before letting a box open.
export function isReviving(session: TimerUserSession): boolean {
    return getQuickRevive(session).phase !== "idle";
}

// the quick revive as a spec, straight off the tab's settings
function quickReviveSpec(session: TimerUserSession): ChallengeSpec {
    const cfg = qrSettings(session);
    return {
        kind: "subpoints",
        title: cfg.title,
        subtitle: "",
        unit: "SUB POINTS",
        seconds: cfg.seconds,
        goal: cfg.points,
        music: cfg.music,
        musicVolume: cfg.musicVolume,
        winSound: cfg.winSound,
        winVolume: cfg.winVolume,
        winText: cfg.winText,
        failSound: cfg.failSound,
        failVolume: cfg.failVolume,
        failText: cfg.failText,
        holdSec: cfg.holdSec,
        announce: cfg.announce,
        phrase: "",
        rewardSeconds: 0,
        streak: false,
        rounds: 1,
        chants: [],
        label: "quick revive",
    };
}

// "5 minutes" / "90 seconds", for the words on screen and in chat
export function sayTime(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s >= 60 && s % 60 === 0)
        return `${s / 60} minute${s === 60 ? "" : "s"}`;
    return `${s} second${s === 1 ? "" : "s"}`;
}

// the instruction line for a chant round, rebuilt each time because the round changes what it says
function chantSubtitle(spec: ChallengeSpec): string {
    return `SAY "${String(spec.phrase).toUpperCase()}" ${spec.goal} TIME${spec.goal === 1 ? "" : "S"}${spec.streak ? " IN A ROW" : ""}`
        + (spec.rewardSeconds > 0 && spec.rounds <= 1 ? ` FOR +${sayTime(spec.rewardSeconds).toUpperCase()}` : "");
}

export function quickReviveView(session: TimerUserSession): any {
    const qr = getQuickRevive(session);
    // idle carries the quick revive's own words, so a source has sensible defaults to hand before anything runs
    const spec: ChallengeSpec = qr.spec || quickReviveSpec(session);
    return {
        // warioware-style rounds: which one this is, of how many, and when it began (the source pops the new
        // instruction in on that). a single-round challenge reports 1 of 1 and the source shows no counter.
        round: qr.round || 0,
        rounds: spec.rounds || 1,
        roundAt: qr.roundAt || 0,
        active: qr.phase !== "idle",
        nonce: qr.nonce,
        // running -> won | lost -> idle
        phase: qr.phase,
        kind: spec.kind,
        startedAt: qr.startedAt,
        endsAt: qr.endsAt,
        goal: qr.goal,
        points: qr.points,
        // when it was decided, so a source that connects while the result is already up doesn't replay the
        // sound — the same guard the reel puts on its prize sound
        resultAt: qr.resultAt,
        // when a streak was last broken, so the source can flinch the count as it drops to zero
        resetAt: qr.resetAt || 0,
        title: spec.title,
        subtitle: spec.kind === "chant" ? chantSubtitle(spec) : spec.subtitle,
        unit: spec.unit,
        music: spec.music,
        musicVolume: spec.musicVolume,
        winSound: spec.winSound,
        winVolume: spec.winVolume,
        winText: spec.winText,
        failSound: spec.failSound,
        failVolume: spec.failVolume,
        failText: spec.failText,
        holdSec: spec.holdSec,
    };
}

export function pushQuickRevive(session: TimerUserSession){
    emitQuickRevive(session.userId, quickReviveView(session));
}

// start the clock on a spec. `fromPrize` is a challenge a landing prize started: that one is allowed to begin
// while the reel is still showing the prize (the source draws it over the top), where a hand-started one is
// refused until the box on screen has finished.
export function startChallenge(session: TimerUserSession, spec: ChallengeSpec, fromPrize = false): { ok: boolean, message: string } {
    if (isReviving(session))
        return { ok: false, message: "A challenge is already running." };
    const mb = session.mysterybox;
    if (!fromPrize && mb && mb.phase && mb.phase !== "idle")
        return { ok: false, message: "A mystery box is being opened — wait for it to land." };
    if (spec.kind === "chant" && !spec.chants.length)
        return { ok: false, message: "That chant has nothing for chat to say — add a chant to it." };
    const qr = getQuickRevive(session);
    const now = Date.now();
    qr.nonce = (qr.nonce || 0) + 1;
    qr.phase = "running";
    qr.spec = spec;
    qr.startedAt = now;
    qr.endsAt = now + spec.seconds * 1000;
    qr.goal = spec.goal;
    qr.points = 0;
    qr.resultAt = 0;
    qr.resetAt = 0;
    qr.round = 1;
    qr.roundAt = now;
    qr.lastChant = -1;
    const t = slots(session.userId);
    clearTimeout(t.done);
    if (spec.kind === "chant"){
        dealChant(session, qr, spec);
        const rounds = spec.rounds > 1 ? ` (${spec.rounds} rounds)` : "";
        emitTerminal(session.userId, `${spec.title}${rounds} — round 1: chat has ${spec.seconds}s to say "${spec.phrase}" ${spec.goal} time${spec.goal === 1 ? "" : "s"}${spec.rewardSeconds > 0 ? `; clear ${spec.rounds > 1 ? "them all" : "it"} for +${sayTime(spec.rewardSeconds)}` : ""}.`, true);
        if (spec.announce)
            chatAnnounce(session, `${spec.title}!${spec.rounds > 1 ? ` ${spec.rounds} rounds —` : ""} ${roundWords(spec)}${spec.rewardSeconds > 0 ? ` Clear ${spec.rounds > 1 ? "every round" : "it"} and ${sayTime(spec.rewardSeconds)} goes on the timer.` : ""} Go!`, "blue");
        return { ok: true, message: `${spec.title} started — ${spec.rounds} round${spec.rounds === 1 ? "" : "s"}, first up "${spec.phrase}" x${spec.goal} in ${spec.seconds}s.` };
    }
    const goalWords = `${spec.goal} ${spec.unit.toLowerCase()}`;
    armClock(session, spec.seconds);
    emitTerminal(session.userId, `QUICK REVIVE — chat has ${spec.seconds}s to put up ${goalWords}.`, true);
    if (spec.announce)
        chatAnnounce(session, `${spec.title}! Chat has ${spec.seconds} seconds to hit ${spec.goal} sub point${spec.goal === 1 ? "" : "s"} — Tier 1 = 1, Tier 2 = 2, Tier 3 = 6. Go!`, "blue");
    pushQuickRevive(session);
    return { ok: true, message: `${spec.title} started — ${spec.seconds}s for ${goalWords}.` };
}

// the instruction for the current round, as chat is told it
function roundWords(spec: ChallengeSpec): string {
    return `Say "${spec.phrase}" ${spec.goal} time${spec.goal === 1 ? "" : "s"}${spec.streak ? " in a row (anything else resets it)" : ""} within ${spec.seconds} seconds.`;
}

// the round's clock: one timer per user, re-armed for every round, so a cleared round's deadline can't fire
// into the next one
function armClock(session: TimerUserSession, seconds: number){
    const t = slots(session.userId);
    clearTimeout(t.end);
    t.end = setTimeout(() => {
        try {
            decide(session, false);
        } catch (err) {
            reportError(session.userId, "ending a challenge", err);
            endQuickRevive(session);
        }
    }, seconds * 1000);
}

// draw this round's chant and put it on the clock. at random, but never the one just cleared when there is
// a choice — the same phrase twice running reads as the draw being stuck rather than as chance.
function dealChant(session: TimerUserSession, qr: any, spec: ChallengeSpec){
    const pool = spec.chants.map((c, i) => i).filter((i) => spec.chants.length < 2 || i !== qr.lastChant);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const c = spec.chants[pick];
    qr.lastChant = pick;
    spec.phrase = c.phrase;
    spec.seconds = c.seconds;
    spec.goal = c.times;
    qr.goal = c.times;
    qr.points = 0;
    qr.resetAt = 0;
    qr.endsAt = Date.now() + c.seconds * 1000;
    armClock(session, c.seconds);
    pushQuickRevive(session);
}

// the tab's button and "mb revive": the quick revive, with whatever the tab has set
export function startQuickRevive(session: TimerUserSession): { ok: boolean, message: string } {
    if (isReviving(session))
        return { ok: false, message: "A quick revive is already running." };
    return startChallenge(session, quickReviveSpec(session));
}

// one more toward the goal. shared by both counters; decides the run the moment the goal is met.
function credit(session: TimerUserSession, qr: any, n: number){
    // the deadline is checked here as well as by the timer, so something arriving in the same tick the clock
    // ran out can't be counted after the fact
    if (Date.now() >= qr.endsAt)
        return;
    qr.points += n;
    pushQuickRevive(session);
    if (qr.points >= qr.goal)
        decide(session, true);
}

// a sub landed. called from events.ts for every sub and membership, typed ones included — a mod adding a
// sub the bot missed is still a sub chat put up, and it's also how the operator rehearses this from the
// terminal ("twitch sub_t3 2") without waiting on a real one.
export function creditQuickRevive(session: TimerUserSession, event: TimerEvent){
    const qr = getQuickRevive(session);
    if (qr.phase !== "running" || !qr.spec || qr.spec.kind !== "subpoints")
        return;
    const pts = subPointsFor(event);
    if (pts)
        credit(session, qr, pts);
}

// a chat line arrived. a line that contains the phrase counts ONCE, however many times it repeats it — so
// "movies movies movies" is one, and the count is how many messages chat sent, which is what "say it 20
// times" means to the people typing. matched loosely on purpose: case doesn't matter, and the phrase inside
// a longer sentence still counts, because "MOVIES!!!" and "we want movies" are people doing what was asked.
// anyone may chant, and the same person as often as they like: this is a race, and spam is the point of it.
//
// with `streak` on, a line that DOESN'T say it puts the count back to zero — chat has to hold the line, and
// one person typing anything else costs everybody. the bot's own lines are ignored either way: it announces
// the chant and reports the result in this same chat, and must not be the one to break it.
export function creditChant(session: TimerUserSession, text: string, login = ""){
    const qr = getQuickRevive(session);
    if (qr.phase !== "running" || !qr.spec || qr.spec.kind !== "chant")
        return;
    const spec: ChallengeSpec = qr.spec;
    const want = String(spec.phrase || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!want)
        return;
    const bot = String((session.connections && session.connections.twitchBot && session.connections.twitchBot.botLogin) || "").toLowerCase();
    if (bot && String(login || "").toLowerCase() === bot)
        return;
    const said = String(text || "").toLowerCase().replace(/\s+/g, " ");
    if (said.includes(want)){
        credit(session, qr, 1);
        return;
    }
    if (spec.streak && qr.points > 0 && Date.now() < qr.endsAt){
        qr.points = 0;
        qr.resetAt = Date.now();
        pushQuickRevive(session);
    }
}

// the clock stops, one way or the other. the sound and the words are the source's job; this says which, and
// pays out a chant's reward — the one thing a challenge does to the rest of the app.
function decide(session: TimerUserSession, won: boolean){
    const qr = getQuickRevive(session);
    if (qr.phase !== "running" || !qr.spec)
        return;
    const spec: ChallengeSpec = qr.spec;
    const t = slots(session.userId);
    clearTimeout(t.end);
    t.end = undefined;
    const now = Date.now();
    const spare = Math.max(0, Math.round((qr.endsAt - now) / 1000));
    // a round cleared with more to go: straight into the next one, new chant, fresh clock. nothing is paid
    // yet — that's the last round's job.
    if (won && spec.kind === "chant" && qr.round < spec.rounds){
        const cleared = `round ${qr.round} of ${spec.rounds}`;
        qr.round += 1;
        qr.roundAt = now;
        dealChant(session, qr, spec);
        emitTerminal(session.userId, `${spec.title} — ${cleared} cleared with ${spare}s to spare. Round ${qr.round}: "${spec.phrase}" x${spec.goal} in ${spec.seconds}s.`, true);
        if (spec.announce)
            chatAnnounce(session, `Round ${qr.round - 1} cleared! Round ${qr.round} of ${spec.rounds}: ${roundWords(spec)}`, "blue");
        return;
    }
    qr.phase = won ? "won" : "lost";
    qr.resultAt = now;
    pushQuickRevive(session);
    const tag = spec.kind === "chant" ? spec.title : "QUICK REVIVE";
    const tally = spec.kind === "chant"
        ? `"${spec.phrase}" ${qr.points} of ${qr.goal} time${qr.goal === 1 ? "" : "s"}${spec.rounds > 1 ? ` in round ${qr.round} of ${spec.rounds}` : ""}`
        : `${qr.points} of ${qr.goal} sub point${qr.goal === 1 ? "" : "s"}`;
    if (won){
        // the reward goes through the timer's own path — cap, stop-at-zero and the log all apply, exactly as
        // they would to an "add time" prize
        const paid = spec.kind === "chant" && spec.rewardSeconds > 0 ? ` +${sayTime(spec.rewardSeconds)} on the timer.` : "";
        emitTerminal(session.userId, `${tag} — ${spec.winText} chat ${spec.kind === "chant" ? "said" : "hit"} ${tally} with ${spare}s to spare.${paid}`, true);
        if (spec.announce)
            chatAnnounce(session, `${spec.winText} Chat ${spec.kind === "chant" ? "said" : "hit"} ${tally} with ${spare} second${spare === 1 ? "" : "s"} to spare!${paid}`, "green");
        if (spec.kind === "chant" && spec.rewardSeconds > 0){
            try {
                addToEndTime(session, spec.rewardSeconds, spec.label);
            } catch (err) {
                reportError(session.userId, "paying out a chant's time", err);
            }
        }
    } else {
        emitTerminal(session.userId, `${tag} — ${spec.failText} chat ${spec.kind === "chant" ? "said" : "got"} ${tally}.`);
        if (spec.announce)
            chatAnnounce(session, `${spec.failText} Chat ${spec.kind === "chant" ? "said" : "got"} ${tally} before the clock ran out.`, "orange");
    }
    clearTimeout(t.done);
    t.done = setTimeout(() => {
        try {
            endQuickRevive(session);
        } catch (err) {
            reportError(session.userId, "clearing a finished challenge", err);
        }
    }, spec.holdSec * 1000);
}

// back to idle: the source draws nothing and a box can be opened again. also the operator's Cancel.
export function endQuickRevive(session: TimerUserSession){
    const qr = getQuickRevive(session);
    const t = slots(session.userId);
    clearTimeout(t.end);
    clearTimeout(t.done);
    t.end = t.done = undefined;
    const wasRunning = qr.phase === "running";
    const tag = qr.spec && qr.spec.kind === "chant" ? qr.spec.title : "QUICK REVIVE";
    qr.phase = "idle";
    qr.spec = null;
    qr.startedAt = 0;
    qr.endsAt = 0;
    qr.goal = 0;
    qr.points = 0;
    qr.resultAt = 0;
    qr.resetAt = 0;
    qr.round = 0;
    qr.roundAt = 0;
    qr.lastChant = -1;
    if (wasRunning)
        emitTerminal(session.userId, `${tag} — called off.`, true);
    pushQuickRevive(session);
}

// tear down on logout so a phase timer can't fire against a detached session
export function endQuickReviveTimers(userId: number){
    const t = slots(userId);
    clearTimeout(t.end);
    clearTimeout(t.done);
    delete timers[userId];
}
