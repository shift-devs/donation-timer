// conditional media events. an event carries one or more triggers — a time (daily or one-off), a gift bomb of a
// given size, a cash donation in a dollar range, or a fourthwall product being bought — and when ANY of them
// fires, iff the live countdown's remaining time is within an optional [min,max] window, it plays a clip
// (media-folder file or youtube link) on the /events browser source.
// stored per-user as an array (mirrors rates); this file owns validating untrusted client input into a strict shape.

export const DEFAULT_TIMER_EVENTS: any[] = [];

const MAX_EVENTS = 200;       // bound the array so a bad client can't blow up the json column / scheduler
const MAX_LAYERS = 50;        // named /events browser sources one user can define
const MAX_LAYER_NAME = 100;
const MAX_TRIGGERS = 20;      // per event, for the same reason
const MAX_FW_OFFERS = 200;    // products one purchase trigger can watch
const MAX_SRC = 2000;         // bound the media path/url length
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/; // 24h "HH:MM"
const MAX_CLIP_SEC = 86400;   // bound the clip trim so a bad client can't ask for an absurd offset

// daily/once come off the clock (scheduler tick); the rest fire on a live platform event
const TRIGGER_TYPES = ["daily", "once", "gift", "donation", "fwproduct"];
// which service's gifts a gift trigger listens to; "any" takes all of them
const GIFT_PLATFORMS = ["any", "twitch", "youtube", "kick"];

// the money events a donation trigger can listen to, as the platform plus the units that count. a donSource
// that isn't in here (i.e. "any") means every money event qualifies. exported so the scheduler's matcher and
// this validator can't drift apart.
export const DONATION_SOURCES: { [key: string]: { platform: string, units: string[] } } = {
    streamlabs_donation: { platform: "streamlabs", units: ["donation"] },
    streamlabs_merch: { platform: "streamlabs", units: ["merch"] },
    youtube_superchat: { platform: "youtube", units: ["superchat", "supersticker"] },
    fourthwall_order: { platform: "fourthwall", units: ["order"] },
    fourthwall_donation: { platform: "fourthwall", units: ["donation"] },
};

