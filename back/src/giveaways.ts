// giveaway winners: chatters who won something the client has to ship by hand — a box's "Giveaway" prize, or a
// minigame (cup and ball, solve for x, shell game, vote 'em up) whose prize names a giveaway. each win is one
// row, kept until the client deletes it, and listed on the dashboard's Giveaways tab with a "shipped" tick.
//
// it's a jsonb column on Users like the ledgers, saved with them: a win is owed, so it outlives a restart.

import { TimerUserSession } from "./types";
import { emitSync, emitTerminal } from "./bus";

const MAX_GIVEAWAY = 80;    // the giveaway's name, as typed on the prize
const MAX_SOURCE = 120;     // what it was won from: "mystery box: Signed hoodie", "drop: Shell game"…
const MAX_NOTE = 500;       // the client's own note — an address taken over DMs, a tracking number
const MAX_ROWS = 5000;      // a safety cap; the oldest SHIPPED rows go first, unshipped ones are never dropped

export interface GiveawayWin {
    id: string
    t: number            // when it was won, ms
    giveaway: string     // which giveaway — the name on the prize
    source: string       // where it came from
    login: string        // twitch login (lowercase), for matching them up later
    name: string         // their display name
    shipped: boolean
    note: string
}

function str(v: any, max: number): string {
    return typeof v === "string" ? v.slice(0, max) : "";
}

export function giveawayName(v: any): string {
    return str(typeof v === "string" ? v.trim() : "", MAX_GIVEAWAY);
}

export function normalizeGiveawayWinners(raw: any): GiveawayWin[] {
    if (!Array.isArray(raw))
        return [];
    const out: GiveawayWin[] = [];
    for (const r of raw){
        if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.id)
            continue;
        out.push({
            id: r.id.slice(0, 40),
            t: Number.isFinite(Number(r.t)) ? Number(r.t) : 0,
            giveaway: giveawayName(r.giveaway),
            source: str(r.source, MAX_SOURCE),
            login: str(r.login, 40).toLowerCase(),
            name: str(r.name, 40),
            shipped: !!r.shipped,
            note: str(r.note, MAX_NOTE),
        });
    }
    return out;
}

function rows(session: TimerUserSession): GiveawayWin[] {
    if (!Array.isArray(session.giveawayWinners))
        session.giveawayWinners = [];
    return session.giveawayWinners;
}

// somebody won a giveaway. returns the new row. a test spin must never get here — callers check.
export function recordGiveawayWin(session: TimerUserSession, giveaway: string, login: any, displayName: any, source: string): GiveawayWin {
    const list = rows(session);
    const key = String(login || "").trim().replace(/^@/, "").toLowerCase();
    const row: GiveawayWin = {
        id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        t: Date.now(),
        giveaway: giveawayName(giveaway) || "Giveaway",
        source: str(source, MAX_SOURCE),
        login: key.slice(0, 40),
        name: str(String(displayName || key), 40),
        shipped: false,
        note: "",
    };
    list.push(row);
    while (list.length > MAX_ROWS){
        const i = list.findIndex((r) => r.shipped);
        if (i < 0)
            break;
        list.splice(i, 1);
    }
    emitTerminal(session.userId, `GIVEAWAY — ${row.name} won "${row.giveaway}" (${row.source}). Logged on the Giveaways tab to ship.`, true);
    emitSync(session.userId);
    return row;
}

// the dashboard tab's edits: tick shipped, write a note, or delete a row
export function updateGiveawayWin(session: TimerUserSession, id: any, patch: any): boolean {
    const row = rows(session).find((r) => r.id === id);
    if (!row || !patch || typeof patch !== "object")
        return false;
    if (typeof patch.shipped === "boolean")
        row.shipped = patch.shipped;
    if (typeof patch.note === "string")
        row.note = patch.note.slice(0, MAX_NOTE);
    emitSync(session.userId);
    return true;
}

export function deleteGiveawayWin(session: TimerUserSession, id: any): boolean {
    const list = rows(session);
    const i = list.findIndex((r) => r.id === id);
    if (i < 0)
        return false;
    list.splice(i, 1);
    emitSync(session.userId);
    return true;
}
