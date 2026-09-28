// drops: power-ups that fall out of the timer, cod zombies style. every contribution that puts time on the
// clock has a small chance (0.5% out of the box) of dropping one. a drop names its reward up front, then chat
// has to clear a minigame to grab it — say a word so many times, count from one number to another, put up so
// many sub points, or be first to unscramble a word. clear it in time and the reward fires, the same way a
// mystery box prize does (applyEffect). miss it and it's gone.
//
// it rides the quick revive's challenge engine and the /mysterybox browser source, so the overlay, the clock,
// the music and the result sounds are the ones chat already knows.
//
// THE HOUR. at most maxPerHour drops land in any one hour, and the hours are snapped to US eastern time. the
// eastern offset is a whole number of hours, so its hours begin on the same instant as utc's do — which is
// why the key below is just the hour since the epoch, and why a daylight saving change can't fold two hours
// into one.
//
// THE FLOOR. so a quiet hour of rolls still shows chat a drop, each hour draws a secret number of minutes
// between guaranteeMin and guaranteeMax. the contribution that carries the hour's added time past it is a
// drop, no roll needed. that drop is indistinguishable from a rolled one — same draw, same overlay, same chat
// lines — so chat never learns the floor is there. only the terminal says which it was.
//
// ONE AT A TIME, like everything on that source. a drop that lands while the overlay is busy (a box opening,
// a challenge, a firesale or raffle) waits in a queue and goes up as soon as it's free, and a queued drop
// holds new box opens back so it can't be starved.
//
// the settings persist (dropSettings); so does the hour's tally (dropState), so a restart mid-hour can't hand
// out a fifth drop or roll a fresh floor. the queue and the drop on screen are live state and die with the
// process, like a spin does.

import { TimerUserSession, TimerEvent } from "./types";
import { emitSync, emitTerminal, reportError } from "./bus";
import { applyEffect, normalizePrizes, isOpening } from "./mysterybox";
import { startChallenge, isReviving, endQuickRevive, ChallengeSpec } from "./quickRevive";

const MAX_REWARDS = 30;
const MAX_GAMES = 30;
const MAX_WORDS = 50;
const MAX_WORD = 60;
const MAX_PATH = 300;
const MAX_TEXT = 80;
const MAX_QUEUE = 10;
const HOUR_MS = 3600 * 1000;
// how often a waiting drop checks whether the overlay has come free
const PUMP_MS = 2000;

// the rewards that ARE a minigame of their own. a drop is already a challenge, and the source runs one at a
// time, so one of these as the prize would be turned away the moment it was won.
const NOT_A_DROP = ["chant", "infection"];

export const GAME_KINDS = ["chant", "count", "subpoints", "scramble"];

export const DEFAULT_DROPS = {
    enabled: false,
    // percent chance per contribution
    chance: 0.5,
    maxPerHour: 4,
    // the secret floor, in minutes of time added within the hour
    guaranteeEnabled: true,
    guaranteeMin: 45,
    guaranteeMax: 60,
    // the heading over the reward on stream
    title: "DROP!",
    // the sting as a drop appears, the loop while chat plays for it, and the result one-shots
    dropSound: "",
    dropVolume: 1,
    music: "",
    musicVolume: 0.6,
    winSound: "",
    winVolume: 1,
    winText: "GRABBED IT!",
    failSound: "",
    failVolume: 1,
    failText: "TOO SLOW!",
    holdSec: 8,
    announce: true,
    rewards: [] as any[],
    games: [] as any[],
};

