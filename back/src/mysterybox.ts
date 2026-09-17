// mysterybox: a prize wheel chat earns by putting items up for firesale. fourthwall announces a giveaway,
// firesale.ts parses out who gifted it, and that person is credited ONE box (see grantMysteryBox below).
// they spend it with "!mb open" in chat, which takes over the /mysterybox browser source: the music plays,
// the prize images cycle past, and the reel lands on one. that prize's effect then fires for real.
//
// two halves, and they are stored differently on purpose:
//   * WHO OWNS WHAT is a ledger. it's earned, it's spent, and it has to survive a restart the way a wallet
//     does — so it's persisted (session.mysteryBoxes, its own jsonb column).
//   * THE OPEN HAPPENING RIGHT NOW is live state, like a firesale run: never persisted, so a process that
//     dies mid-spin comes back with the source idle rather than resurrecting a reel nobody is watching. the
//     box is already spent at that point, which is the right way round — a crash must not mint boxes.
//
// ONE OPEN AT A TIME. the whole point is that the overlay is a single reel with a single soundtrack, so while
// a box is open every other "!mb open" is dropped on the floor, silently, and those chatters keep their boxes.
// what does NOT hold that lock is a prize's AFTER-EFFECT: a 3 minute timer pause outlives the reveal by a long
// way, and blocking the next open until it wore off would make the rarest prizes feel like a punishment.
//
// the effects are the part that actually touches the rest of the app (the timer, the /events sources, the text
// boxes), so they all go through applyEffect() — one place that knows what a prize is allowed to do.

import { TimerUserSession } from "./types";
import { emitMysteryBox, emitTerminal, emitSync, reportError } from "./bus";
import { addToEndTime, pauseTimerFor, startTimeBoost } from "./timer";
import { activeChatters, chatterName, chatterByDisplayName, chatTimeoutMany, chatTimeoutOne, canTimeout, chatSay, ACTIVE_WINDOW_MS } from "./chat";
import { Ledger, ledgerKey, ledgerCount, ledgerGrant, ledgerRename, normalizeLedger } from "./ledger";
import { setTextBoxText } from "./textBoxes";
import { testTimerEvent } from "./scheduler";

const MAX_NAME = 25;          // twitch's own username ceiling
// what a twitch login may actually contain. used to gate the places a chat-supplied name is acted on or
// repeated back INTO chat.
const TWITCH_LOGIN = /^[a-zA-Z0-9_]{1,25}$/;

