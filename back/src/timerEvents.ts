// scheduled conditional media events. an event fires AT a time (one-time or daily) and, iff the live countdown's
// remaining time is within an optional [min,max] window, plays an audio/video clip on the /events browser source.
// stored per-user as an array (mirrors rates); this file owns validating untrusted client input into a strict shape.

export const DEFAULT_TIMER_EVENTS: any[] = [];

const MAX_EVENTS = 200;       // bound the array so a bad client can't blow up the json column / scheduler
const MAX_SRC = 2000;         // bound the media path/url length
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/; // 24h "HH:MM"

// coerce a value that should be a finite ms count >= 0, else null (= unbounded on that side of the window)
function msOrNull(v: any): number | null {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function normalizeOne(raw: any, i: number): any | null {
    if (!raw || typeof raw !== "object")
        return null;
    const triggerType = raw.triggerType === "once" ? "once" : "daily";
    const dailyTime = typeof raw.dailyTime === "string" && HHMM.test(raw.dailyTime) ? raw.dailyTime : "00:00";
    const onceAtN = Number(raw.onceAt);
    const onceAt = Number.isFinite(onceAtN) ? Math.round(onceAtN) : 0;
    const mediaKind = raw.mediaKind === "video" ? "video" : "audio";
    const mediaSrc = typeof raw.mediaSrc === "string" ? raw.mediaSrc.slice(0, MAX_SRC) : "";
    const volN = Number(raw.volume);
    const volume = Number.isFinite(volN) ? Math.min(1, Math.max(0, volN)) : 1;
    const id = typeof raw.id === "string" && raw.id ? raw.id.slice(0, 100) : `e${i}`;
    const name = typeof raw.name === "string" ? raw.name.slice(0, 200) : "";
    // iana zone for the DAILY trigger (the dashboard sends its browser zone). the container clock is usually UTC, so we
    // can't rely on server-local time; the scheduler resolves "HH:MM" in this zone. blank => fall back to server-local.
    const tz = typeof raw.tz === "string" ? raw.tz.slice(0, 64) : "";
    return {
        id,
        name,
        enabled: raw.enabled !== false, // default on
        triggerType,
        dailyTime,
        tz,
        onceAt,
        minRemainingMs: msOrNull(raw.minRemainingMs),
        maxRemainingMs: msOrNull(raw.maxRemainingMs),
        mediaKind,
        mediaSrc,
        volume,
    };
}

export function normalizeTimerEvents(raw: any): any[] {
    if (!Array.isArray(raw))
        return [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length && out.length < MAX_EVENTS; i++) {
        const ev = normalizeOne(raw[i], i);
        if (!ev)
            continue;
        if (seen.has(ev.id)) // ids must be unique so the scheduler's per-event fired-marker is stable
            ev.id = `${ev.id}_${i}`;
        seen.add(ev.id);
        out.push(ev);
    }
    return out;
}