export const DEFAULT_GAME = {
    name: "",
    enabled: true,
    kind: "chant",
    seconds: 60,
    // chant: the phrases, one drawn per drop. scramble: the words, likewise.
    words: [] as string[],
    times: 20,
    streak: false,
    from: 1,
    to: 50,
    resetOnMistake: true,
    points: 10,
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

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function normalizeGame(raw: any, i: number): any | null {
    if (!raw || typeof raw !== "object")
        return null;
    const d = DEFAULT_GAME;
    return {
        id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 100) : `g${i + 1}`,
        name: str(raw.name, 60).trim(),
        enabled: raw.enabled === undefined ? d.enabled : !!raw.enabled,
        kind: GAME_KINDS.includes(raw.kind) ? raw.kind : d.kind,
        seconds: numIn(raw.seconds, 5, 3600, d.seconds),
        words: Array.isArray(raw.words)
            ? raw.words
                .map((w: any) => str(w, MAX_WORD).trim())
                .filter((w: string, j: number, all: string[]) => w && all.indexOf(w) === j)
                .slice(0, MAX_WORDS)
            : [],
        times: numIn(raw.times, 1, 10000, d.times),
        streak: !!raw.streak,
        from: numIn(raw.from, -100000, 100000, d.from),
        to: numIn(raw.to, -100000, 100000, d.to),
        resetOnMistake: raw.resetOnMistake === undefined ? d.resetOnMistake : !!raw.resetOnMistake,
        points: numIn(raw.points, 1, 100000, d.points),
    };
}

function normalizeGames(raw: any): any[] {
    if (!Array.isArray(raw))
        return [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length && out.length < MAX_GAMES; i++){
        const g = normalizeGame(raw[i], i);
        if (!g)
            continue;
        if (seen.has(g.id))
            g.id = `${g.id}_${i}`;
        seen.add(g.id);
        out.push(g);
    }
    return out;
}

export function normalizeDrops(raw: any): any {
    const d = DEFAULT_DROPS;
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const lo = numIn(r.guaranteeMin, 1, 600, d.guaranteeMin);
    const chance = Number(r.chance);
    return {
        enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
        chance: Number.isFinite(chance) ? Math.min(100, Math.max(0, Math.round(chance * 100) / 100)) : d.chance,
        maxPerHour: numIn(r.maxPerHour, 1, 60, d.maxPerHour),
        guaranteeEnabled: r.guaranteeEnabled === undefined ? d.guaranteeEnabled : !!r.guaranteeEnabled,
        guaranteeMin: lo,
        guaranteeMax: Math.max(lo, numIn(r.guaranteeMax, 1, 600, d.guaranteeMax)),
        title: str(r.title, MAX_TEXT).trim() || d.title,
        dropSound: str(r.dropSound, MAX_PATH),
        dropVolume: vol(r.dropVolume, d.dropVolume),
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
        // the mystery box's own prize shape, so the same effects apply — minus the ones that are games
        rewards: normalizePrizes(r.rewards).slice(0, MAX_REWARDS).map((p: any) => {
            if (NOT_A_DROP.includes(p.effect.kind))
                p.effect.kind = "none";
            p.profile = "";
            return p;
        }),
        games: normalizeGames(r.games),
    };
}

export function dropSettings(session: TimerUserSession): any {
    return session.dropSettings || (session.dropSettings = normalizeDrops(null));
}

// a game that can actually be played: the phrase or word games need something to say
function playable(g: any): boolean {
    if (!g.enabled)
        return false;
    if (g.kind === "chant" || g.kind === "scramble")
        return g.words.length > 0;
    if (g.kind === "count")
        return g.from !== g.to;
    return true;
}

function winnableRewards(session: TimerUserSession): any[] {
    return dropSettings(session).rewards.filter((p: any) => p.enabled && p.weight > 0);
}

function playableGames(session: TimerUserSession): any[] {
    return dropSettings(session).games.filter(playable);
}

// ---------------------------------------------------------------------------
// the hour
// ---------------------------------------------------------------------------

function hourOf(ms: number): number {
    return Math.floor(ms / HOUR_MS);
}

function rollThreshold(cfg: any): number {
    const lo = cfg.guaranteeMin, hi = cfg.guaranteeMax;
    return (lo + Math.floor(Math.random() * (hi - lo + 1))) * 60;
}

export function normalizeDropState(raw: any): any {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        hour: numIn(r.hour, 0, Number.MAX_SAFE_INTEGER, 0),
        drops: numIn(r.drops, 0, 1000, 0),
        seconds: numIn(r.seconds, 0, 1000 * 3600, 0),
        threshold: numIn(r.threshold, 0, 1000 * 3600, 0),
        guaranteed: !!r.guaranteed,
    };
}

