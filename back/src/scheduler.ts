import { TimerUserSession, TimerEvent } from "./types";
import { sessions } from "./session";
import { emitPlayEvent, emitTerminal, reportError } from "./bus";
import { parseCommand } from "./commands";
import { handle } from "./events";
import { DONATION_SOURCES } from "./timerEvents";

// drives events. an event holds a list of triggers and fires when ANY of them does:
//   daily / once  — off the clock, evaluated by the tick below
//   gift / donation / fwproduct — off live platform traffic, evaluated by firePlatformTriggers
// either way the clip only plays if the countdown's remaining time is inside the event's optional window.

// last-fired instant per CLOCK trigger, keyed `${userId}:${eventId}:${triggerId}`. in-memory only: a daily
// trigger's instant changes each day, so storing the instant naturally re-arms it tomorrow. seed-on-first-sight
// (below) stops restart backfill.
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

// the instant a clock trigger is relevant "now", as epoch ms.
// daily -> today's HH:MM in the trigger's zone (server-local fallback); once -> the configured absolute instant.
function triggerInstant(t: any, now: number): number {
    if (t.type === "once")
        return Number(t.onceAt) || 0;
    const [h, m] = String(t.dailyTime || "00:00").split(":").map((x) => parseInt(x, 10));
    if (t.tz) {
        try {
            return dailyInstantInZone(now, h || 0, m || 0, t.tz);
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
    return {
        id: ev.id,
        name: ev.name,
        kind: ev.mediaKind,
        src: ev.mediaSrc,
        volume: ev.volume,
        startSec: ev.clipStartSec ?? null,
        endSec: ev.clipEndSec ?? null,
    };
}

// optional delayed terminal command: cmdDelaySec seconds into the clip, run ev.cmdText through the same
// parser + central handler the dashboard terminal uses. timed from fire time on the backend, so it runs
// even with no browser source open and can't double-fire from multiple sources. handle() drops it if the
// session logged out in the meantime.
function scheduleEventCommand(session: TimerUserSession, ev: any) {
    const text = typeof ev.cmdText === "string" ? ev.cmdText.trim() : "";
    if (!text)
        return;
    const delayMs = Math.max(0, Number(ev.cmdDelaySec) || 0) * 1000;
    setTimeout(() => {
        // this runs later on a bare timer with nothing above it on the stack — any throw here must be
        // contained locally and surfaced on the terminal, since it's a timer-change failure
        try {
            const parsed = parseCommand(text);
            if (parsed.error || !parsed.event){
                const msg = `Event "${ev.name || ev.id}" command "${text}" did not parse: ${parsed.error || "not a command"}`;
                console.log(msg);
                emitTerminal(session.userId, msg);
                return;
            }
            parsed.event.label = `${parsed.event.label} (event: ${ev.name || ev.id})`;
            handle(session, parsed.event);
        } catch (err) {
            reportError(session.userId, `running event "${ev.name || ev.id}" command`, err);
        }
    }, delayMs);
}

// play an event now: the clip on the /events source plus its optional delayed command. the remaining-time
// window is the one condition every trigger shares, so it's checked here rather than in each matcher.
function fireEvent(session: TimerUserSession, ev: any, remainingMs: number) {
    if (!windowMatches(ev, remainingMs))
        return;
    emitPlayEvent(session.userId, playPayload(ev));
    scheduleEventCommand(session, ev);
}

// a gift bomb matches when it came from a service the trigger listens to and its size is inside the (optional)
// [min,max] count range. count is the number of subs the one gifter gave at once, so a single subgift is 1.
function giftMatches(t: any, event: TimerEvent): boolean {
    if (!event.gifted)
        return false;
    if (t.giftPlatform && t.giftPlatform !== "any" && t.giftPlatform !== event.platform)
        return false;
    const n = Math.max(1, Math.trunc(Number(event.count) || 1));
    if (t.giftMinCount != null && n < t.giftMinCount)
        return false;
    if (t.giftMaxCount != null && n > t.giftMaxCount)
        return false;
    return true;
}

// a cash event matches when it came from the source the trigger watches (a donSource that isn't in the table,
// i.e. "any", takes every one of them) and its dollar amount is inside the optional range.
function donationMatches(t: any, event: TimerEvent): boolean {
    if (event.kind !== "money")
        return false;
    const src = DONATION_SOURCES[t.donSource];
    if (src && (src.platform !== event.platform || !src.units.includes(String(event.unit || ""))))
        return false;
    const usd = Number(event.usd) || 0;
    if (t.donMinUsd != null && usd < t.donMinUsd)
        return false;
    if (t.donMaxUsd != null && usd > t.donMaxUsd)
        return false;
    return true;
}

// a shop order matches when it contains the products the trigger watches, in a quantity inside the optional
// [min,max] range. an empty product list means any product, so a bare "product bought" trigger fires on every
// order that has a line item. the quantity is summed across the matching lines, so an order of 2 of one watched
// product and 3 of another counts as 5.
function productMatches(t: any, event: TimerEvent): boolean {
    const lines = Array.isArray(event.fwOffers) ? event.fwOffers : [];
    const want = Array.isArray(t.fwOfferIds) ? t.fwOfferIds : [];
    let qty = 0;
    for (const l of lines)
        if (l && (!want.length || want.includes(l.id)))
            qty += Math.max(1, Math.trunc(Number(l.qty) || 1));
    if (!qty) // none of the watched products in this order (or no line items at all)
        return false;
    if (t.fwMinQty != null && qty < t.fwMinQty)
        return false;
    if (t.fwMaxQty != null && qty > t.fwMaxQty)
        return false;
    return true;
}

function triggerMatches(t: any, event: TimerEvent): boolean {
    if (!t)
        return false;
    switch (t.type) {
        case "gift":
            return giftMatches(t, event);
        case "donation":
            return donationMatches(t, event);
        case "fwproduct":
            return productMatches(t, event);
    }
    return false; // daily/once come off the clock, not off platform traffic
}

// called from the central event handler for every genuine platform event: play each event that has a trigger
// matching it. unlike the clock triggers there's no fired-marker — a second gift bomb (or donation, or order)
// is a second trigger, and the browser source restarts the clip. an event fires once per occurrence even when
// two of its triggers match the same one.
export function firePlatformTriggers(session: TimerUserSession, event: TimerEvent) {
    const events = Array.isArray(session.timerEvents) ? session.timerEvents : [];
    const remaining = session.endTime - Date.now();
    for (const ev of events) {
        if (!ev || !ev.enabled)
            continue;
        const triggers = Array.isArray(ev.triggers) ? ev.triggers : [];
        if (triggers.some((t: any) => triggerMatches(t, event)))
            fireEvent(session, ev, remaining);
    }
}

function tickSession(session: TimerUserSession, now: number, liveKeys: Set<string>) {
    const events = Array.isArray(session.timerEvents) ? session.timerEvents : [];
    for (const ev of events) {
        if (!ev || !ev.enabled)
            continue;
        for (const t of (Array.isArray(ev.triggers) ? ev.triggers : [])) {
            if (!t || (t.type !== "daily" && t.type !== "once")) // the rest are platform-driven
                continue;
            const key = `${session.userId}:${ev.id}:${t.id}`;
            liveKeys.add(key);
            const instant = triggerInstant(t, now);
            if (instant <= 0)
                continue;
            const seen = lastFired.has(key);
            // seed-on-first-sight: a freshly-loaded or newly-added trigger whose instant already passed is marked
            // fired without playing, so a server restart (or adding a stale event) never backfills a missed one.
            if (!seen) {
                lastFired.set(key, now >= instant ? instant : 0);
                continue;
            }
            if (now < instant || lastFired.get(key) === instant)
                continue;
            lastFired.set(key, instant); // one evaluation per trigger, whether or not the window matches
            fireEvent(session, ev, session.endTime - now);
        }
    }
}

export function tickTimerEvents() {
    const now = Date.now();
    const liveKeys = new Set<string>();
    for (const session of sessions){
        // one session's bad event data must not stop other sessions' events; surface it on that user's terminal
        try {
            tickSession(session, now, liveKeys);
        } catch (err) {
            reportError(session.userId, "ticking scheduled events", err);
        }
    }
    // drop markers for events/sessions that no longer exist so the map can't grow unbounded over a long run
    for (const key of lastFired.keys())
        if (!liveKeys.has(key))
            lastFired.delete(key);
}

// test playback from the dashboard: fire an event immediately, bypassing the schedule and the remaining-time
// window. runs the delayed command too, so a test exercises the full behavior (it really adds time).
export function testTimerEvent(session: TimerUserSession, id: string) {
    const events = Array.isArray(session.timerEvents) ? session.timerEvents : [];
    const ev = events.find((e: any) => e && e.id === id);
    if (ev){
        emitPlayEvent(session.userId, playPayload(ev));
        scheduleEventCommand(session, ev);
    }
}
