// which ! commands a twitch mod may run in chat. one switch per group on the Permissions tab; a group that's off
// is refused in chat with a line on the terminal saying who tried. the broadcaster is never held back, and the
// terminal and the dashboard's own buttons don't go through here at all — this is only about chat.

import { TimerUserSession, TimerEvent } from "./types";

export const CHAT_PERMISSION_KEYS = ["time", "subs", "bits", "money", "text", "firesale", "raffle", "mb", "drop"];

// everything a mod could do before this tab existed, except drops, which were already taken out of chat
export const DEFAULT_CHAT_PERMISSIONS: { [key: string]: boolean } = {
    time: true,
    subs: true,
    bits: true,
    money: true,
    text: true,
    firesale: true,
    raffle: true,
    mb: true,
    drop: false,
};

export function normalizeChatPermissions(raw: any): { [key: string]: boolean } {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out: { [key: string]: boolean } = {};
    for (const k of CHAT_PERMISSION_KEYS)
        out[k] = r[k] === undefined ? DEFAULT_CHAT_PERMISSIONS[k] : !!r[k];
    return out;
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

export function modMay(session: TimerUserSession, key: string): boolean {
    const perms = session.chatPermissions || (session.chatPermissions = normalizeChatPermissions(null));
    return !!perms[key];
}