// this hour's tally, starting a fresh one (and drawing its floor) the first time it's asked for in a new hour
function hourState(session: TimerUserSession): any {
    const cfg = dropSettings(session);
    const now = hourOf(Date.now());
    const st = session.dropState || (session.dropState = normalizeDropState(null));
    if (st.hour !== now){
        st.hour = now;
        st.drops = 0;
        st.seconds = 0;
        st.guaranteed = false;
        st.threshold = rollThreshold(cfg);
    }
    // the range was changed since this hour's floor was drawn: draw it again inside the new one
    if (st.threshold < cfg.guaranteeMin * 60 || st.threshold > cfg.guaranteeMax * 60)
        st.threshold = rollThreshold(cfg);
    return st;
}

// the start of an hour, as a time on the eastern clock
function easternHour(hour: number): string {
    try {
        return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: true }).format(new Date(hour * HOUR_MS));
    } catch {
        return "";
    }
}

// what the tab shows. the floor is the operator's to know, so it's here; it's never on the overlay or in chat.
export function dropView(session: TimerUserSession): any {
    const cfg = dropSettings(session);
    const st = hourState(session);
    return {
        hourStart: st.hour * HOUR_MS,
        hourLabel: `${easternHour(st.hour)}–${easternHour(st.hour + 1)} ET`,
        drops: st.drops,
        maxPerHour: cfg.maxPerHour,
        minutes: Math.floor(st.seconds / 60),
        threshold: Math.round(st.threshold / 60),
        guaranteed: st.guaranteed,
        queued: Array.isArray(session.dropQueue) ? session.dropQueue.length : 0,
        up: isDropUp(session),
    };
}

function isDropUp(session: TimerUserSession): boolean {
    const qr = session.quickRevive;
    return !!(qr && qr.phase && qr.phase !== "idle" && qr.spec && qr.spec.dropName);
}

// ---------------------------------------------------------------------------
// rolling for one
// ---------------------------------------------------------------------------

// every contribution comes through here from events.ts with the seconds it actually put on the clock (after
// rates, boosts and the cap). the hour's added time is counted whether or not a drop can land, so the floor
// is judged on what chat really gave.
export function rollForDrop(session: TimerUserSession, event: TimerEvent, addedSeconds: number){
    const cfg = dropSettings(session);
    if (!cfg.enabled || !(addedSeconds > 0))
        return;
    const st = hourState(session);
    const before = st.seconds;
    st.seconds += Math.round(addedSeconds);
    const crossed = cfg.guaranteeEnabled && !st.guaranteed && before < st.threshold && st.seconds >= st.threshold;
    if (crossed)
        st.guaranteed = true;
    if (st.drops >= cfg.maxPerHour)
        return;
    const rolled = Math.random() * 100 < cfg.chance;
    if (!crossed && !rolled)
        return;
    if (!winnableRewards(session).length || !playableGames(session).length){
        emitTerminal(session.userId, `DROP — one would have dropped (${event.label}), but ${!winnableRewards(session).length ? "no reward is set up" : "no minigame is set up"} on the Drops tab.`);
        return;
    }
    st.drops += 1;
    emitTerminal(session.userId, `DROP — ${crossed ? `guaranteed: ${Math.floor(st.seconds / 60)} minutes added this hour passed the ${Math.round(st.threshold / 60)}-minute floor` : `rolled on ${event.label}`} (${st.drops} of ${cfg.maxPerHour} this hour).`, true);
    queueDrop(session, crossed ? "guaranteed" : "rolled");
}

// ---------------------------------------------------------------------------
// the queue
// ---------------------------------------------------------------------------

const pumps: { [userId: number]: any } = {};

function queue(session: TimerUserSession): any[] {
    return Array.isArray(session.dropQueue) ? session.dropQueue : (session.dropQueue = []);
}

function queueDrop(session: TimerUserSession, why: string, rewardId = "", gameId = ""){
    const q = queue(session);
    if (q.length >= MAX_QUEUE){
        emitTerminal(session.userId, `DROP — ${q.length} already waiting; this one was dropped.`);
        return;
    }
    q.push({ why, rewardId, gameId, at: Date.now() });
    pump(session);
    emitSync(session.userId);
}

