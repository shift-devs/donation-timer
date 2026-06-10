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

// the creator's three membership levels. streamlabs relays only the human-readable name
// (membershipLevelName); membershipLevel/membershipLevelID arrive null, so we key off the name string.
const YT_TIER_BY_NAME: { [name: string]: string } = {
    "enjoyer": "enjoyer",
    "full membership": "full",
    "quickster": "quickster",
};
const YT_DEFAULT_TIER = "full"; // unknown/missing level falls back to the standard tier so time is still granted

function ytTier(level: any, watching: string): string {
    const low = String(level || "").trim().toLowerCase();
    const tier = YT_TIER_BY_NAME[low];
    if (tier)
        return tier;
    // surface any level string we don't recognize so the mapping can be extended
    if (low)
        diag(`(${watching}) YT-UNKNOWN-TIER ${JSON.stringify(level)} -> defaulting to ${YT_DEFAULT_TIER}`);
    return YT_DEFAULT_TIER;
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
            // label by the watched streamer's twitch channel, not the operator login (session.name)
            const watching = session.connections.twitch.channel || session.name;
            // surface the raw payload to diagnostics.log so we can confirm the enjoyer/quickster tier strings
            diag(`(${watching}) YT-MEMBERSHIP-PAYLOAD ${JSON.stringify(e)}`);
            const gifter = m.gifter || m.gifterName || m.gifter_username;
            const isGift = !!(m.gifted || m.isGift || gifter);
            let count = Number(m.amount) || Number(m.gift_count) || Number(m.quantity) || 1;
            count = Math.min(Math.max(Math.trunc(count), 1), 100); // guard against a misread field inflating time
            // split membership time by the creator's level; gifts grant at the level that was gifted
            const level = m.membershipLevelName || m.membership_level_name || m.levelName || m.level || m.tier;
            const tier = ytTier(level, watching);
            const lvl = level ? ` [${level}]` : "";
            if (isGift)
                emit({ platform: "youtube", kind: "member", unit: `membership_gift_${tier}`, count, label: `${count}x gift membership${lvl} from ${gifter || m.name}` });
            else
                emit({ platform: "youtube", kind: "member", unit: `membership_${tier}`, count: 1, label: `membership${lvl} from ${m.name}` });
            return true;
        }
    }
    return false;
}
