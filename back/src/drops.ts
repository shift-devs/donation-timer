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
// POOLS. the rewards are sorted into pools, and every minigame names the pool it pays from. that's how a
// harder game — a longer chant, a bigger count — can be the only way at the better rewards. a drop picks its
// game first, from the ones that are on and have something in their pool, then draws the reward from that
// game's pool. a reward's rarity is its weight against the rest of its own pool.
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
const MAX_POOLS = 10;
const MAX_WORDS = 50;
const MAX_WORD = 60;
// a secret phrase game: so many phrases, each with so many hints
const MAX_SECRETS = 50;
const MAX_HINTS = 20;
const MAX_HINT = 120;
const MAX_PATH = 300;
const MAX_TEXT = 80;
const MAX_QUEUE = 10;
const HOUR_MS = 3600 * 1000;
// how often a waiting drop checks whether the overlay has come free
const PUMP_MS = 2000;

// the rewards that ARE a minigame of their own. a drop is already a challenge, and the source runs one at a
// time, so one of these as the prize would be turned away the moment it was won.
const NOT_A_DROP = ["chant", "infection"];

export const GAME_KINDS = ["chant", "count", "subpoints", "scramble", "secret"];

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
    pools: [] as any[],
    rewards: [] as any[],
    games: [] as any[],
};

export const DEFAULT_POOL = {
    name: "Standard",
};

export const DEFAULT_GAME = {
    name: "",
    enabled: true,
    kind: "chant",
    seconds: 60,
    // the pool it pays from. blank, or one that's gone, means the first pool.
    pool: "",
    // chant: the phrases, one drawn per drop. scramble: the words, likewise.
    words: [] as string[],
    // secret: the phrases to guess, each with the hints that can go up for it. one phrase is drawn per
    // drop, then one of its hints.
    secrets: [] as { phrase: string, hints: string[] }[],
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

function normalizePools(raw: any): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw)){
        for (let i = 0; i < raw.length && out.length < MAX_POOLS; i++){
            const p = raw[i];
            if (!p || typeof p !== "object")
                continue;
            let id = typeof p.id === "string" && p.id ? p.id.slice(0, 100) : `pool${i + 1}`;
            if (seen.has(id))
                id = `${id}_${i}`;
            seen.add(id);
            out.push({ id, name: str(p.name, 60).trim() || `Pool ${out.length + 1}` });
        }
    }
    // there's always a pool, so a reward and a game always have somewhere to be
    if (!out.length)
        out.push({ id: "pool1", name: DEFAULT_POOL.name });
    return out;
}

function poolIn(pools: any[], v: any): string {
    return pools.some((p) => p.id === v) ? v : pools[0].id;
}

function normalizeGame(raw: any, i: number, pools: any[]): any | null {
    if (!raw || typeof raw !== "object")
        return null;
    const d = DEFAULT_GAME;
    return {
        id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 100) : `g${i + 1}`,
        name: str(raw.name, 60).trim(),
        enabled: raw.enabled === undefined ? d.enabled : !!raw.enabled,
        kind: GAME_KINDS.includes(raw.kind) ? raw.kind : d.kind,
        seconds: numIn(raw.seconds, 5, 3600, d.seconds),
        pool: poolIn(pools, raw.pool),
        words: Array.isArray(raw.words)
            ? raw.words
                .map((w: any) => str(w, MAX_WORD).trim())
                .filter((w: string, j: number, all: string[]) => w && all.indexOf(w) === j)
                .slice(0, MAX_WORDS)
            : [],
        secrets: Array.isArray(raw.secrets)
            ? raw.secrets
                .filter((s: any) => s && typeof s === "object")
                .slice(0, MAX_SECRETS)
                .map((s: any) => ({
                    phrase: str(s.phrase, MAX_WORD).trim(),
                    hints: Array.isArray(s.hints)
                        ? s.hints
                            .map((h: any) => str(h, MAX_HINT).trim())
                            .filter((h: string, j: number, all: string[]) => h && all.indexOf(h) === j)
                            .slice(0, MAX_HINTS)
                        : [],
                }))
            : [],
        times: numIn(raw.times, 1, 10000, d.times),
        streak: !!raw.streak,
        from: numIn(raw.from, -100000, 100000, d.from),
        to: numIn(raw.to, -100000, 100000, d.to),
        resetOnMistake: raw.resetOnMistake === undefined ? d.resetOnMistake : !!raw.resetOnMistake,
        points: numIn(raw.points, 1, 100000, d.points),
    };
}

