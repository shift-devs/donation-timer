// box leaderboard: who has bought the most boxes off the fourthwall shop, for the /boxboard browser source.
// two things count, both by quantity: an ordinary order of a box product (buying for yourself), and a box put
// up for firesale (buying one for chat). the streamer picks which products are "boxes" on the tab, and
// wipes the board whenever they like with the reset button.
//
// the tallies are PERSISTED (boxBoard column), the look is config (boxBoardSettings). a restart mid-stream
// must not lose the standings — the board only goes back to zero when somebody presses reset.
//
// a firesale is counted off fourthwall's chat announcement, not the order poll. the gifter's purchase never
// shows up in /order — what does is one $0 TWITCH_GIFT_REDEMPTION order per WINNER when they claim it, and
// those are skipped, or every winner would be credited with a box they didn't pay for.

import { TimerUserSession } from "./types";
import { emitSync, emitTerminal } from "./bus";
import { Ledger, ledgerGrant, ledgerCount, ledgerRows, ledgerKey, normalizeLedger } from "./ledger";
import { matchable, alreadyMintedFor } from "./mysterybox";

const MAX_TITLE = 60;
const MAX_TOP = 25;
const MAX_PRODUCTS = 100;
const MAX_PRODUCT_NAME = 200;
const TRANSPARENT = "transparent";

export const BOARD_ACTIONS = ["reset", "add", "take", "set"];

