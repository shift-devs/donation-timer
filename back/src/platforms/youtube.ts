import { TimerUserSession, TimerEvent } from "../types";
import { diag } from "../diag";

// youtube has no direct adapter — its events are relayed over the streamlabs socket (super chats/stickers as their own
// event types, memberships as a `subscription` with for:"youtube_account"). this file owns translating those.

// parse a money amount that may arrive as a number or a formatted string ("5.00", "$5") -> finite number
function parseMoney(v: any): number {
    return Number(typeof v === "string" ? v.replace(/[^0-9.-]/g, "") : v) || 0;
}

// streamlabs relays the super chat/sticker amount in micros (x1,000,000), e.g. "2000000" = $2.00
function emitSuperChat(m: any, unit: "superchat" | "supersticker", emit: (ev: TimerEvent) => void){
    const usd = parseMoney(m.amount) / 1000000;
    const who = m.name || "someone";
    const shown = m.displayString || `$${usd}`;
    emit({ platform: "youtube", kind: "money", usd, unit, label: `Super ${unit === "supersticker" ? "Sticker" : "Chat"} ${shown} from ${who}` });
}

// temporary diagnostic: client's youtube membership levels are enjoyer / full membership / quickster.
// streamlabs doesn't document which field carries the level, so scan the raw payload for these known strings
// to pinpoint the exact key. remove once we know the field and wire per-tier rates.
const KNOWN_YT_LEVELS = ["enjoyer", "full membership", "quickster"];
function probeLevelField(obj: any, path: string, sink: (line: string) => void){
    if (obj && typeof obj === "object"){
        for (const k of Object.keys(obj))
            probeLevelField(obj[k], path ? `${path}.${k}` : k, sink);
    } else if (typeof obj === "string"){
        const low = obj.toLowerCase();
        if (KNOWN_YT_LEVELS.some((l) => low.includes(l)))
            sink(`YT-LEVEL-FIELD-FOUND at "${path}" = ${JSON.stringify(obj)}`);
    }
}

// claims the youtube events streamlabs relays. returns true if it handled `e`, false to let another adapter try.
export function handleYoutubeStreamlabsEvent(session: TimerUserSession, e: any, m: any, emit: (ev: TimerEvent) => void): boolean {
    switch (e.type){
        case "superchat":
            emitSuperChat(m, "superchat", emit);
            return true;
        case "supersticker":
            emitSuperChat(m, "supersticker", emit);
            return true;
        case "subscription": {
            if (e.for !== "youtube_account")
                return false;
            // surface the raw payload + detected level to diagnostics.log so we can confirm the tier field
            diag(`(${session.name}) YT-MEMBERSHIP-PAYLOAD ${JSON.stringify(e)}`);
            probeLevelField(e, "", (line) => diag(`(${session.name}) ${line}`));
            const gifter = m.gifter || m.gifterName || m.gifter_username;
            const isGift = !!(m.gifted || m.isGift || gifter);
            let count = Number(m.amount) || Number(m.gift_count) || Number(m.quantity) || 1;
            count = Math.min(Math.max(Math.trunc(count), 1), 100); // guard against a misread field inflating time
            // youtube membership tiers are arbitrary creator-named levels; surface whatever level field SL sends.
            const level = m.membershipLevelName || m.membership_level_name || m.levelName || m.level || m.tier;
            const lvl = level ? ` [${level}]` : "";
            if (isGift)
                emit({ platform: "youtube", kind: "member", unit: "membership_gift", count, label: `${count}x gift membership${lvl} from ${gifter || m.name}` });
            else
                emit({ platform: "youtube", kind: "member", unit: "membership", count: 1, label: `membership${lvl} from ${m.name}` });
            return true;
        }
    }
    return false;
}