// the overlay is somebody else's right now
function overlayBusy(session: TimerUserSession): string {
    if (isOpening(session))
        return "a mystery box is being opened";
    if (isReviving(session))
        return "a challenge is on screen";
    const f = session.firesale;
    if (f && Array.isArray(f.runs) && f.runs.length)
        return "a firesale is running";
    if (session.raffle && session.raffle.run)
        return "a raffle is running";
    return "";
}

function pump(session: TimerUserSession){
    const q = queue(session);
    clearTimeout(pumps[session.userId]);
    pumps[session.userId] = undefined;
    if (!q.length || session.loggedOut)
        return;
    if (!overlayBusy(session)){
        const next = q.shift();
        try {
            const res = startDrop(session, next.rewardId, next.gameId, false);
            if (!res.ok)
                emitTerminal(session.userId, `DROP — ${res.message}`);
        } catch (err) {
            reportError(session.userId, "starting a drop", err);
        }
        emitSync(session.userId);
    }
    if (q.length)
        pumps[session.userId] = setTimeout(() => pump(session), PUMP_MS);
}

export function clearDropQueue(session: TimerUserSession): number {
    const n = queue(session).length;
    session.dropQueue = [];
    clearTimeout(pumps[session.userId]);
    pumps[session.userId] = undefined;
    emitSync(session.userId);
    return n;
}

export function endDropTimers(userId: number){
    clearTimeout(pumps[userId]);
    delete pumps[userId];
}

// ---------------------------------------------------------------------------
// putting one up
// ---------------------------------------------------------------------------

function pick<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
}

function drawReward(session: TimerUserSession): any | null {
    const pool = winnableRewards(session);
    if (!pool.length)
        return null;
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    for (const p of pool){
        roll -= p.weight;
        if (roll < 0)
            return p;
    }
    return pool[pool.length - 1];
}

