import { TimerUserSession } from "./types";
import { sessions } from "./session";
import { emitPlayEvent } from "./bus";

// drives timer events: at each tick, for every enabled event whose trigger instant has passed and hasn't fired yet,
// check the remaining-countdown window and, if it matches, tell the user's /events browser source to play the clip.

// last-fired trigger instant per event, keyed `${userId}:${eventId}`. in-memory only: a daily event's instant changes
// each day, so storing the instant naturally re-arms it tomorrow. seed-on-first-sight (below) stops restart backfill.
const lastFired = new Map<string, number>();

// the wall-clock fields a zone shows at a given instant (via Intl; node 18 bundles full ICU so any iana zone works)
function zoneParts(tz: string, atMs: number) {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p: any = {};
    for (const part of dtf.formatToParts(new Date(atMs)))
        p[part.type] = part.value;
    return { y: +p.year, mo: +p.month, d: +p.day, h: +(p.hour === "24" ? 0 : p.hour), mi: +p.minute, s: +p.second };
}

// zone offset (ms) at a UTC instant: how far the zone's wall clock is from UTC then
function zoneOffsetMs(tz: string, atMs: number): number {
    const z = zoneParts(tz, atMs);
    return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - atMs;
}

// epoch ms for "today at HH:MM" in the given zone (today = the current date in that zone). DST-correct via one refine.
function dailyInstantInZone(now: number, h: number, m: number, tz: string): number {
    const today = zoneParts(tz, now);
    const naiveUTC = Date.UTC(today.y, today.mo - 1, today.d, h, m, 0);
    let inst = naiveUTC - zoneOffsetMs(tz, naiveUTC);
    const refined = naiveUTC - zoneOffsetMs(tz, inst); // correct for the case where the guess landed across a DST edge
    if (refined !== inst)
        inst = refined;
    return inst;
}

// the trigger instant relevant "now" for an event, as epoch ms.
// daily -> today's HH:MM in the event's zone (server-local fallback); once -> the configured absolute instant.
function triggerInstant(ev: any, now: number): number {
    if (ev.triggerType === "once")
        return Number(ev.onceAt) || 0;
    const [h, m] = String(ev.dailyTime || "00:00").split(":").map((x) => parseInt(x, 10));
    if (ev.tz) {
        try {
            return dailyInstantInZone(now, h || 0, m || 0, ev.tz);
        } catch {
            // invalid zone string -> fall through to server-local
        }
    }
    const d = new Date(now);
    d.setHours(h || 0, m || 0, 0, 0);
    return d.getTime();
}

// remaining countdown is within the (optional) window. null bound = unbounded on that side.
function windowMatches(ev: any, remainingMs: number): boolean {
    if (ev.minRemainingMs != null && remainingMs < ev.minRemainingMs)
        return false;
    if (ev.maxRemainingMs != null && remainingMs > ev.maxRemainingMs)
        return false;
    return true;
}

// the payload the /events page consumes
function playPayload(ev: any) {
    return { id: ev.id, name: ev.name, kind: ev.mediaKind, src: ev.mediaSrc, volume: ev.volume };
}

function tickSession(session: TimerUserSession, now: number, liveKeys: Set<string>) {
    const events = Array.isArray(session.timerEvents) ? session.timerEvents : [];
    for (const ev of events) {
        if (!ev || !ev.enabled)
            continue;
        const key = `${session.userId}:${ev.id}`;
        liveKeys.add(key);
        const instant = triggerInstant(ev, now);
        if (instant <= 0)
            continue;
        const seen = lastFired.has(key);
        // seed-on-first-sight: a freshly-loaded or newly-added event whose trigger already passed is marked fired
        // without playing, so a server restart (or adding a stale event) never backfills a missed trigger.
        if (!seen) {
            lastFired.set(key, now >= instant ? instant : 0);
            continue;
        }
        if (now < instant || lastFired.get(key) === instant)
            continue;
        lastFired.set(key, instant); // one evaluation per trigger, whether or not the window matches
        const remaining = session.endTime - now;
        if (windowMatches(ev, remaining))
            emitPlayEvent(session.userId, playPayload(ev));
    }
}

export function tickTimerEvents() {
    const now = Date.now();
    const liveKeys = new Set<string>();
    for (const session of sessions)
        tickSession(session, now, liveKeys);
    // drop markers for events/sessions that no longer exist so the map can't grow unbounded over a long run
    for (const key of lastFired.keys())
        if (!liveKeys.has(key))
            lastFired.delete(key);
}

// test playback from the dashboard: fire an event immediately, bypassing the schedule and the remaining-time window.
export function testTimerEvent(session: TimerUserSession, id: string) {
    const events = Array.isArray(session.timerEvents) ? session.timerEvents : [];
    const ev = events.find((e: any) => e && e.id === id);
    if (ev)
        emitPlayEvent(session.userId, playPayload(ev));
}
