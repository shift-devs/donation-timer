// which ! commands a twitch mod may run in chat. each entry on the Permissions tab has a switch and an optional
// whitelist of mods: switched off, no mod may use it; switched on with an empty whitelist, every mod may; switched
// on with names in it, only those mods may. a refusal is silent in chat, with a line on the terminal saying who
// tried. the broadcaster is never held back, and the terminal and the dashboard's own buttons don't go through
// here at all — this is only about chat.

import { TimerUserSession, TimerEvent } from "./types";

export type ChatPermission = { on: boolean, mods: string[] };

// the mystery box controls used to be one switch, "mb". they're one entry each now, so handing out boxes can be
// kept to a few trusted mods without taking the quick revive away from the rest.
export const MB_ACTIONS = ["give", "take", "stop", "test", "revive"];

export const CHAT_PERMISSION_KEYS = ["time", "subs", "bits", "money", "text", "firesale", "raffle",
    ...MB_ACTIONS.map((a) => `mb_${a}`), "drop"];

// everything a mod could do before this tab existed, except drops, which were already taken out of chat
const DEFAULT_ON: { [key: string]: boolean } = {
    time: true,
    subs: true,
    bits: true,
    money: true,
    text: true,
    firesale: true,
    raffle: true,
    mb_give: true,
    mb_take: true,
    mb_stop: true,
    mb_test: true,
    mb_revive: true,
    drop: false,
};

const MAX_MODS = 100;

// twitch logins, lowercase, no @, held to the login grammar so a stray comma or space can't make a name that
// never matches
function cleanMods(raw: any): string[] {
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
    const out: string[] = [];
    for (const m of list){
        const login = String(m || "").trim().replace(/^@/, "").toLowerCase();
        if (/^[a-z0-9_]{1,25}$/.test(login) && !out.includes(login))
            out.push(login);
    }
    return out.slice(0, MAX_MODS);
}

// one stored entry. older rows hold a bare true/false per key, which is read as on/off with nobody listed.
function normalizeEntry(raw: any, fallbackOn: boolean): ChatPermission {
    if (typeof raw === "boolean")
        return { on: raw, mods: [] };
    if (raw && typeof raw === "object" && !Array.isArray(raw))
        return { on: raw.on === undefined ? fallbackOn : !!raw.on, mods: cleanMods(raw.mods) };
    return { on: fallbackOn, mods: [] };
}

export function normalizeChatPermissions(raw: any): { [key: string]: ChatPermission } {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out: { [key: string]: ChatPermission } = {};
    for (const k of CHAT_PERMISSION_KEYS){
        // a channel saved before the mystery box split carries the old single "mb" switch; each new entry
        // starts from it, so a channel that had mods held off the box keeps them held off
        const stored = r[k] === undefined && k.startsWith("mb_") ? r.mb : r[k];
        out[k] = normalizeEntry(stored, DEFAULT_ON[k]);
    }
    return out;
}

// the tab sends a patch of just the entries (and just the fields) it changed
export function mergeChatPermissions(current: any, patch: any): { [key: string]: ChatPermission } {
    const base = normalizeChatPermissions(current);
    const p = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    for (const k of CHAT_PERMISSION_KEYS){
        if (p[k] === undefined)
            continue;
        const change = typeof p[k] === "boolean" ? { on: p[k] } : (p[k] && typeof p[k] === "object" ? p[k] : {});
        base[k] = normalizeEntry({ ...base[k], ...change }, base[k].on);
    }
    return base;
}

// the group a time-granting command falls under
export function eventPermission(e: TimerEvent): string {
    if (e.kind === "time")
        return "time";
    if (e.kind === "sub" || e.kind === "member")
        return "subs";
    if (e.kind === "bits")
        return "bits";
    return "money";
}

// the permission key behind a mystery box chat action, or "" for the ones open to everyone (open, count)
export function mbPermission(action: string): string {
    return MB_ACTIONS.includes(action) ? `mb_${action}` : "";
}

// why a mod can't use this, or "" if they can. the broadcaster check is the caller's.
export function modRefusal(session: TimerUserSession, key: string, login: string): string {
    if (!key)
        return "";
    const perms = normalizeChatPermissions(session.chatPermissions);
    session.chatPermissions = perms;
    const entry = perms[key];
    if (!entry || !entry.on)
        return "mods can't use that in chat";
    if (entry.mods.length && !entry.mods.includes(String(login || "").toLowerCase()))
        return "they aren't on that command's mod list";
    return "";
}

export function modMay(session: TimerUserSession, key: string, login: string): boolean {
    return !modRefusal(session, key, login);
}
