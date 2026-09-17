// a ledger of things viewers have earned and not yet spent: unopened mystery boxes, unfired ray gun charges.
//
// keyed by the LOGIN, lowercased, because that's the only name twitch guarantees is stable — display names
// differ in case and can be changed. the display name rides along purely so the dashboard can show people as
// they write themselves.
//
// both ledgers are PERSISTED, unlike everything else the mystery box touches. a box or a charge is a debt
// owed to somebody who earned it, and a restart that quietly cancelled it would be robbing them.

const MAX_NAME = 25;      // twitch's own username ceiling
const MAX_OWNERS = 5000;  // rows; past this the smallest holdings are dropped (see normalizeLedger)
const MAX_HELD = 9999;    // how many one person can be holding of one thing

export type Ledger = { [login: string]: { name: string, count: number } };

export function ledgerKey(name: any): string {
    return String(name || "").trim().replace(/^@/, "").toLowerCase().slice(0, MAX_NAME);
}

export function normalizeLedger(raw: any): Ledger {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const rows: { key: string, name: string, count: number }[] = [];
    for (const k of Object.keys(r)){
        const key = ledgerKey(k);
        if (!key)
            continue;
        const v = r[k];
        // tolerate a bare number as well as the {name,count} row, so a hand-edited column still loads
        const rawCount = typeof v === "object" && v ? v.count : v;
        const n = Number(rawCount);
        const count = Number.isFinite(n) ? Math.min(MAX_HELD, Math.max(0, Math.round(n))) : 0;
        if (count <= 0) // nothing held: drop the row rather than carry an empty one forever
            continue;
        const name = typeof v === "object" && v && typeof v.name === "string" ? v.name.slice(0, MAX_NAME) : "";
        rows.push({ key, name: name || key, count });
    }
    // over the cap, keep the biggest holdings — those are the ones somebody is still waiting to spend
    rows.sort((a, b) => b.count - a.count);
    const out: Ledger = {};
    for (const row of rows.slice(0, MAX_OWNERS))
        out[row.key] = { name: row.name, count: row.count };
    return out;
}

export function ledgerCount(map: Ledger, login: any): number {
    const row = map[ledgerKey(login)];
    return row ? Math.max(0, Math.trunc(Number(row.count) || 0)) : 0;
}

// add (or, with a negative n, take away). returns what they hold afterwards.
export function ledgerGrant(map: Ledger, login: any, displayName: any, n: number): number {
    const key = ledgerKey(login);
    if (!key)
        return 0;
    const row = map[key];
    const next = Math.min(MAX_HELD, Math.max(0, (row ? row.count : 0) + Math.trunc(n)));
    const name = (typeof displayName === "string" ? displayName.slice(0, MAX_NAME) : "") || (row && row.name) || key;
    if (next <= 0){
        delete map[key];
        return 0;
    }
    // a brand new row at the ceiling can't be stored. report what they ACTUALLY hold (nothing) rather than
    // what they would have held — the caller announces this number in chat and on the terminal, and telling
    // somebody they now hold a box that was dropped on the floor is worse than the ceiling itself.
    if (!row && Object.keys(map).length >= MAX_OWNERS)
        return 0;
    map[key] = { name, count: next };
    return next;
}

// move one row onto another name. returns how many moved, or -1 if there was nothing there.
export function ledgerRename(map: Ledger, from: any, to: any): number {
    const src = ledgerKey(from);
    const dst = ledgerKey(to);
    if (!src || !dst || src === dst)
        return -1;
    const row = map[src];
    if (!row)
        return -1;
    const moved = row.count;
    delete map[src];
    ledgerGrant(map, dst, to, moved);
    return moved;
}

// biggest holdings first — that's who is about to spend one
export function ledgerRows(map: Ledger): { key: string, name: string, count: number }[] {
    return Object.keys(map)
        .map((k) => ({ key: k, name: map[k].name || k, count: map[k].count || 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