function normalizeGames(raw: any, pools: any[]): any[] {
    if (!Array.isArray(raw))
        return [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length && out.length < MAX_GAMES; i++){
        const g = normalizeGame(raw[i], i, pools);
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
    const pools = normalizePools(r.pools);
    // only the objects go through, so the normalized list lines up with this one index for index
    const rawRewards: any[] = Array.isArray(r.rewards) ? r.rewards.filter((x: any) => x && typeof x === "object").slice(0, MAX_REWARDS) : [];
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
        pools,
        // the mystery box's own prize shape, so the same effects apply — minus the ones that are games
        rewards: normalizePrizes(rawRewards).map((p: any, i: number) => {
            if (NOT_A_DROP.includes(p.effect.kind))
                p.effect.kind = "none";
            p.profile = "";
            // the pool it's in. one that's gone (or was never set) puts it in the first.
            p.pool = poolIn(pools, rawRewards[i].pool);
            return p;
        }),
        games: normalizeGames(r.games, pools),
    };
}

export function dropSettings(session: TimerUserSession): any {
    return session.dropSettings || (session.dropSettings = normalizeDrops(null));
}

// a secret that can go up: it has a phrase, and a hint to point at it
function hinted(s: any): boolean {
    return !!(s.phrase && s.hints.length);
}

// a game that can actually be played: the phrase or word games need something to say
function playable(g: any): boolean {
    if (!g.enabled)
        return false;
    if (g.kind === "chant" || g.kind === "scramble")
        return g.words.length > 0;
    if (g.kind === "secret")
        return g.secrets.some(hinted);
    if (g.kind === "count")
        return g.from !== g.to;
    return true;
}

// the rewards that can drop — all of them, or one pool's
function winnableRewards(session: TimerUserSession, poolId = ""): any[] {
    return dropSettings(session).rewards.filter((p: any) => p.enabled && p.weight > 0 && (!poolId || p.pool === poolId));
}

function playableGames(session: TimerUserSession): any[] {
    return dropSettings(session).games.filter(playable);
}

// a game that can be played AND has something in its pool to hand out
function armed(session: TimerUserSession, g: any): boolean {
    return playable(g) && winnableRewards(session, g.pool).length > 0;
}

function armedGames(session: TimerUserSession): any[] {
    return dropSettings(session).games.filter((g: any) => armed(session, g));
}

function poolName(cfg: any, id: string): string {
    const p = cfg.pools.find((x: any) => x.id === id);
    return p ? p.name : id;
}

// why nothing can drop right now, for the terminal
function whyNothing(session: TimerUserSession): string {
    if (!winnableRewards(session).length)
        return "no reward is set up";
    if (!playableGames(session).length)
        return "no minigame is set up";
    return "no minigame that's ready pays from a pool with a reward in it";
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
    if (!armedGames(session).length){
        emitTerminal(session.userId, `DROP — one would have dropped (${event.label}), but ${whyNothing(session)} on the Drops tab.`);
        return;
    }
    st.drops += 1;
    emitTerminal(session.userId, `DROP — ${crossed ? `guaranteed: ${Math.floor(st.seconds / 60)} minutes added this hour passed the ${Math.round(st.threshold / 60)}-minute floor` : `rolled on ${event.label}`} (${st.drops} of ${cfg.maxPerHour} this hour).`, true);
    queueDrop(session, crossed ? "guaranteed" : "rolled", {});
}

// ---------------------------------------------------------------------------
// the queue
// ---------------------------------------------------------------------------

const pumps: { [userId: number]: any } = {};

function queue(session: TimerUserSession): any[] {
    return Array.isArray(session.dropQueue) ? session.dropQueue : (session.dropQueue = []);
}

function queueDrop(session: TimerUserSession, why: string, want: DropPick){
    const q = queue(session);
    if (q.length >= MAX_QUEUE){
        emitTerminal(session.userId, `DROP — ${q.length} already waiting; this one was dropped.`);
        return;
    }
    q.push({ why, rewardId: want.rewardId || "", gameId: want.gameId || "", poolId: want.poolId || "", at: Date.now() });
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
            const res = startDrop(session, next, false);
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

function oneOf<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
}

