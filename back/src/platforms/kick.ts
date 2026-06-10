import { TimerUserSession, TimerEvent } from "../types";
import { diag } from "../diag";

// kick has no direct adapter — its subs are relayed over the streamlabs socket as a `subscription` with
// for:"kick_account". this file owns translating those (single-tier subs + gifted subs).

// claims the kick events streamlabs relays. returns true if it handled `e`, false to let another adapter try.
export function handleKickStreamlabsEvent(session: TimerUserSession, e: any, m: any, emit: (ev: TimerEvent) => void): boolean {
    if (e.type !== "subscription" || e.for !== "kick_account")
        return false;
    // label by the watched streamer's twitch channel, not the operator login (session.name)
    const watching = session.connections.twitch.channel || session.name;
    // kick's socket payload is undocumented; surface it to diagnostics.log to confirm sub-vs-gift fields
    diag(`(${watching}) KICK-SUB-PAYLOAD ${JSON.stringify(e)}`);
    const gifter = m.gifter || m.gifterName || m.gifter_username;
    const isGift = !!(m.gifted || m.isGift || gifter);
    let count = Number(m.amount) || Number(m.gift_count) || Number(m.quantity) || 1;
    count = Math.min(Math.max(Math.trunc(count), 1), 100); // guard against a misread field inflating time
    if (isGift)
        emit({ platform: "kick", kind: "member", unit: "gift", count, label: `${count}x gift sub from ${gifter || m.name}` });
    else
        emit({ platform: "kick", kind: "member", unit: "subscription", count: 1, label: `sub from ${m.name}` });
    return true;
}
