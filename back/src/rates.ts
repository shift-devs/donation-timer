import { TimerEvent } from "./types";

// seconds granted per unit, per platform. floats. defaults preserve old subTime=70/dollarTime=14 behavior
export const DEFAULT_RATES = {
    twitch: { sub_t1: 70, sub_t2: 140, sub_t3: 350, bits: 0.14 },
    streamlabs: { donation: 14, merch: 14 },
    youtube: { superchat: 14, supersticker: 14, membership: 70, membership_gift: 70 },
    fourthwall: { order: 14, donation: 14, membership: 70 },
    kick: { subscription: 70, gift: 70 },
};

export function normalizeRates(raw: any){
    const num = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
    const t = (raw && raw.twitch) || {};
    const s = (raw && raw.streamlabs) || {};
    const y = (raw && raw.youtube) || {};
    const f = (raw && raw.fourthwall) || {};
    const k = (raw && raw.kick) || {};
    return {
        twitch: {
            sub_t1: num(t.sub_t1, DEFAULT_RATES.twitch.sub_t1),
            sub_t2: num(t.sub_t2, DEFAULT_RATES.twitch.sub_t2),
            sub_t3: num(t.sub_t3, DEFAULT_RATES.twitch.sub_t3),
            bits: num(t.bits, DEFAULT_RATES.twitch.bits),
        },
        streamlabs: {
            donation: num(s.donation, DEFAULT_RATES.streamlabs.donation),
            merch: num(s.merch, DEFAULT_RATES.streamlabs.merch),
        },
        youtube: {
            superchat: num(y.superchat, DEFAULT_RATES.youtube.superchat),
            supersticker: num(y.supersticker, DEFAULT_RATES.youtube.supersticker),
            membership: num(y.membership, DEFAULT_RATES.youtube.membership),
            membership_gift: num(y.membership_gift, DEFAULT_RATES.youtube.membership_gift),
        },
        fourthwall: {
            order: num(f.order, DEFAULT_RATES.fourthwall.order),
            donation: num(f.donation, DEFAULT_RATES.fourthwall.donation),
            membership: num(f.membership, DEFAULT_RATES.fourthwall.membership),
        },
        kick: {
            subscription: num(k.subscription, DEFAULT_RATES.kick.subscription),
            gift: num(k.gift, DEFAULT_RATES.kick.gift),
        },
    };
}

// apply the per-unit rate to a normalized event -> seconds (policy; used by the central handler).
// rate namespace is the event's platform; money/member multiply the unit rate by $ or count respectively.
export function toSeconds(rates: any, event: TimerEvent): number {
    const p = (rates && rates[event.platform]) || {};
    switch (event.kind) {
        case "sub":
            return (p["sub_t" + event.tier] || 0) * (event.count || 0);
        case "bits":
            return (p.bits || 0) * (event.bits || 0);
        case "money":
            return (p[event.unit as string] || 0) * (event.usd || 0);
        case "member":
            return (p[event.unit as string] || 0) * (event.count || 0);
        case "time":
            return event.seconds || 0;
    }
    return 0;
}