// a weighted draw from one pool
function drawReward(session: TimerUserSession, poolId: string): any | null {
    const pool = winnableRewards(session, poolId);
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
    const word = game.words.length ? oneOf(game.words) as string : "";
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
    } else if (game.kind === "secret"){
        // the phrase is the answer; what goes up is one of its hints
        const secret: any = oneOf(game.secrets.filter(hinted));
        base.unit = "";
        base.answer = secret.phrase;
        base.phrase = oneOf(secret.hints) as string;
    } else {
        base.unit = "SUB POINTS";
        base.goal = game.points;
    }
    return base;
}

// what a drop is asked to be. anything blank is drawn: a named game draws its reward from its own pool, a
// named reward gets one of the games that pay from its pool, a named pool gets one of its games and then one
// of its rewards, and nothing at all is a fair draw of every game that has something to give.
export type DropPick = { rewardId?: string, gameId?: string, poolId?: string };

// put a drop on screen now. `test` is the tab's rehearsal: it plays for real but says nothing in chat and
// credits nobody with anything personal.
export function startDrop(session: TimerUserSession, want: DropPick = {}, test = false): { ok: boolean, message: string } {
    const cfg = dropSettings(session);
    const busy = overlayBusy(session);
    if (busy)
        return { ok: false, message: `Can't put a drop up — ${busy}.` };
    const named = want.rewardId ? cfg.rewards.find((p: any) => p.id === want.rewardId) : null;
    if (want.rewardId && !named)
        return { ok: false, message: "That reward isn't on the Drops tab any more." };
    const poolId = named ? named.pool : want.poolId || "";
    if (poolId && !cfg.pools.some((p: any) => p.id === poolId))
        return { ok: false, message: "That pool isn't on the Drops tab any more." };
    let game: any;
    if (want.gameId){
        game = cfg.games.find((g: any) => g.id === want.gameId);
        if (!game)
            return { ok: false, message: "That minigame isn't on the Drops tab any more." };
        if (!playable(game))
            return { ok: false, message: `That minigame has nothing to play — give it ${game.kind === "secret" ? "a phrase with a hint" : game.kind === "count" ? "a range" : "some words"}.` };
    } else {
        // a named reward only needs a game that's ready in its pool; otherwise the pool has to have something in it too
        const games = cfg.games.filter((g: any) => named ? g.pool === poolId && playable(g) : poolId ? g.pool === poolId && armed(session, g) : armed(session, g));
        if (!games.length)
            return { ok: false, message: poolId ? `No minigame that's ready pays from the ${poolName(cfg, poolId)} pool.` : `Nothing can drop — ${whyNothing(session)}.` };
        game = oneOf(games);
    }
    const reward = named || drawReward(session, game.pool);
    if (!reward)
        return { ok: false, message: `Nothing in the ${poolName(cfg, game.pool)} pool can drop.` };
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
    // the name is a reward, or failing that a pool to draw from
    const reward = cmd.name ? findByName(cfg.rewards, cmd.name) : null;
    const pool = cmd.name && !reward ? findByName(cfg.pools, cmd.name) : null;
    if (cmd.name && !reward && !pool)
        return { ok: false, message: `No reward or pool called "${cmd.name}". Rewards: ${cfg.rewards.map((p: any) => p.name || p.id).join(", ") || "(none set up)"}. Pools: ${cfg.pools.map((p: any) => p.name).join(", ")}.` };
    const want: DropPick = { rewardId: reward ? reward.id : "", poolId: pool ? pool.id : "" };
    if (cmd.action === "test")
        return startDrop(session, want, true);
    // a drop by hand: goes up for real, announced like any other, and waits its turn if the overlay is busy.
    // it doesn't count toward the hour — the cap is on what the timer hands out, not on the operator.
    if (reward && !cfg.games.some((g: any) => g.pool === reward.pool && playable(g)))
        return { ok: false, message: `No minigame that's ready pays from the ${poolName(cfg, reward.pool)} pool, so ${reward.name || reward.id} can't drop.` };
    if (pool && !cfg.games.some((g: any) => g.pool === pool.id && armed(session, g)))
        return { ok: false, message: `Nothing in the ${pool.name} pool can drop — it needs a reward that's on and a minigame that's ready.` };
    if (!reward && !pool && !armedGames(session).length)
        return { ok: false, message: `Nothing can drop — ${whyNothing(session)}.` };
    const busy = overlayBusy(session);
    queueDrop(session, "manual", want);
    return { ok: true, message: busy ? `Drop queued — it goes up once ${busy.replace(/^a /, "the ")} is done.` : `Dropped${reward ? ` ${reward.name || reward.id}` : pool ? ` from ${pool.name}` : ""}.` };
}