// coerce a value that should be a finite count >= 0, else null (= no bound / no override).
// null/"" must be screened out first: Number(null) is 0, which would turn "no maximum" into "max 0" and
// leave the event unable to fire outside the last second of the countdown.
function numOrNull(v: any): number | null {
    if (v == null || v === "")
        return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// same, for a dollar bound. kept to the cent rather than rounded to whole dollars — donations arrive as $4.99.
function moneyOrNull(v: any): number | null {
    if (v == null || v === "")
        return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

const clampSec = (n: number | null) => (n == null ? null : Math.min(MAX_CLIP_SEC, n));

function normalizeTrigger(raw: any, i: number): any {
    const r = raw && typeof raw === "object" ? raw : {};
    // a trigger carries every type's fields, not just its own: flipping the dropdown in the dashboard must not
    // discard what was typed under the previous type, exactly as the media source keeps both its file and its url
    const fwOfferIds: string[] = [];
    for (const id of (Array.isArray(r.fwOfferIds) ? r.fwOfferIds : [])){
        if (fwOfferIds.length >= MAX_FW_OFFERS)
            break;
        if (typeof id === "string" && id && id.length <= 100 && !fwOfferIds.includes(id))
            fwOfferIds.push(id);
    }
    return {
        id: typeof r.id === "string" && r.id ? r.id.slice(0, 100) : `t${i}`,
        type: TRIGGER_TYPES.includes(r.type) ? r.type : "daily",
        dailyTime: typeof r.dailyTime === "string" && HHMM.test(r.dailyTime) ? r.dailyTime : "00:00",
        // iana zone for the DAILY trigger (the dashboard sends its browser zone). the container clock is usually
        // UTC, so we can't rely on server-local time; the scheduler resolves "HH:MM" in this zone. blank =>
        // fall back to server-local.
        tz: typeof r.tz === "string" ? r.tz.slice(0, 64) : "",
        onceAt: Number.isFinite(Number(r.onceAt)) ? Math.round(Number(r.onceAt)) : 0,
        giftPlatform: GIFT_PLATFORMS.includes(r.giftPlatform) ? r.giftPlatform : "any",
        giftMinCount: numOrNull(r.giftMinCount),
        giftMaxCount: numOrNull(r.giftMaxCount),
        donSource: DONATION_SOURCES[r.donSource] ? r.donSource : "any",
        donMinUsd: moneyOrNull(r.donMinUsd),
        donMaxUsd: moneyOrNull(r.donMaxUsd),
        fwOfferIds, // empty = any product in the shop
        // how many of those products the order has to contain, summed across its matching lines
        fwMinQty: numOrNull(r.fwMinQty),
        fwMaxQty: numOrNull(r.fwMaxQty),
    };
}

// events saved before triggers became a list carried a single inline trigger; lift that into the array so the
// scheduler and the dashboard only ever deal with one shape. an explicitly empty list stays empty — that's a
// half-built event the operator hasn't wired up yet, not a reason to invent a trigger for them.
function normalizeTriggers(raw: any): any[] {
    const list = Array.isArray(raw.triggers) ? raw.triggers : [{
        type: raw.triggerType,
        dailyTime: raw.dailyTime,
        tz: raw.tz,
        onceAt: raw.onceAt,
        giftPlatform: raw.giftPlatform,
        giftMinCount: raw.giftMinCount,
        giftMaxCount: raw.giftMaxCount,
    }];
    const out: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < list.length && out.length < MAX_TRIGGERS; i++){
        const t = normalizeTrigger(list[i], i);
        if (seen.has(t.id)) // ids must be unique so the scheduler's per-trigger fired-marker is stable
            t.id = `${t.id}_${i}`;
        seen.add(t.id);
        out.push(t);
    }
    return out;
}

function normalizeOne(raw: any, i: number): any | null {
    if (!raw || typeof raw !== "object")
        return null;
    // audio/video = a file in the site's media folder; youtube = a pasted link, embedded by the /events page
    const mediaKind = raw.mediaKind === "video" ? "video" : raw.mediaKind === "youtube" ? "youtube" : "audio";
    const mediaSrc = typeof raw.mediaSrc === "string" ? raw.mediaSrc.trim().slice(0, MAX_SRC) : "";
    const volN = Number(raw.volume);
    const volume = Number.isFinite(volN) ? Math.min(1, Math.max(0, volN)) : 1;
    // optional clip trim, in seconds into the media. null = play from its own start / to its own end.
    const clipStartSec = clampSec(numOrNull(raw.clipStartSec));
    let clipEndSec = clampSec(numOrNull(raw.clipEndSec));
    if (clipEndSec != null && clipEndSec <= (clipStartSec || 0))
        clipEndSec = null; // an end at or before the start would play nothing, so treat it as unset
    // optional terminal command fired cmdDelaySec seconds after the media starts (same grammar as the dashboard terminal)
    const cmdText = typeof raw.cmdText === "string" ? raw.cmdText.slice(0, 500).trim() : "";
    const cdN = Number(raw.cmdDelaySec);
    const cmdDelaySec = Number.isFinite(cdN) && cdN >= 0 ? Math.min(86400, cdN) : 0;
    const id = typeof raw.id === "string" && raw.id ? raw.id.slice(0, 100) : `e${i}`;
    const name = typeof raw.name === "string" ? raw.name.slice(0, 200) : "";
    return {
        id,
        name,
        enabled: raw.enabled !== false, // default on
        // which /events browser source plays this. "" is the default layer — the source url with no ?layer=,
        // which is what every existing source in obs already is, so an event that names no layer keeps working.
        layerId: typeof raw.layerId === "string" ? raw.layerId.slice(0, 100) : "",
        triggers: normalizeTriggers(raw),
        minRemainingMs: numOrNull(raw.minRemainingMs),
        maxRemainingMs: numOrNull(raw.maxRemainingMs),
        mediaKind,
        mediaSrc,
        clipStartSec,
        clipEndSec,
        volume,
        cmdText,
        cmdDelaySec,
    };
}

// the user's named /events browser sources. the default layer isn't in here — it's the id "", the source url
// with no ?layer=, and it always exists. this owns validating untrusted client input.
export function normalizeEventLayers(raw: any): any[] {
    if (!Array.isArray(raw))
        return [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length && out.length < MAX_LAYERS; i++){
        const r = raw[i];
        if (!r || typeof r !== "object")
            continue;
        // a blank id would collide with the default layer and quietly steal its events
        const id = typeof r.id === "string" && r.id ? r.id.slice(0, 100) : `l${i + 1}`;
        if (seen.has(id))
            continue;
        seen.add(id);
        out.push({ id, name: typeof r.name === "string" ? r.name.slice(0, MAX_LAYER_NAME) : "" });
    }
    return out;
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