export const DEFAULT_BOX_BOARD = {
    // the heading over the list. blank = no heading
    title: "TOP BOX BUYERS",
    // how many places the board shows
    top: 5,
    // which fourthwall products are boxes: { id, name }. the id matches order lines, the name matches the
    // item in a firesale announcement (which only ever carries a name). empty = nothing counts yet
    products: [] as { id: string, name: string }[],
    // buying a box for yourself
    countOrders: true,
    // putting a box up for firesale
    countFiresales: true,
    // the number next to each name
    showCounts: true,
    fontSize: 36,
    bgColor: TRANSPARENT,
    titleColor: "#ffd400",
    nameColor: "#ffffff",
    countColor: "#22c55e",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

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

function normalizeProducts(raw: any): { id: string, name: string }[] {
    if (!Array.isArray(raw))
        return [];
    const out: { id: string, name: string }[] = [];
    for (const p of raw){
        if (out.length >= MAX_PRODUCTS)
            break;
        const id = p && typeof p.id === "string" ? p.id.trim().slice(0, 100) : "";
        if (!id || out.some((o) => o.id === id))
            continue;
        out.push({ id, name: typeof p.name === "string" ? p.name.slice(0, MAX_PRODUCT_NAME) : "" });
    }
    return out;
}

// the tab's settings, from untrusted input. front/src/boxBoard.ts mirrors these defaults and limits.
export function normalizeBoxBoard(raw: any): any {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const d = DEFAULT_BOX_BOARD;
    return {
        title: typeof r.title === "string" ? r.title.slice(0, MAX_TITLE) : d.title,
        top: numIn(r.top, 1, MAX_TOP, d.top),
        products: r.products === undefined ? d.products : normalizeProducts(r.products),
        countOrders: r.countOrders === undefined ? d.countOrders : !!r.countOrders,
        countFiresales: r.countFiresales === undefined ? d.countFiresales : !!r.countFiresales,
        showCounts: r.showCounts === undefined ? d.showCounts : !!r.showCounts,
        fontSize: numIn(r.fontSize, 12, 120, d.fontSize),
        bgColor: hexOr(r.bgColor, d.bgColor, TRANSPARENT),
        titleColor: hexOr(r.titleColor, d.titleColor),
        nameColor: hexOr(r.nameColor, d.nameColor),
        countColor: hexOr(r.countColor, d.countColor),
    };
}

export const normalizeBoxBoardTally = normalizeLedger;

export function boardSettings(session: TimerUserSession): any {
    return session.boxBoardSettings || (session.boxBoardSettings = normalizeBoxBoard(null));
}

export function boardTally(session: TimerUserSession): Ledger {
    return session.boxBoard || (session.boxBoard = {});
}

// what the /boxboard source draws: the look plus the top N. a tie shares a place (1, 2, 2, 4), so two
// people on the same count never look ranked against each other.
export function boxBoardView(session: TimerUserSession): any {
    const cfg = boardSettings(session);
    const rows = ledgerRows(boardTally(session)).slice(0, cfg.top);
    let place = 0;
    const out = rows.map((r, i) => {
        if (i === 0 || r.count !== rows[i - 1].count)
            place = i + 1;
        return { place, name: r.name, count: r.count };
    });
    return {
        title: cfg.title,
        top: cfg.top,
        showCounts: cfg.showCounts,
        fontSize: cfg.fontSize,
        bgColor: cfg.bgColor,
        titleColor: cfg.titleColor,
        nameColor: cfg.nameColor,
        countColor: cfg.countColor,
        rows: out,
    };
}

function credit(session: TimerUserSession, name: string, n: number, why: string){
    const held = ledgerGrant(boardTally(session), name, name, n);
    emitTerminal(session.userId, `BOX BOARD — ${name} +${n} (${why}); ${held} total.`, true);
    emitSync(session.userId);
}

// a fourthwall order. only its box lines count, each by quantity. the winner's claim on a firesale item comes
// through as an order too, and is skipped — the gifter paid for that one, and was counted at the firesale.
export function creditBoardOrder(session: TimerUserSession, order: any){
    const cfg = boardSettings(session);
    if (!cfg.countOrders || !cfg.products.length || !order)
        return;
    const source = order.source && order.source.type;
    if (source && source !== "ORDER")
        return;
    const buyer = typeof order.username === "string" ? order.username.trim() : "";
    if (!ledgerKey(buyer))
        return; // nobody to put on the board
    const ids = new Set(cfg.products.map((p: any) => p.id));
    let boxes = 0;
    for (const line of Array.isArray(order.offers) ? order.offers : []){
        if (line && ids.has(String(line.id)))
            boxes += Math.max(1, Math.trunc(Number(line.variant && line.variant.quantity)) || 1);
    }
    if (boxes > 0)
        credit(session, buyer, boxes, `bought ${boxes === 1 ? "a box" : `${boxes} boxes`}`);
}

// is this firesale item one of the boxes? the announcement only names the item, and puts a count in front of
// it when there's more than one ("3 Collector's Edition — …"), so that's taken off before comparing. either
// containing the other counts, so a product name and fourthwall's wording of it don't have to agree exactly.
export function boardProductFor(session: TimerUserSession, prize: any, qty = 1): any | null {
    let item = matchable(prize);
    if (qty > 1)
        item = item.replace(/^\d{1,3}\s+/, "");
    if (item.length < 3)
        return null;
    return boardSettings(session).products.find((p: any) => {
        const name = matchable(p.name);
        return name.length >= 3 && (item.includes(name) || name.includes(item));
    }) || null;
}

// somebody put an item up for firesale. called both from a firesale starting and from an announcement that
// arrives while the overlay is switched off — the board counts either way, and the dedupe window stops a
// replayed announcement counting twice.
export function creditBoardFiresale(session: TimerUserSession, gifter: any, prize: any, qty: any){
    const cfg = boardSettings(session);
    const name = String(gifter || "").trim();
    if (!cfg.countFiresales || !cfg.products.length || !ledgerKey(name))
        return;
    const n = Math.max(1, Math.trunc(Number(qty)) || 1);
    if (!boardProductFor(session, prize, n)){
        emitTerminal(session.userId, `BOX BOARD — "${prize || "an item"}" isn't one of the leaderboard's boxes, not counted.`);
        return;
    }
    if (alreadyMintedFor(session.userId, `board\u0000${name}\u0000${prize}`))
        return;
    credit(session, name, n, `put ${n === 1 ? "a box" : `${n} boxes`} up for firesale`);
}

export function resetBoxBoard(session: TimerUserSession){
    session.boxBoard = {};
    emitTerminal(session.userId, "BOX BOARD — reset, everyone back to zero.", true);
    emitSync(session.userId);
}

// "board reset | add <name> [n] | take <name> [n] | set <name> <n>", from the terminal or the tab. add/take/set
// are for fixing a count by hand — a purchase under a name that isn't the one they go by, a missed
// announcement, or a firesale that got counted twice. set 0 takes them off the board.
export function runBoxBoardCommand(session: TimerUserSession, cmd: { action: string, name: string, count: number }): { ok: boolean, message: string } {
    if (cmd.action === "reset"){
        resetBoxBoard(session);
        return { ok: true, message: "Box leaderboard reset." };
    }
    if (!cmd.name)
        return { ok: false, message: `Usage: board ${cmd.action} <name> [count]` };
    if (cmd.action === "set"){
        const want = Math.max(0, Math.min(9999, Math.trunc(Number(cmd.count)) || 0));
        const have = ledgerCount(boardTally(session), cmd.name);
        // keep the name as it's already written when they're on the board; a new row takes it as typed
        ledgerGrant(boardTally(session), cmd.name, have ? "" : cmd.name, want - have);
        emitSync(session.userId);
        return { ok: true, message: want
            ? `Set ${cmd.name} to ${want} on the box leaderboard (was ${have}).`
            : `Took ${cmd.name} off the box leaderboard (was ${have}).` };
    }
    const n = Math.max(1, Math.min(9999, Math.trunc(cmd.count) || 1));
    if (cmd.action === "take"){
        const have = ledgerCount(boardTally(session), cmd.name);
        if (!have)
            return { ok: false, message: `${cmd.name} isn't on the box leaderboard.` };
        const left = ledgerGrant(boardTally(session), cmd.name, "", -Math.min(have, n));
        emitSync(session.userId);
        return { ok: true, message: `Took ${Math.min(have, n)} from ${cmd.name} on the box leaderboard — ${left} left.` };
    }
    const held = ledgerGrant(boardTally(session), cmd.name, cmd.name, n);
    emitSync(session.userId);
    return { ok: true, message: `Added ${n} to ${cmd.name} on the box leaderboard — ${held} total.` };
}
