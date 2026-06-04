import { TimerEvent } from "./types";

// seconds granted per unit, per platform. floats. defaults preserve old subTime=70/dollarTime=14 behavior
export const DEFAULT_RATES = {
    twitch: { sub_t1: 70, sub_t2: 140, sub_t3: 350, bits: 0.14 },
    streamlabs: { donation: 14, merch: 14 },
};

export function normalizeRates(raw: any){
    const num = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
    const t = (raw && raw.twitch) || {};
    const s = (raw && raw.streamlabs) || {};
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
    };
}

// apply the per-unit rate to a normalized event -> seconds (policy; used by the central handler)
export function toSeconds(rates: any, event: TimerEvent): number {
    switch (event.kind) {
        case "sub":
            return (rates.twitch["sub_t" + event.tier] || 0) * (event.count || 0);
        case "bits":
            return (rates.twitch.bits || 0) * (event.bits || 0);
        case "money":
            return (rates.streamlabs[event.unit as string] || 0) * (event.usd || 0);
        case "time":
            return event.seconds || 0;
    }
    return 0;
}