// shuffle each word's letters, keeping the spaces where they are, and never hand back the word as it was
// when there's any other way to arrange it
export function scramble(word: string): string {
    const shuffle = (w: string) => {
        const a = w.split("");
        for (let i = a.length - 1; i > 0; i--){
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a.join("");
    };
    const up = word.toUpperCase();
    if (new Set(up.replace(/\s/g, "").split("")).size < 2)
        return up;
    for (let tries = 0; tries < 20; tries++){
        const out = up.split(" ").map(shuffle).join(" ");
        if (out !== up)
            return out;
    }
    return up.split("").reverse().join("");
}

function gameSpec(cfg: any, reward: any, game: any, test: boolean): ChallengeSpec {
    const word = game.words.length ? pick(game.words) as string : "";
    const base: ChallengeSpec = {
        kind: game.kind,
        title: reward.name || "DROP",
        subtitle: "",
        unit: "",
        seconds: game.seconds,
        goal: 1,
        music: cfg.music,
        musicVolume: cfg.musicVolume,
        // the reward's own sound, when it has one, is what plays as it's grabbed
        winSound: reward.sound || cfg.winSound,
        winVolume: reward.sound ? reward.volume : cfg.winVolume,
        winText: cfg.winText,
        failSound: cfg.failSound,
        failVolume: cfg.failVolume,
        failText: cfg.failText,
        holdSec: cfg.holdSec,
        announce: cfg.announce && !test,
        phrase: "",
        rewardSeconds: 0,
        streak: false,
        rounds: 1,
        chants: [],
        patientZero: "",
        patientZeroName: "",
        timeoutSeconds: 0,
        label: "drop",
        image: reward.image,
        kicker: cfg.title,
        startSound: cfg.dropSound,
        startVolume: cfg.dropVolume,
        dropName: reward.name || "a drop",
    };
    if (game.kind === "chant"){
        base.unit = game.streak ? "IN A ROW" : "TIMES SAID";
        base.phrase = word;
        base.goal = game.times;
        base.streak = game.streak;
        base.chants = [{ phrase: word, times: game.times, seconds: game.seconds }];
    } else if (game.kind === "count"){
        base.unit = "COUNTED";
        base.countFrom = game.from;
        base.countTo = game.to;
        base.resetOnMistake = game.resetOnMistake;
        base.goal = Math.abs(game.to - game.from) + 1;
    } else if (game.kind === "scramble"){
        base.unit = "";
        base.answer = word;
        base.phrase = scramble(word);
    } else {
        base.unit = "SUB POINTS";
        base.goal = game.points;
    }
    return base;
}

// put a drop on screen now. blank ids = a fair draw of each. `test` is the tab's rehearsal: it plays for real
// but says nothing in chat and credits nobody with anything personal.
export function startDrop(session: TimerUserSession, rewardId = "", gameId = "", test = false): { ok: boolean, message: string } {
    const cfg = dropSettings(session);
    const busy = overlayBusy(session);
    if (busy)
        return { ok: false, message: `Can't put a drop up — ${busy}.` };
    const reward = rewardId ? cfg.rewards.find((p: any) => p.id === rewardId) : drawReward(session);
    if (!reward)
        return { ok: false, message: rewardId ? "That reward isn't on the Drops tab any more." : "No reward is set up to drop." };
    const games = playableGames(session);
    const game = gameId ? cfg.games.find((g: any) => g.id === gameId) : games.length ? pick(games) : null;
    if (!game || !playable(game))
        return { ok: false, message: gameId ? "That minigame has nothing to play — give it some words." : "No minigame is set up to play." };
    const spec = gameSpec(cfg, reward, game, test);
    // the reward is copied now, so retuning the tab while chat plays can't change what they're playing for
    const prize = JSON.parse(JSON.stringify(reward));
    return startChallenge(session, spec, false, (login, name) => {
        applyEffect(session, prize, { login, name, test, label: "drop" });
        emitSync(session.userId);
    });
}

// ---------------------------------------------------------------------------
// the "drop <action>" command
// ---------------------------------------------------------------------------

function findByName(list: any[], key: string): any | null {
    const want = String(key || "").trim().toLowerCase();
    if (!want)
        return null;
    return list.find((x: any) => String(x.id).toLowerCase() === want)
        || list.find((x: any) => String(x.name || "").trim().toLowerCase() === want)
        || null;
}

export function runDropCommand(session: TimerUserSession, cmd: { action: string, name: string }): { ok: boolean, message: string } {
    const cfg = dropSettings(session);
    if (cmd.action === "stop"){
        if (!isDropUp(session))
            return { ok: false, message: "No drop is on screen." };
        endQuickRevive(session);
        return { ok: true, message: "Drop called off." };
    }
    if (cmd.action === "clear"){
        const n = clearDropQueue(session);
        return { ok: true, message: n ? `Cleared ${n} waiting drop${n === 1 ? "" : "s"}.` : "No drops were waiting." };
    }
    if (cmd.action === "status"){
        const v = dropView(session);
        return {
            ok: true,
            message: `Drops ${cfg.enabled ? "on" : "OFF"} — ${v.hourLabel}: ${v.drops} of ${v.maxPerHour} dropped, ${v.minutes} minutes added`
                + (cfg.guaranteeEnabled ? `, floor at ${v.threshold} (${v.guaranteed ? "passed" : "not yet"})` : ", no floor")
                + `${v.queued ? `, ${v.queued} waiting` : ""}.`,
        };
    }
    const reward = cmd.name ? findByName(cfg.rewards, cmd.name) : null;
    if (cmd.name && !reward)
        return { ok: false, message: `No reward called "${cmd.name}". Try: ${cfg.rewards.map((p: any) => p.name || p.id).join(", ") || "(none set up)"}.` };
    if (cmd.action === "test")
        return startDrop(session, reward ? reward.id : "", "", true);
    // a drop by hand: goes up for real, announced like any other, and waits its turn if the overlay is busy.
    // it doesn't count toward the hour — the cap is on what the timer hands out, not on the operator.
    if (!winnableRewards(session).length && !reward)
        return { ok: false, message: "No reward is set up to drop." };
    if (!playableGames(session).length)
        return { ok: false, message: "No minigame is set up to play." };
    const busy = overlayBusy(session);
    queueDrop(session, "manual", reward ? reward.id : "");
    return { ok: true, message: busy ? `Drop queued — it goes up once ${busy.replace(/^a /, "the ")} is done.` : `Dropped${reward ? ` ${reward.name || reward.id}` : ""}.` };
}