// a name as somebody actually types it at another person, reduced to the login underneath.
// "@Victim," is one word to a human and three problems to a parser: the @ twitch's autocomplete adds, the
// capitals of a display name, and the punctuation of an ordinary sentence. all three are the writer being
// normal, so none of them should cost a shot.
function targetLogin(raw: any): string {
    return String(raw || "")
        .trim()
        .replace(/^@+/, "")
        .replace(/[.,!?;:'"()\[\]]+$/, "")
        .trim();
}

// …and when what's left still isn't a login, it may be a DISPLAY name — which is what chat sees and what
// twitch's autocomplete inserts. anyone who has spoken can be found that way.
function resolveTarget(session: TimerUserSession, raw: any): string {
    const cleaned = targetLogin(raw);
    if (TWITCH_LOGIN.test(cleaned))
        return cleaned.toLowerCase();
    return chatterByDisplayName(session, cleaned);
}
const MAX_PRIZES = 30;
const MAX_PRIZE_NAME = 60;
const MAX_BLURB = 120;        // the line under the prize name on stream
const MAX_PATH = 300;         // an image/sound filename, or a full url
// how many prizes may be sent past the marker on one spin. the spin always takes spinSec whatever this is,
// so raising it doesn't lengthen the spin — it speeds the reel up, which is the point of having it.
const MIN_SPIN_TILES = 5;
const MAX_SPIN_TILES = 200;
// tiles held either side of the run so the strip never shows its own ends. the source has room for ~3.5 at a
// time, so three each side means there is always art to the left of where the spin starts and to the right of
// where it lands — which is the whole illusion: a reel that could have carried on turning either way.
const REEL_PAD = 3;

// the effects a prize is allowed to have. anything not on this list can't be configured, so a bad payload
// from the dashboard can only ever produce a dud.
export const EFFECT_KINDS = ["none", "addTime", "removeTime", "pauseTimer", "timebomb", "timeBoost", "nuke", "raygun", "playEvent", "textBox"];
const MAX_CHARGES = 99;
const MAX_BOOST = 10;
const MAX_NUKE_SEC = 3600;    // ceiling on one nuke's timeout, well under twitch's own

export const DEFAULT_MYSTERYBOX = {
    // off = "!mb open" does nothing and firesales credit nobody. the boxes people already hold are kept.
    enabled: true,
    // what chatters type, without the "!". the actions after it (open / count) are fixed.
    command: "mb",
    // what a ray gun charge is fired with, without the "!". "<command> <name>" shoots; on its own it says
    // how many shots the asker has left.
    raygunCommand: "raygun",
    // credit the gifter named in fourthwall's giveaway announcement with one box per giveaway. off = boxes
    // are only handed out by hand, from the tab or the terminal.
    grantOnFiresale: true,
    // WHICH giveaways earn one. each entry is matched against the item fourthwall announced; empty means
    // every giveaway does, which is what this did before the list existed.
    firesaleItems: [] as string[],
    // a file in public/media, played from the top of the spin. it isn't looped: it's a stinger the length of
    // one open, and looping it would have the tail of the last spin still going under the reveal.
    music: "",
    volume: 0.7,
    // how long the reel cycles before it lands. the source eases it to a stop over exactly this long.
    spinSec: 6,
    // how many prizes fly past the marker in that time. this is the reel's SPEED: the spin lasts spinSec
    // either way, so more prizes over the same seconds is a faster reel, not a longer one.
    spinTiles: 20,
    // how long the prize stays up after the reel lands, before the source goes back to drawing nothing
    revealHoldSec: 8,
    bgColor: "transparent",
    titleColor: "#ffd400",
    nameColor: "#ffffff",
    // the prize list itself — see normalizePrize
    prizes: [] as any[],
};

export const DEFAULT_PRIZE = {
    name: "",
    enabled: true,
    // relative rarity: a prize's odds are its weight over the total weight of every ENABLED prize with a
    // weight above zero. so 1 against three 10s is roughly a 3% prize, and the operator never has to make
    // the numbers add up to anything in particular.
    weight: 10,
    // a file in public/prizes, or a full url. this is what cycles past in the reel.
    image: "",
    // a file in public/media, played once when the reel lands on this prize
    sound: "",
    volume: 1,
    // an optional second line under the name on stream, e.g. "+5 MINUTES"
    blurb: "",
    effect: { kind: "none", seconds: 0, factor: 2, percent: 50, charges: 5, loopSound: "", loopVolume: 0.6, eventId: "", box: "", text: "" },
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

function str(v: any, max: number): string {
    return typeof v === "string" ? v.slice(0, max) : "";
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function normalizeEffect(raw: any): any {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const kind = EFFECT_KINDS.includes(r.kind) ? r.kind : "none";
    return {
        kind,
        // shared by every timed effect: how much time to add/take, how long to pause, how long a text box
        // holds its words. one field rather than four, because only one of them is ever live at a time.
        seconds: numIn(r.seconds, 0, 24 * 3600, 0),
        // timeBoost: what every contribution's time is multiplied by while it lasts. 2 is the bonfire sale.
        factor: Math.min(MAX_BOOST, Math.max(1, Number.isFinite(Number(r.factor)) ? Number(r.factor) : 2)),
        // nuke: what share of the chatters who are actually talking get timed out
        percent: numIn(r.percent, 1, 100, 50),
        // raygun: how many shots the winner is credited with. each one is `seconds` long.
        charges: numIn(r.charges, 1, MAX_CHARGES, 5),
        // timeBoost: a track looped for as long as the sale runs, as opposed to the prize's own `sound`,
        // which is the one-shot that plays as the reel stops on it
        loopSound: str(r.loopSound, MAX_PATH),
        loopVolume: Math.min(1, Math.max(0, Number.isFinite(Number(r.loopVolume)) ? Number(r.loopVolume) : 0.6)),
        eventId: str(r.eventId, 100),          // playEvent: which configured timer event's clip to fire
        box: str(r.box, 100),                  // textBox: which /text source, by name or id
        text: str(r.text, 500),                // textBox: the words to put on it
    };
}

function normalizePrize(raw: any, i: number): any | null {
    if (!raw || typeof raw !== "object")
        return null;
    const d = DEFAULT_PRIZE;
    return {
        id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 100) : `p${i + 1}`,
        name: str(raw.name, MAX_PRIZE_NAME).trim(),
        enabled: raw.enabled === undefined ? d.enabled : !!raw.enabled,
        weight: numIn(raw.weight, 0, 1000, d.weight),
        image: str(raw.image, MAX_PATH),
        sound: str(raw.sound, MAX_PATH),
        volume: Math.min(1, Math.max(0, Number.isFinite(Number(raw.volume)) ? Number(raw.volume) : d.volume)),
        blurb: str(raw.blurb, MAX_BLURB),
        effect: normalizeEffect(raw.effect),
    };
}

export function normalizePrizes(raw: any): any[] {
    if (!Array.isArray(raw))
        return [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length && out.length < MAX_PRIZES; i++){
        const prize = normalizePrize(raw[i], i);
        if (!prize)
            continue;
        // ids have to be unique: a landed reel names one, and duplicates would fight over which effect fires
        if (seen.has(prize.id))
            prize.id = `${prize.id}_${i}`;
        seen.add(prize.id);
        out.push(prize);
    }
    return out;
}

export function normalizeMysteryBox(raw: any): any {
    const d = DEFAULT_MYSTERYBOX;
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
        // stored without the "!" so the ui and the chat matcher can't disagree about whether it's there
        command: (typeof r.command === "string" ? r.command.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.command,
        raygunCommand: (typeof r.raygunCommand === "string" ? r.raygunCommand.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.raygunCommand,
        grantOnFiresale: r.grantOnFiresale === undefined ? d.grantOnFiresale : !!r.grantOnFiresale,
        firesaleItems: Array.isArray(r.firesaleItems)
            ? r.firesaleItems
                .map((v: any) => str(v, 200).trim())
                .filter((v: string, i: number, all: string[]) => v && all.indexOf(v) === i)
                .slice(0, 50)
            : d.firesaleItems,
        music: str(r.music, MAX_PATH),
        volume: Math.min(1, Math.max(0, Number.isFinite(Number(r.volume)) ? Number(r.volume) : d.volume)),
        spinSec: numIn(r.spinSec, 1, 30, d.spinSec),
        spinTiles: numIn(r.spinTiles, MIN_SPIN_TILES, MAX_SPIN_TILES, d.spinTiles),
        revealHoldSec: numIn(r.revealHoldSec, 1, 60, d.revealHoldSec),
        bgColor: hexOr(r.bgColor, d.bgColor, TRANSPARENT),
        titleColor: hexOr(r.titleColor, d.titleColor),
        nameColor: hexOr(r.nameColor, d.nameColor),
        prizes: normalizePrizes(r.prizes),
    };
}

// what an item name is compared as. fourthwall writes its product names with em dashes and curly quotes and
// the announcement carries them through verbatim, so a rule typed with a plain hyphen would never match the
// item it names — which would look like the feature is simply broken.
function matchable(s: any): string {
    return String(s || "")
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

// does a giveaway of this item earn the gifter a box?
// an empty list means every giveaway does — that's what this did before the list existed, and it's the
// right default for somebody who hasn't thought about it yet.
// a rule matches if the announced item CONTAINS it, so "box of 8" covers "Box of 8 Packs - 10 Years
// Running" without the operator having to reproduce fourthwall's full product name exactly.
export function earnsBoxFor(session: TimerUserSession, prize: any): boolean {
    const rules = mbSettings(session).firesaleItems;
    if (!rules.length)
        return true;
    const item = matchable(prize);
    if (!item)
        return false; // a giveaway with no item named can't be matched against a list that names some
    return rules.some((r: string) => {
        const rule = matchable(r);
        return !!rule && item.includes(rule);
    });
}

export function mbSettings(session: TimerUserSession): any {
    return session.mysteryBoxSettings || (session.mysteryBoxSettings = normalizeMysteryBox(null));
}

// the prizes that can actually be landed on. a disabled prize, or one with no weight, still cycles past in
// the reel if it has an image — it just can't win.
function winnablePrizes(session: TimerUserSession): any[] {
    return mbSettings(session).prizes.filter((p: any) => p.enabled && p.weight > 0);
}

export function findPrize(session: TimerUserSession, key: any): any | null {
    const prizes = mbSettings(session).prizes;
    const want = String(key || "").trim();
    if (!want)
        return null;
    const lower = want.toLowerCase();
    return prizes.find((p: any) => String(p.id) === want)
        || prizes.find((p: any) => String(p.name || "").trim().toLowerCase() === lower)
        || null;
}

// ---------------------------------------------------------------------------
// the ledger: who is holding how many boxes
// ---------------------------------------------------------------------------
//
// keyed by the LOGIN, lowercased, because that's the only name twitch guarantees is stable — display names
// differ in case and can be changed. the display name is carried alongside purely so the dashboard can show
// people as they write themselves.
//
// one wrinkle worth knowing about: a box earned from a firesale is credited to the gifter name FOURTHWALL
// printed, which is a display name and not necessarily the login that later types "!mb open". when they
// differ, the box lands under a key its owner can't spend — hence renameOwner(), which the tab uses to merge
// one row into another.

export const boxKey = ledgerKey;
export const normalizeBoxes = normalizeLedger;

export function mbBoxes(session: TimerUserSession): Ledger {
    return session.mysteryBoxes || (session.mysteryBoxes = {});
}

export function boxCount(session: TimerUserSession, login: any): number {
    return ledgerCount(mbBoxes(session), login);
}

// the last few giveaways a box was minted for, per user. twitch can deliver the same announcement twice (a
// chat reconnect replays it), and firesale.ts only dedupes runs that are still TAKING ENTRIES — a replay
// arriving after the window closed opens a second run, which used to cost a duplicate on the overlay and now
// would mint a second box. currency has to be idempotent in a way an overlay doesn't.
const minted: { [userId: number]: { key: string, at: number }[] } = {};
const MINT_DEDUPE_MS = 30 * 60 * 1000;

export function alreadyMintedFor(userId: number, key: string): boolean {
    const now = Date.now();
    const list = (minted[userId] || []).filter((m) => now - m.at < MINT_DEDUPE_MS);
    minted[userId] = list;
    if (list.some((m) => m.key === key))
        return true;
    list.push({ key, at: now });
    if (list.length > 50)
        list.splice(0, list.length - 50);
    return false;
}

// hand someone boxes (or take them, with a negative n). returns what they hold afterwards.
export function grantMysteryBox(session: TimerUserSession, login: any, displayName: any, n = 1, why = ""): number {
    const next = ledgerGrant(mbBoxes(session), login, displayName, n);
    if (why && n > 0)
        emitTerminal(session.userId, `MYSTERYBOX — ${str(displayName, MAX_NAME) || ledgerKey(login)} earned ${n === 1 ? "a box" : `${n} boxes`} (${why}); they hold ${next}.`, true);
    emitSync(session.userId); // the tab lists the ledger, so it has to see this promptly
    return next;
}

// ray gun charges: the same kind of wallet, spent with "!raygun <name>" instead of on a reel
export function mbRayguns(session: TimerUserSession): Ledger {
    return session.rayguns || (session.rayguns = {});
}

export function raygunCount(session: TimerUserSession, login: any): number {
    return ledgerCount(mbRayguns(session), login);
}

export function grantRaygun(session: TimerUserSession, login: any, displayName: any, n = 1): number {
    const next = ledgerGrant(mbRayguns(session), login, displayName, n);
    emitSync(session.userId);
    return next;
}

// merge one ledger row into another, for when fourthwall's gifter name isn't the login that spends the box
export function renameOwner(session: TimerUserSession, from: any, to: any): { ok: boolean, message: string } {
    const moved = ledgerRename(mbBoxes(session), from, to);
    if (moved < 0)
        return { ok: false, message: `Nobody called "${from}" is holding a box, or those are the same name.` };
    // charges follow the boxes: it's the same person being corrected to the same login
    ledgerRename(mbRayguns(session), from, to);
    emitSync(session.userId);
    return { ok: true, message: `Moved ${moved} box${moved === 1 ? "" : "es"} from ${from} to ${to}.` };
}

// ---------------------------------------------------------------------------
// the open happening right now
// ---------------------------------------------------------------------------

// phase timers per user. deliberately off the session, for the same reason firesale's are: a Timeout is not
// state anyone should be able to serialize or sync, and holding them here means ending an open can never
// leave one behind. `restore` is the odd one out — it belongs to a text-box effect that outlives the reveal.
// `restore` is keyed by TEXT BOX, not by user: two text-box prizes landing close together each own their own
// box, and a single slot meant the second one cancelled the first's restore and left that box stuck on its
// prize text for good.
const timers: { [userId: number]: { land?: any, done?: any, restore: { [box: string]: any } } } = {};

function slots(userId: number){
    return timers[userId] || (timers[userId] = { restore: {} });
}

export function getMysteryBox(session: TimerUserSession): any {
    if (!session.mysterybox || typeof session.mysterybox !== "object")
        session.mysterybox = { nonce: 0, phase: "idle", opener: "", openerName: "", prizeId: "", reel: [], startIndex: 0, landIndex: 0, startedAt: 0, endsAt: 0, wonAt: 0, isTest: false };
    return session.mysterybox;
}

// is a box being opened right now? this is the lock every "!mb open" is checked against.
export function isOpening(session: TimerUserSession): boolean {
    return getMysteryBox(session).phase !== "idle";
}

// what the browser source is handed. the whole prize list travels with it so the source can preload the
// images and draw the reel; the winner is named up front because the reel is built server-side and its last
// step IS the winner — there's nothing to hide from a source that already has the whole sequence.
export function mysteryBoxView(session: TimerUserSession): any {
    const cfg = mbSettings(session);
    const mb = getMysteryBox(session);
    const prize = mb.prizeId ? findPrize(session, mb.prizeId) : null;
    return {
        active: mb.phase !== "idle",
        nonce: mb.nonce,
        phase: mb.phase,
        opener: mb.openerName || mb.opener,
        startedAt: mb.startedAt,
        // when the reel lands. the source eases its spin to a stop on this instant.
        endsAt: mb.endsAt,
        // when the prize went up. the source needs it to tell "this just landed" from "i connected while a
        // prize was already on screen", so a reload mid-open doesn't replay the prize sound.
        wonAt: mb.wonAt,
        reel: mb.reel,
        // which tile of the reel the spin starts centred on, and which one it stops on. the tiles outside
        // that span are the padding that keeps art on both sides of the frame.
        startIndex: mb.startIndex,
        landIndex: mb.landIndex,
        prize: prize ? {
            id: prize.id, name: prize.name, image: prize.image, blurb: prize.blurb,
            sound: prize.sound, volume: prize.volume,
        } : null,
        // every prize, for the reel art and the preload — ids and images only, since the source has no use
        // for the weights or the effects
        prizes: cfg.prizes.map((p: any) => ({ id: p.id, name: p.name, image: p.image })),
        // why "!mb open" is being turned away, if it is — the dashboard shows it so the operator isn't left
        // wondering why chat is complaining
        blocked: openBlockedBy(session),
        command: cfg.command,
        music: cfg.music,
        volume: cfg.volume,
        spinSec: cfg.spinSec,
        spinTiles: cfg.spinTiles,
        revealHoldSec: cfg.revealHoldSec,
        bgColor: cfg.bgColor,
        titleColor: cfg.titleColor,
        nameColor: cfg.nameColor,
    };
}

export function pushMysteryBox(session: TimerUserSession){
    emitMysteryBox(session.userId, mysteryBoxView(session));
}

// weighted pick over the winnable prizes
function drawPrize(session: TimerUserSession): any | null {
    const pool = winnablePrizes(session);
    if (!pool.length)
        return null;
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    for (const p of pool){
        roll -= p.weight;
        if (roll < 0)
            return p;
    }
    return pool[pool.length - 1]; // float drift only; the loop above all but always returns
}

// how many tiles of the strip each prize gets: its share of the total, in proportion to its odds, so how
// often a prize scrolls past is how likely it is. a 5% prize turning up as often as a 60% one would say the
// opposite of what the rarity is set to, and the reel is the only place chat can read the odds at all.
//
// largest-remainder, so the counts add up to exactly `total` instead of drifting with the rounding.
//
// FLOOR: every prize gets at least two tiles while there's room for it. art that appeared only once would be
// unique, and unique art can be read off the strip before the reel reaches it — the whole result, a second
// early. the cost is that this is the one place the proportions are deliberately wrong: a very rare prize is
// over-represented, because the alternative is either giving the ending away or never showing it at all.
function tileCounts(pool: { id: string, weight: number }[], total: number): { [id: string]: number } {
    const floorEach = pool.length * 2 <= total ? 2 : 1;
    const counts: { [id: string]: number } = {};
    for (const p of pool)
        counts[p.id] = floorEach;
    // what's left after the floor is handed out by weight
    const budget = Math.max(0, total - pool.length * floorEach);
    const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
    if (!budget || !totalWeight)
        return counts;
    const shares = pool.map((p) => {
        const exact = (budget * p.weight) / totalWeight;
        return { id: p.id, whole: Math.floor(exact), fraction: exact - Math.floor(exact) };
    });
    for (const sh of shares)
        counts[sh.id] += sh.whole;
    // the tiles rounding left over go to whoever was cut hardest by it
    let spare = budget - shares.reduce((sum, sh) => sum + sh.whole, 0);
    shares.sort((a, b) => b.fraction - a.fraction);
    for (let i = 0; spare > 0; i = (i + 1) % shares.length, spare--)
        counts[shares[i].id]++;
    return counts;
}

// lay those counts out along the strip, each prize's tiles spread EVENLY over the whole of it rather than
// dealt out as the strip is filled. the rate has to hold locally as well as globally: a prize that is 60% of
// the tiles should be roughly 60% of any stretch chat can see at once, not 30% at one end and a solid block
// of it at the other.
//
// so each tile is given the position it would ideally sit at — its k-th of c tiles belongs c-ways along —
// and the strip is read off in that order. the phase is rotated at random per prize and wrapped, so the
// spacing survives but the prizes line up differently against each other on every spin: no two reels look
// alike, and none of them has a visible A-B-A-C pattern.
//
// adjacency falls out of the arithmetic rather than being forbidden. a prize holding more than half the
// tiles CANNOT avoid touching itself somewhere — and shouldn't: a common prize coming round twice in a row
// is what common looks like. spreading it this way keeps those to the odd pair instead of a block.
function arrangeTiles(counts: { [id: string]: number }): string[] {
    const total = Object.keys(counts).reduce((sum, id) => sum + counts[id], 0);
    if (!total)
        return [];
    const slots: { at: number, id: string }[] = [];
    for (const id of Object.keys(counts)){
        const c = counts[id];
        if (c <= 0)
            continue;
        const gap = total / c;
        const phase = Math.random();
        for (let k = 0; k < c; k++)
            slots.push({ at: ((k + phase) * gap) % total, id });
    }
    slots.sort((a, b) => a.at - b.at);
    return slots.map((s) => s.id);
}

// the strip of prizes the source draws, and the two indexes that say what to do with it: where the spin
// starts and where it stops. built here rather than in the source so that what OBS draws and what the server
// decided can never be two different things.
//
// the run is PADDED at both ends. without that the strip would begin with empty space to the left of the
// first tile and end with empty space to the right of the winner — the two moments chat is looking hardest —
// and the reel would read as a short filmstrip rather than something that could have kept turning.
function buildReel(session: TimerUserSession, winnerId: string): { reel: string[], startIndex: number, landIndex: number } {
    // only what can actually be won. a disabled or zero-weight prize has no odds to represent, so it has no
    // business scrolling past — its rate IS zero.
    const pool = winnablePrizes(session).map((p: any) => ({ id: p.id, weight: p.weight }));
    if (!pool.length)
        return { reel: [winnerId], startIndex: 0, landIndex: 0 };
    // the strip is the run the operator asked for, the tile it lands on, and the padding either side —
    // but never shorter than the number of prizes. every prize gets at least one tile, so a strip shorter
    // than the pool would come back LONGER than asked for, and the turn below (which is modular) would then
    // be working against a length it doesn't have and stop on the wrong prize. it costs a little extra tail
    // padding in the rare setup that has more prizes than tiles, which nobody can see.
    const travel = mbSettings(session).spinTiles;
    const total = Math.max(travel + 1 + REEL_PAD * 2, pool.length + REEL_PAD);
    const reel = arrangeTiles(tileCounts(pool, total));
    const startIndex = REEL_PAD;
    const landIndex = REEL_PAD + travel;

    // the tile under the marker has to be the prize that was drawn, and the strip is TURNED to bring one of
    // that prize's own tiles there rather than having one written into place. the layout above is circular —
    // every tile's position was taken modulo the length — so turning it is free: every count is untouched and
    // no two tiles become neighbours that weren't already. writing the winner in would have cost both, by
    // adding a tile of one prize and dropping a tile of another right where chat is looking.
    // which of its tiles comes round is picked at random, so the same prize doesn't land the same way twice.
    const copies: number[] = [];
    for (let i = 0; i < reel.length; i++)
        if (reel[i] === winnerId)
            copies.push(i);
    if (copies.length){
        const from = copies[Math.floor(Math.random() * copies.length)];
        // off the strip's OWN length, never off what was asked for: the two agree now, and this is the one
        // place where them disagreeing would silently stop the reel on a prize nobody won
        const len = reel.length;
        const shift = (((landIndex - from) % len) + len) % len;
        const turned = reel.slice(len - shift).concat(reel.slice(0, len - shift));
        return { reel: turned, startIndex, landIndex };
    }
    reel[landIndex] = winnerId; // no tile of its own to turn to; can't happen while every prize gets two
    return { reel, startIndex, landIndex };
}

// why a box can't be opened right now, or "" if it can. ONE thing happens at a time: the overlay is a single
// reel with a single soundtrack, and a prize landing on top of the last one's after-effect — a second reel
// over a bonfire sale, a nuke during a freeze — reads as the feature misfiring rather than as two prizes.
// a firesale counts too: that overlay owns the screen and the music while it runs.
// the reason is written to be said out loud in chat, so it names the prize rather than the mechanism.
export function openBlockedBy(session: TimerUserSession): string {
    if (isOpening(session))
        return "a box is already being opened";
    const f = session.firesale;
    if (f && Array.isArray(f.runs) && f.runs.length)
        return "a firesale is running";
    const pause = session.timerPause;
    if (pause)
        return `${pause.reason} still has the timer frozen`;
    const boost = session.timeBoost;
    if (boost && boost.until > Date.now())
        return `${boost.reason} is still going`;
    const eff = session.mbEffect;
    if (eff && eff.until > Date.now())
        return `${eff.what} is still going`;
    return "";
}

// open one box for someone. this is the only place a box is spent.
// returns a line for whoever asked; `ok: false` with a blank message means "ignored on purpose, say nothing"
// — which is what a second opener during a spin gets.
export function openMysteryBox(session: TimerUserSession, login: any, displayName: any): { ok: boolean, message: string } {
    const cfg = mbSettings(session);
    const key = boxKey(login);
    const who = str(displayName, MAX_NAME) || key;
    if (!cfg.enabled)
        return { ok: false, message: "" };
    if (!key)
        return { ok: false, message: "" };
    // whether they HAVE one is asked before whether now is a good time, so the only people who ever hear
    // "you can't right now" are people who could otherwise have opened one. everybody else gets the honest
    // answer, and a chat full of hopefuls typing !mb open can't turn the bot into a megaphone.
    if (boxCount(session, key) < 1)
        return { ok: false, message: `@${who} you have no mystery boxes to open.` };
    // checked BEFORE the box is spent, so somebody turned away still has theirs
    const blocked = openBlockedBy(session);
    if (blocked)
        return { ok: false, message: `@${who} you can't open a box right now — ${blocked}.` };
    const prize = drawPrize(session);
    if (!prize){
        emitTerminal(session.userId, `MYSTERYBOX — ${who} tried to open a box, but no prize is set up to be won. Their box was not spent.`);
        return { ok: false, message: "" };
    }

    grantMysteryBox(session, key, who, -1);
    const mb = getMysteryBox(session);
    mb.nonce = (mb.nonce || 0) + 1;
    mb.phase = "spinning";
    mb.opener = key;
    mb.openerName = who;
    mb.isTest = false;
    mb.prizeId = prize.id;
    const strip = buildReel(session, prize.id);
    mb.reel = strip.reel;
    mb.startIndex = strip.startIndex;
    mb.landIndex = strip.landIndex;
    mb.startedAt = Date.now();
    mb.endsAt = Date.now() + cfg.spinSec * 1000;
    mb.wonAt = 0;
    emitTerminal(session.userId, `MYSTERYBOX — ${who} is opening a box (${boxCount(session, key)} left)…`, true);
    pushMysteryBox(session);

    const t = slots(session.userId);
    clearTimeout(t.land);
    clearTimeout(t.done);
    t.land = setTimeout(() => {
        try {
            landMysteryBox(session);
        } catch (err) {
            reportError(session.userId, "landing a mystery box", err);
            endMysteryBox(session); // never leave the lock held by a failed open
        }
    }, cfg.spinSec * 1000);
    return { ok: true, message: `${who} is opening a mystery box…` };
}

// the reel stops. the prize goes up and its effect fires for real.
function landMysteryBox(session: TimerUserSession){
    const cfg = mbSettings(session);
    const mb = getMysteryBox(session);
    if (mb.phase !== "spinning")
        return;
    mb.phase = "reveal";
    mb.wonAt = Date.now();
    const prize = findPrize(session, mb.prizeId);
    emitTerminal(session.userId, `MYSTERYBOX — ${mb.openerName || mb.opener} won ${prize ? (prize.name || prize.id) : "nothing"}!`, true);
    pushMysteryBox(session);
    // tell chat what landed. the reel only says it to whoever is watching the stream at that second, and
    // half the fun of a rare prize is the people who missed it seeing that somebody got it.
    // just the name: what it DOES is playing out on screen a second later anyway, and spelling it out made
    // every line read like a rules footnote.
    if (prize && !mb.isTest)
        chatSay(session, `@${mb.openerName || mb.opener} opened a mystery box and got ${prize.name || "???"}!`);
    // the effect comes after the push, so the overlay is already showing the prize when the timer jumps
    if (prize){
        try {
            applyEffect(session, prize);
        } catch (err) {
            reportError(session.userId, `applying the "${prize.name || prize.id}" mystery box prize`, err);
        }
    }
    const t = slots(session.userId);
    clearTimeout(t.done);
    t.done = setTimeout(() => {
        try {
            endMysteryBox(session);
        } catch (err) {
            reportError(session.userId, "clearing a finished mystery box", err);
        }
    }, cfg.revealHoldSec * 1000);
}

// back to idle: the source draws nothing and the next "!mb open" is accepted. a lingering effect (a pause,
// a text box holding its words) carries on past this — those are not part of the lock.
export function endMysteryBox(session: TimerUserSession){
    const mb = getMysteryBox(session);
    const t = slots(session.userId);
    clearTimeout(t.land);
    clearTimeout(t.done);
    t.land = t.done = undefined;
    mb.phase = "idle";
    mb.opener = "";
    mb.openerName = "";
    mb.isTest = false;
    mb.prizeId = "";
    mb.reel = [];
    mb.startIndex = 0;
    mb.landIndex = 0;
    mb.startedAt = 0;
    mb.endsAt = 0;
    mb.wonAt = 0;
    pushMysteryBox(session);
}

// tear down on logout so a phase timer can't fire against a detached session
export function endMysteryBoxTimers(userId: number){
    delete toldAt[userId];
    delete minted[userId];
    const t = slots(userId);
    clearTimeout(t.land);
    clearTimeout(t.done);
    for (const box of Object.keys(t.restore))
        clearTimeout(t.restore[box]);
    delete timers[userId];
}

// ---------------------------------------------------------------------------
// what a prize actually does
// ---------------------------------------------------------------------------

// the one place a prize is allowed to reach into the rest of the app. every branch is reversible or bounded:
// nothing here can add time without it going through the timer's own cap, and nothing can hold the overlay.
// mark a prize's after-effect as still playing out, for the ones that keep no state of their own. the
// freezes and the bonfire sale don't need this — they're already visible in timerPause and timeBoost.
function holdEffect(session: TimerUserSession, seconds: number, what: string){
    const until = Date.now() + Math.max(0, seconds) * 1000;
    if (!session.mbEffect || session.mbEffect.until < until)
        session.mbEffect = { until, what };
}

export function applyEffect(session: TimerUserSession, prize: any){
    const e = prize.effect || {};
    const label = `mystery box: ${prize.name || prize.id}`;
    if (e.kind === "addTime" && e.seconds > 0){
        addToEndTime(session, e.seconds, label);
        return;
    }
    if (e.kind === "removeTime" && e.seconds > 0){
        addToEndTime(session, -e.seconds, label);
        return;
    }
    if (e.kind === "pauseTimer" && e.seconds > 0){
        pauseTimerFor(session, e.seconds * 1000, label);
        return;
    }
    if (e.kind === "timebomb" && e.seconds > 0){
        // the same freeze as pauseTimer, but rolling: every contribution buys chat another e.seconds of it,
        // and it only lets go once they've gone that long without one
        pauseTimerFor(session, e.seconds * 1000, prize.name || "Timebomb", e.seconds * 1000, e.loopSound, e.loopVolume);
        return;
    }
    if (e.kind === "timeBoost" && e.seconds > 0 && e.factor > 1){
        // the prize's own name is what chat will hear it called, so that's what the terminal and the on-stream
        // banner say — "Bonfire Sale", not "x2 for 60s"
        startTimeBoost(session, e.seconds * 1000, e.factor, prize.name || "Boost", e.loopSound, e.loopVolume);
        return;
    }
    if (e.kind === "nuke" && e.seconds > 0 && e.percent > 0){
        const secs = Math.min(MAX_NUKE_SEC, e.seconds);
        holdEffect(session, secs, prize.name || "Nuke");
        nukeChat(session, e.percent, secs, prize.name || "Nuke");
        return;
    }
    if (e.kind === "raygun" && e.charges > 0 && e.seconds > 0){
        // the winner is credited, not the target — this prize hands out a weapon rather than firing one, and
        // who it gets fired at is their decision to make later.
        const mbState = getMysteryBox(session);
        const who = mbState.opener;
        if (!who || mbState.isTest)
            return; // a rehearsal must not credit a viewer called TEST
        const held = grantRaygun(session, who, mbState.openerName, e.charges);
        const cfg = mbSettings(session);
        emitTerminal(session.userId, `MYSTERYBOX — ${mbState.openerName || who} was given ${e.charges} ray gun shot${e.charges === 1 ? "" : "s"} (${held} in hand).`, true);
        chatSay(session, `@${mbState.openerName || who} got ${e.charges} ray gun shot${e.charges === 1 ? "" : "s"} — !${cfg.raygunCommand} <name> to time somebody out for ${Math.round(e.seconds / 60)} minute${e.seconds >= 120 ? "s" : ""}. ${held} in hand.`);
        return;
    }
    if (e.kind === "playEvent" && e.eventId){
        // the same path the dashboard's Test button takes: the clip plays on the event's own /events layer,
        // and the event's delayed command (if it has one) runs too
        testTimerEvent(session, e.eventId);
        return;
    }
    if (e.kind === "textBox" && e.box){
        const prev = restorableText(session, e.box);
        const res = setTextBoxText(session, e.box, e.text);
        if (!res.ok){
            emitTerminal(session.userId, `MYSTERYBOX — ${res.message}`);
            return;
        }
        emitSync(session.userId); // pushes the words to that box's browser source(s)
        if (e.seconds > 0)
            holdEffect(session, e.seconds, prize.name || "that prize");
        // seconds = 0 means the words stay until someone changes them. otherwise put back whatever was there
        // before — including nothing, which is the usual case.
        if (e.seconds > 0){
            const t = slots(session.userId);
            const box = String(e.box);
            clearTimeout(t.restore[box]);
            t.restore[box] = setTimeout(() => {
                delete t.restore[box];
                try {
                    setTextBoxText(session, box, prev);
                    emitSync(session.userId);
                } catch (err) {
                    reportError(session.userId, "restoring a text box after a mystery box prize", err);
                }
            }, e.seconds * 1000);
        }
    }
}

// time out a share of the people currently talking. "currently talking" is what chat.ts's roster says: who
// has typed inside the activity window, minus the mods and the broadcaster, because twitch refuses a timeout
// on those and counting them would make the percentage a lie.
//
// picked at random, and the pick is made HERE rather than being handed to twitch as a filter — there is no
// such twitch feature. each timeout is its own command.
export function nukeChat(session: TimerUserSession, percent: number, seconds: number, reason: string): { hit: string[], pool: number } {
    const pool = activeChatters(session);
    if (!pool.length){
        emitTerminal(session.userId, `${reason} — nobody has said anything in the last ${Math.round(ACTIVE_WINDOW_MS / 60000)} minutes, so there was nobody to hit.`);
        return { hit: [], pool: 0 };
    }
    // shuffle, then take the share off the front
    const order = pool.slice();
    for (let i = order.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    // at least one: a prize that announces itself and then does nothing because chat was quiet reads as broken
    const take = Math.max(1, Math.min(order.length, Math.round((order.length * percent) / 100)));
    const hit = order.slice(0, take);
    const names = hit.map((l) => chatterName(session, l)).join(", ");
    if (!canTimeout(session)){
        // no bot authorized: say exactly what would have happened rather than pretending it did
        emitTerminal(session.userId, `${reason} WOULD have timed out ${hit.length} of ${pool.length} chatters for ${seconds}s, but no bot account is connected: ${names}`);
        return { hit, pool: pool.length };
    }
    // fired and not awaited — the prize has already landed on screen and the reveal shouldn't wait on a
    // round trip per person. the count is reported once they've all been through.
    chatTimeoutMany(session, hit, seconds, reason).then((done) => {
        emitTerminal(session.userId, done === hit.length
            ? `${reason} — timed out ${done} of ${pool.length} chatters for ${seconds}s: ${names}`
            : `${reason} — timed out ${done} of the ${hit.length} it picked (of ${pool.length} talking) for ${seconds}s: ${names}`, true);
    }).catch((err) => reportError(session.userId, "running a nuke", err));
    return { hit, pool: pool.length };
}

function restorableText(session: TimerUserSession, box: any): string {
    const boxes = Array.isArray(session.textBoxes) ? session.textBoxes : [];
    const want = String(box || "").trim().toLowerCase();
    const found = boxes.find((b: any) => String(b.name || "").trim().toLowerCase() === want)
        || boxes.find((b: any) => String(b.id) === String(box || "").trim());
    return found && typeof found.text === "string" ? found.text : "";
}

// a one-line description of a prize's effect, for the dashboard list and the terminal. kept here so the ui
// can't describe an effect the server doesn't implement.
export function describeEffect(effect: any): string {
    const e = effect || {};
    const mins = (s: number) => s >= 60 && s % 60 === 0 ? `${s / 60}m` : `${s}s`;
    if (e.kind === "addTime")
        return e.seconds > 0 ? `adds ${mins(e.seconds)}` : "adds nothing (set the seconds)";
    if (e.kind === "removeTime")
        return e.seconds > 0 ? `takes ${mins(e.seconds)}` : "takes nothing (set the seconds)";
    if (e.kind === "pauseTimer")
        return e.seconds > 0 ? `pauses the timer ${mins(e.seconds)}` : "pauses nothing (set the seconds)";
    if (e.kind === "timebomb")
        return e.seconds > 0
            ? `freezes the timer, and every contribution keeps it frozen another ${mins(e.seconds)}`
            : "freezes nothing (set the seconds)";
    if (e.kind === "timeBoost")
        return e.seconds > 0 && e.factor > 1
            ? `every contribution is worth x${e.factor} for ${mins(e.seconds)}`
            : "boosts nothing (set the seconds and a multiplier above 1)";
    if (e.kind === "nuke")
        return e.seconds > 0 && e.percent > 0
            ? `times out ${e.percent}% of the chatters who are talking, for ${mins(e.seconds)}`
            : "times out nobody (set the share and the seconds)";
    if (e.kind === "raygun")
        return e.charges > 0 && e.seconds > 0
            ? `gives the winner ${e.charges} ray gun shot${e.charges === 1 ? "" : "s"}, ${mins(e.seconds)} each`
            : "gives nothing (set the shots and the seconds)";
    if (e.kind === "playEvent")
        return e.eventId ? "plays an event clip" : "plays nothing (pick an event)";
    if (e.kind === "textBox")
        return e.box ? `sets the "${e.box}" text box${e.seconds > 0 ? ` for ${mins(e.seconds)}` : ""}` : "sets nothing (pick a text box)";
    return "does nothing";
}

// ---------------------------------------------------------------------------
// the "mb <action>" command, from the dashboard terminal or from chat
// ---------------------------------------------------------------------------

// one implementation so the two can't drift, same contract as runFiresaleCommand. `self` is who typed it in
// chat (blank from the terminal); the actions that name somebody else are gated on `isMod` by the caller.
export function runMysteryBoxCommand(session: TimerUserSession, cmd: { action: string, name: string, count: number },
    self?: { login: string, displayName: string }): { ok: boolean, message: string } {
    const cfg = mbSettings(session);
    const target = cmd.name || (self ? self.login : "");
    const targetName = cmd.name || (self ? self.displayName : "");

    if (cmd.action === "open"){
        if (!target)
            return { ok: false, message: "Usage: mb open <name> — or type !mb open in chat." };
        return openMysteryBox(session, target, targetName);
    }
    if (cmd.action === "count"){
        if (!target)
            return { ok: false, message: "Usage: mb count <name>" };
        const n = boxCount(session, target);
        return { ok: true, message: `${targetName || target} has ${n} mystery box${n === 1 ? "" : "es"}.` };
    }
    if (cmd.action === "give"){
        if (!cmd.name)
            return { ok: false, message: "Usage: mb give <name> [count]" };
        const n = Math.max(1, Math.min(9999, Math.trunc(cmd.count) || 1));
        const held = grantMysteryBox(session, cmd.name, cmd.name, n);
        return { ok: true, message: `Gave ${cmd.name} ${n} mystery box${n === 1 ? "" : "es"} — they hold ${held}.` };
    }
    if (cmd.action === "take"){
        if (!cmd.name)
            return { ok: false, message: "Usage: mb take <name> [count]" };
        const have = boxCount(session, cmd.name);
        if (!have)
            return { ok: false, message: `${cmd.name} isn't holding any boxes.` };
        const n = Math.max(1, Math.min(have, Math.trunc(cmd.count) || 1));
        const held = grantMysteryBox(session, cmd.name, cmd.name, -n);
        return { ok: true, message: `Took ${n} box${n === 1 ? "" : "es"} from ${cmd.name} — they hold ${held}.` };
    }
    if (cmd.action === "stop"){
        if (!isOpening(session))
            return { ok: false, message: "No mystery box is being opened." };
        endMysteryBox(session);
        return { ok: true, message: "Mystery box cleared off the overlay." };
    }
    // test: run the whole sequence on a named prize without spending anybody's box, so the operator can see
    // what a prize looks and sounds like — the effect fires for real, exactly as it would in front of chat
    const prize = cmd.name ? findPrize(session, cmd.name) : null;
    if (cmd.name && !prize)
        return { ok: false, message: `No prize called "${cmd.name}". Try: ${cfg.prizes.map((p: any) => p.name || p.id).join(", ") || "(none set up)"}.` };
    return testMysteryBox(session, prize ? prize.id : "");
}

// the dashboard's Test: spin the reel for real, landing on a named prize (or a fair draw when none is named),
// without taking a box off anybody.
export function testMysteryBox(session: TimerUserSession, prizeId: string): { ok: boolean, message: string } {
    if (isOpening(session))
        return { ok: false, message: "A box is already being opened." };
    const prize = prizeId ? findPrize(session, prizeId) : drawPrize(session);
    if (!prize)
        return { ok: false, message: "No prize is set up to be won yet." };
    const cfg = mbSettings(session);
    const mb = getMysteryBox(session);
    mb.nonce = (mb.nonce || 0) + 1;
    mb.phase = "spinning";
    mb.opener = "test";
    mb.openerName = "TEST";
    mb.isTest = true; // a rehearsal changes the timer for real, but it must not announce itself to chat
    mb.prizeId = prize.id;
    const strip = buildReel(session, prize.id);
    mb.reel = strip.reel;
    mb.startIndex = strip.startIndex;
    mb.landIndex = strip.landIndex;
    mb.startedAt = Date.now();
    mb.endsAt = Date.now() + cfg.spinSec * 1000;
    mb.wonAt = 0;
    pushMysteryBox(session);
    const t = slots(session.userId);
    clearTimeout(t.land);
    clearTimeout(t.done);
    t.land = setTimeout(() => {
        try {
            landMysteryBox(session);
        } catch (err) {
            reportError(session.userId, "landing a test mystery box", err);
            endMysteryBox(session);
        }
    }, cfg.spinSec * 1000);
    return { ok: true, message: `Testing "${prize.name || prize.id}" — ${describeEffect(prize.effect)}.` };
}

// ---------------------------------------------------------------------------
// the ray gun
// ---------------------------------------------------------------------------

// how long one shot times somebody out for. the prize that granted the charges says, but a charge doesn't
// remember which prize it came from, so the CURRENT ray gun prize's setting is what a shot is worth — which
// also means the operator can retune it without invalidating shots people are already holding.
export function raygunSeconds(session: TimerUserSession): number {
    const prize = mbSettings(session).prizes.find((p: any) => p.effect && p.effect.kind === "raygun" && p.effect.seconds > 0);
    return prize ? Math.min(MAX_NUKE_SEC, prize.effect.seconds) : 600;
}

// fire one. the charge is spent up front and handed back if the shot doesn't land, because the alternative —
// checking first — can't tell the difference between a name nobody has and a name twitch will refuse.
export async function shootRaygun(session: TimerUserSession, shooter: any, shooterName: any, target: any): Promise<{ ok: boolean, message: string }> {
    const key = boxKey(shooter);
    const who = str(shooterName, MAX_NAME) || key;
    const at = resolveTarget(session, target);
    if (!key)
        return { ok: false, message: "" };
    if (!at)
        return { ok: false, message: `@${who} shoot who? Try !${mbSettings(session).raygunCommand} someone.` };
    if (raygunCount(session, key) < 1)
        return { ok: false, message: `@${who} you have no ray gun shots left.` };
    const secs = raygunSeconds(session);

    grantRaygun(session, key, who, -1);
    const res = await chatTimeoutOne(session, at, secs, `ray gun — ${who}`);
    if (!res.ok){
        // it didn't land, so they keep the shot. a charge silently eaten by a typo'd name would be the
        // worst possible outcome for something won from a prize.
        grantRaygun(session, key, who, 1);
        return { ok: false, message: `@${who} that shot missed — ${res.message}. You keep it.` };
    }
    const left = raygunCount(session, key);
    const mins = Math.round(secs / 60);
    emitTerminal(session.userId, `RAYGUN — ${who} shot ${at} (${secs}s); ${left} shot${left === 1 ? "" : "s"} left.`, true);
    return {
        ok: true,
        message: `@${who} shot @${at} with the ray gun — ${mins >= 1 ? `${mins} minute${mins === 1 ? "" : "s"}` : `${secs} seconds`} in the shadow realm. ${left} shot${left === 1 ? "" : "s"} left.`,
    };
}

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

// "!raygun <name>" fires one; "!raygun" on its own says how many are left. open to every chatter, since the
// whole point is that a viewer won them. returns true if the line was consumed.
export function handleRaygunChat(session: TimerUserSession, login: string, displayName: string, text: string): boolean {
    const cfg = mbSettings(session);
    const body = String(text || "").trim();
    if (!body.startsWith("!"))
        return false;
    const parts = body.slice(1).split(/\s+/);
    if (parts[0].toLowerCase() !== cfg.raygunCommand)
        return false;
    const who = String(displayName || login || "");

    if (!parts[1]){
        const n = raygunCount(session, login);
        if (tellNow(session.userId, String(login || "")))
            chatSay(session, n > 0
                ? `@${who} you have ${n} ray gun shot${n === 1 ? "" : "s"} — !${cfg.raygunCommand} <name> to use one.`
                : `@${who} you have no ray gun shots.`);
        return true;
    }
    shootRaygun(session, login, who, parts[1]).then((res) => {
        // a hit is always announced — that's the whole point of shooting somebody in front of chat. a miss
        // is rate limited like any other refusal, so a wrong name typed over and over can't flood.
        if (res.message && (res.ok || tellNow(session.userId, String(login || ""))))
            chatSay(session, res.message);
    }).catch((err) => reportError(session.userId, "firing a ray gun", err));
    return true;
}

// how often one person may be told why they can't open a box
const TELL_COOLDOWN = 20000;
const toldAt: { [userId: number]: { [login: string]: number } } = {};

function tellNow(userId: number, login: string): boolean {
    const mine = toldAt[userId] || (toldAt[userId] = {});
    const now = Date.now();
    // sweep anyone whose cooldown lapsed, so a long stream can't grow this without bound
    for (const k of Object.keys(mine))
        if (now - mine[k] > TELL_COOLDOWN)
            delete mine[k];
    if (mine[login] !== undefined)
        return false;
    mine[login] = now;
    return true;
}

// every twitch chat line gets offered here, the same way firesale does it. returns true if the line was
// consumed as mysterybox traffic and the caller should stop processing it.
// "!mb open" and "!mb count" are open to EVERY chatter — they're spending their own box and asking about
// their own wallet. the actions that name somebody else (give / take / stop / test) are mod-only.
export function handleMysteryBoxChat(session: TimerUserSession, login: string, displayName: string, text: string, isMod: boolean): boolean {
    const cfg = mbSettings(session);
    const body = String(text || "").trim();
    if (!body.startsWith("!"))
        return false;
    const parts = body.slice(1).split(/\s+/);
    if (parts[0].toLowerCase() !== cfg.command)
        return false;

    const action = (parts[1] || "").toLowerCase();
    const self = { login: String(login || ""), displayName: String(displayName || login || "") };

    if (action === "open" || action === ""){
        const res = openMysteryBox(session, self.login, self.displayName);
        if (res.ok || !res.message){
            // a blank message is the deliberate silence: the feature is off, or there was nothing to say
            if (res.message)
                emitTerminal(session.userId, `Chat (${self.login}): ${res.message}`, true);
            return true;
        }
        // a refusal is told to the person who asked — being ignored looks like the bot is broken. but only
        // once in a while per person: a modded account that answers every "!mb open" is a modded account
        // anyone can make flood chat, and twitch drops a bot's messages once it's over the rate limit.
        if (tellNow(session.userId, self.login))
            chatSay(session, res.message);
        return true;
    }
    if (action === "count"){
        // a mod may ask about somebody else; everyone else gets their own count however they type it. the
        // name is held to twitch's own login grammar because whatever comes back is SAID in chat, and
        // "!mb count <anything>" would otherwise be a way to make the bot repeat arbitrary text.
        const named = resolveTarget(session, parts[2]);
        const who = isMod && named ? named : self.login;
        const label = isMod && named ? (mbBoxes(session)[boxKey(named)] || {}).name || named : self.displayName;
        const n = boxCount(session, who);
        // through the chat seam, which reports to the terminal when no bot account is connected — so this
        // answers in chat the moment one is, with no change here.
        // throttled per asker like every other reply: a modded account that answers every "!mb count" is one
        // a few viewers can push past its own rate limit, at which point twitch drops the messages that
        // matter (a prize landing, a ray gun hit) along with the spam.
        if (tellNow(session.userId, self.login))
            chatSay(session, `@${label} has ${n} mystery box${n === 1 ? "" : "es"}.`);
        return true;
    }
    if (!isMod)
        return true; // consumed: a non-mod typing "!mb give" gets silence, not a passthrough to the parser
    const res = runMysteryBoxCommand(session, {
        action: ["give", "take", "stop", "test"].includes(action) ? action : "count",
        name: (parts[2] || "").replace(/^@/, ""),
        count: Number(parts[3]) || 1,
    }, self);
    if (res.message)
        emitTerminal(session.userId, `Chat (${self.login}): ${res.message}`, res.ok);
    return true;
}
