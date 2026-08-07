import axios from "axios";
import { TimerUserSession, TimerEvent } from "../types";
import { FW_POLL_TIME, FW_UNITS_POLL_TIME, FW_UNITS_NUDGE_TIME, FW_UNITS_RETRY_TIME, FW_THUMBS_POLL_TIME, FW_HTTP_TIMEOUT, FW_LIST_PAGE_MIN, FW_LIST_PAGE_MAX, FW_LIST_QUIET_POLLS } from "../config";
import { emitSync, emitFwAlert, emitFwActivity } from "../bus";
import { diag } from "../diag";

const FW_API = "https://api.fourthwall.com/open-api/v1.0";

// per-product time bonuses: { [offerId]: seconds-per-item }, granted on top of the per-dollar order
// rate and multiplied by the quantity purchased. this owns validating untrusted client input.
const MAX_BONUS_PRODUCTS = 1000;
export function normalizeFwProductBonuses(raw: any): { [id: string]: number } {
    const out: { [id: string]: number } = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return out;
    for (const [id, v] of Object.entries(raw)){
        if (Object.keys(out).length >= MAX_BONUS_PRODUCTS)
            break;
        const n = Number(v);
        if (id && id.length <= 100 && Number.isFinite(n) && n > 0)
            out[id] = n;
    }
    return out;
}

// per-product alert sounds: { [offerId]: { file, volume } } — file is a bare name under the site's
// /fwsounds/ folder (the alert page builds the url, so no paths/traversal can sneak in), volume 0..1.
// a bare-string value is the legacy shape (filename only) and normalizes to volume 1.
export function normalizeFwProductSounds(raw: any): { [id: string]: { file: string, volume: number } } {
    const out: { [id: string]: { file: string, volume: number } } = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return out;
    for (const [id, v] of Object.entries(raw)){
        if (Object.keys(out).length >= MAX_BONUS_PRODUCTS)
            break;
        if (!id || id.length > 100)
            continue;
        const file = typeof v === "string" ? v : (v && typeof (v as any).file === "string" ? (v as any).file : "");
        if (!file || file.length > 200 || file.includes("/") || file.includes("\\") || file.includes(".."))
            continue;
        const volN = Number(v && (v as any).volume);
        out[id] = { file, volume: Number.isFinite(volN) ? Math.min(1, Math.max(0, volN)) : 1 };
    }
    return out;
}

// per-product alert banners: { [offerId]: filename } — a bare name under the site's /banners/ folder
// (the alert page builds the url, so no paths/traversal can sneak in). absent = the template's purple
// panel, which the banner otherwise covers. this owns validating untrusted client input.
export function normalizeFwProductBanners(raw: any): { [id: string]: string } {
    const out: { [id: string]: string } = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return out;
    for (const [id, v] of Object.entries(raw)){
        if (Object.keys(out).length >= MAX_BONUS_PRODUCTS)
            break;
        if (!id || id.length > 100)
            continue;
        const file = typeof v === "string" ? v : "";
        if (!file || file.length > 200 || file.includes("/") || file.includes("\\") || file.includes(".."))
            continue;
        out[id] = file;
    }
    return out;
}

// per-product name drop shadow: { [offerId]: true } for products whose alert draws a shadow behind the
// buyer name, so it stays readable over a busy banner. absent = off (the plain purple panel needs none),
// so we only ever store the enabled ones. this owns validating untrusted client input.
export function normalizeFwProductShadows(raw: any): { [id: string]: boolean } {
    const out: { [id: string]: boolean } = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return out;
    for (const [id, v] of Object.entries(raw)){
        if (Object.keys(out).length >= MAX_BONUS_PRODUCTS)
            break;
        if (id && id.length <= 100 && v === true) // only the "on" entries are meaningful
            out[id] = true;
    }
    return out;
}

// per-product alert toggle: { [offerId]: false } for products whose on-stream purchase alert is off.
// absent = on (the default), so we only ever store the disabled ones — mirrors the bonuses normalizer
// dropping zeros. this owns validating untrusted client input.
export function normalizeFwProductAlerts(raw: any): { [id: string]: boolean } {
    const out: { [id: string]: boolean } = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return out;
    for (const [id, v] of Object.entries(raw)){
        if (Object.keys(out).length >= MAX_BONUS_PRODUCTS)
            break;
        if (id && id.length <= 100 && v === false) // only the "off" entries are meaningful
            out[id] = false;
    }
    return out;
}

// per-product display names: { [offerId]: label } used on stream instead of the shop's own product name
// (shop names are often long/SEO-ish). absent or blank = keep fourthwall's name, so only the renamed
// products are stored. this owns validating untrusted client input.
const MAX_PRODUCT_NAME = 200;
export function normalizeFwProductNames(raw: any): { [id: string]: string } {
    const out: { [id: string]: string } = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return out;
    for (const [id, v] of Object.entries(raw)){
        if (Object.keys(out).length >= MAX_BONUS_PRODUCTS)
            break;
        if (!id || id.length > 100)
            continue;
        const name = typeof v === "string" ? v.trim().slice(0, MAX_PRODUCT_NAME) : "";
        if (name)
            out[id] = name;
    }
    return out;
}

// the label a product goes out under: the streamer's custom name if they set one, else whatever the shop
// calls it. every on-stream surface (alert text, activity feed, log labels) reads the name through here so
// a renamed product looks the same everywhere.
export function displayNameFor(session: TimerUserSession, id: string, fallback: string): string {
    const custom = id && session.fwProductNames && session.fwProductNames[id];
    return typeof custom === "string" && custom ? custom : fallback;
}

// is the on-stream alert enabled for this product? default on unless explicitly turned off.
export function alertsEnabledFor(session: TimerUserSession, id: string): boolean {
    return !(id && session.fwProductAlerts && session.fwProductAlerts[id] === false);
}

// rolling activity feed for the /fwactivity page: one entry per purchased product / donation / membership,
// with the buyer and their checkout message. persisted on the session (jsonb column) so a restart keeps it.
export const FW_ACTIVITY_CAP = 300;

export function normalizeFwActivity(raw: any): any[] {
    if (!Array.isArray(raw))
        return [];
    const out: any[] = [];
    for (const e of raw.slice(-FW_ACTIVITY_CAP)){
        if (!e || typeof e !== "object")
            continue;
        out.push({
            t: Number(e.t) || 0,
            product: typeof e.product === "string" ? e.product.slice(0, 200) : "",
            user: typeof e.user === "string" ? e.user.slice(0, 100) : "",
            message: typeof e.message === "string" ? e.message.slice(0, 1000) : "",
            image: typeof e.image === "string" ? e.image.slice(0, 2000) : "",
            unit: typeof e.unit === "string" ? e.unit.slice(0, 20) : "order",
            // units of this product in the order. entries stored before the feed showed quantity have none, so
            // they normalize to 1 rather than dropping out of the backlog.
            qty: Math.max(1, Math.trunc(Number(e.qty)) || 1),
        });
    }
    return out;
}

export function pushFwActivity(session: TimerUserSession, entry: any){
    if (!Array.isArray(session.fwActivity))
        session.fwActivity = [];
    session.fwActivity.push(entry);
    if (session.fwActivity.length > FW_ACTIVITY_CAP)
        session.fwActivity.splice(0, session.fwActivity.length - FW_ACTIVITY_CAP);
    emitFwActivity(session.userId, entry);
}

// the image an on-stream surface should load for an order line. an order carries only the full-size original —
// 4000px and ~940kb on the shop we measured — which the feed renders into a 96px box and the alert into a panel,
// every byte of it fetched on the machine running obs mid-stream. the signed imgproxy url can't be rewritten with
// resize options (it 400s), so we resolve the photo through the product list instead: same image id first, then any
// photo of that product, then the original. the last case is what shipped before, so an unlisted product still
// shows something — just expensively.
export function imageForLine(session: TimerUserSession, line: any): string {
    const t = session.fwThumbs;
    const imgId = line && line.primaryImage && line.primaryImage.id;
    return (t && typeof imgId === "string" && t.byImage[imgId])
        || (t && line && typeof line.id === "string" && t.byOffer[line.id])
        || String((line && line.primaryImage && line.primaryImage.url) || "");
}

// a page-0-only list we poll: what we've already emitted, how wide we're currently reading, and how long it's
// been quiet at that width.
export interface FwList { path: string, seen: Set<string>, size: number, quiet: number }

// how wide the next read of a page-0-only list should be, given how crowded this one looked. grows fast and
// shrinks slowly, because the two directions have wildly different stakes: too wide only wastes bandwidth, while
// too narrow silently drops donations that fell off the page before we read them.
//   half the page new  -> one busy cycle from truncating, so double now
//   a quarter new      -> busy enough to hold the current width
//   less than that     -> headroom to spare, but only creep down after a sustained lull
export function nextPageSize(size: number, fresh: number, quiet: number): { size: number, quiet: number } {
    if (fresh * 2 >= size)
        return { size: Math.min(FW_LIST_PAGE_MAX, size * 2), quiet: 0 };
    if (fresh * 4 > size)
        return { size, quiet: 0 };
    const q = quiet + 1;
    if (q < FW_LIST_QUIET_POLLS || size <= FW_LIST_PAGE_MIN)
        return { size, quiet: q };
    return { size: Math.max(FW_LIST_PAGE_MIN, Math.round(size / 2)), quiet: 0 };
}

// units of one order line. fourthwall nests it under the chosen variant; anything unparseable counts as one item.
export function lineQty(line: any): number {
    return Math.max(1, Math.trunc(Number(line && line.variant && line.variant.quantity)) || 1);
}

// first configured sound among an order's line items -> the alert's sound (one alert, one sound)
export function soundForOffers(session: TimerUserSession, offers: any[]): { file: string, volume: number } | null {
    for (const line of offers){
        const s = line && line.id && session.fwProductSounds && session.fwProductSounds[line.id];
        if (s && s.file)
            return s;
    }
    return null;
}

// same for the banner image: first configured one among the order's lines wins (one alert, one banner)
export function bannerForOffers(session: TimerUserSession, offers: any[]): string {
    for (const line of offers){
        const b = line && line.id && session.fwProductBanners && session.fwProductBanners[line.id];
        if (b)
            return b;
    }
    return "";
}

// whether that alert's name gets a drop shadow: the product supplying the banner decides, so the shadow
// always matches the banner on screen. with no banner set, the first product asking for one wins.
export function shadowForOffers(session: TimerUserSession, offers: any[]): boolean {
    for (const line of offers){
        const id = line && line.id;
        if (!id)
            continue;
        if (session.fwProductBanners && session.fwProductBanners[id])
            return !!(session.fwProductShadows && session.fwProductShadows[id]);
        if (session.fwProductShadows && session.fwProductShadows[id])
            return true;
    }
    return false;
}

// list the shop's products (offers) so the dashboard can attach per-product bonuses.
// offer ids here are the same ids that appear in an order's offers[] lines.
export async function fetchFourthwallProducts(session: TimerUserSession): Promise<{ id: string, name: string, image: string, usd: number }[]> {
    const fw = (session.connections && session.connections.fourthwall) || {};
    if (!fw.username || !fw.password)
        throw new Error("Fourthwall is not connected.");
    const auth = "Basic " + Buffer.from(`${fw.username}:${fw.password}`).toString("base64");
    const out: { id: string, name: string, image: string, usd: number }[] = [];
    const byImage: { [id: string]: string } = {};
    const byOffer: { [id: string]: string } = {};
    for (let page = 0; page < 10; page++){ // hard page cap so a pathological shop can't loop us forever
        const res = await axios.get(`${FW_API}/products`, {
            headers: { Authorization: auth },
            params: { page, size: 100 },
            timeout: FW_HTTP_TIMEOUT,
            paramsSerializer: (p: any) => new URLSearchParams(p).toString(),
        });
        const rows = (res.data && res.data.results) || [];
        for (const r of rows){
            if (!r || !r.id)
                continue;
            const imgs = Array.isArray(r.images) ? r.images : [];
            // a product publishes the same photo twice: images[] through imgproxy, thumbnailImage straight off the
            // cdn. same id, same pixels, and the imgproxy copy is a fraction of the bytes (33kb vs 258kb on the
            // shop we measured), so prefer it and keep the cdn one only as a fallback.
            for (const im of imgs)
                if (im && typeof im.id === "string" && typeof im.url === "string")
                    byImage[im.id] = im.url;
            const small = String((imgs[0] && imgs[0].url) || (r.thumbnailImage && r.thumbnailImage.url) || "");
            if (small)
                byOffer[String(r.id)] = small;
            out.push({
                id: String(r.id),
                name: String(r.name || r.slug || r.id),
                image: small, // "" = no photo
                // first variant's price, for display and for simulating purchases from the dashboard
                usd: Number(r.variants && r.variants[0] && r.variants[0].unitPrice && r.variants[0].unitPrice.value) || 0,
            });
        }
        if (rows.length < 100)
            break;
    }
    // every caller refreshes the maps for free — a dashboard product load included
    session.fwThumbs = { byImage, byOffer };
    return out;
}

// all-time units-sold per product via the reports engine, keyed by offerId (the same id used for
// product bonuses/sounds and in order lines). feeds the /fwprogress "X of N sold" browser sources.
// `from` = epoch so the count is cumulative; the report needs a timezone + precision even though we
// only want one aggregated row per product (precision doesn't bucket this particular report).
export async function fetchFourthwallUnitsSold(session: TimerUserSession): Promise<{ [id: string]: number }> {
    const fw = (session.connections && session.connections.fourthwall) || {};
    if (!fw.username || !fw.password)
        throw new Error("Fourthwall is not connected.");
    const auth = "Basic " + Buffer.from(`${fw.username}:${fw.password}`).toString("base64");
    const res = await axios.get(`${FW_API}/reports/top_products_by_units_sold`, {
        headers: { Authorization: auth },
        params: {
            from: "2000-01-01T00:00:00Z",
            to: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), // +1d guards against clock skew hiding a fresh sale
            aggregationTimezone: "UTC",
            aggregationPrecision: "YEAR",
        },
        timeout: FW_HTTP_TIMEOUT,
        paramsSerializer: (p: any) => new URLSearchParams(p).toString(),
    });
    const rows = (res.data && res.data.rows) || [];
    const out: { [id: string]: number } = {};
    for (const r of rows){
        const id = r && r.metadata && r.metadata.offerId;      // keyed by offer id, not name (names can collide)
        const n = Math.max(0, Math.trunc(Number(r && r.unitsSold) || 0));
        if (typeof id !== "string" || !id || Object.keys(out).length >= MAX_BONUS_PRODUCTS)
            continue;
        out[id] = (out[id] || 0) + n; // sum defensively in case the report ever splits a product across rows
    }
    return out;
}

// turn a poll error into a short human message for the connections ui
export function describeError(err: any): string {
    const r = err && err.response;
    if (!r)
        return err && err.code === "ECONNABORTED"
            ? "Timed out reaching Fourthwall."
            : `Couldn't reach Fourthwall (${(err && err.message) || "network error"}).`;
    if (r.status === 401 || r.status === 403)
        return `Fourthwall rejected the credentials (${r.status}). Use an Open API username + password from the shop dashboard — not a Storefront API token.`;
    const body = r.data ? (typeof r.data === "string" ? r.data : JSON.stringify(r.data)) : "";
    return `Fourthwall returned ${r.status}${body ? " — " + body.slice(0, 200) : ""}.`;
}

// fourthwall has no public-localhost-friendly push, so we POLL its rest api (outbound, like the streamlabs merch loop).
// orders support createdAt[gt]; donations/members are page/size only so we baseline-seed + dedup by id.
export function connectFourthwall(session: TimerUserSession, emit: (e: TimerEvent) => void){
    // label logs by the watched streamer's twitch channel, not the operator account that logged in (session.name)
    const watching = session.connections.twitch.channel || session.name;
    const fw = session.connections.fourthwall || {};
    const auth = "Basic " + Buffer.from(`${fw.username}:${fw.password}`).toString("base64");
    const headers = { Authorization: auth };

    let ordersCursor = new Date().toISOString(); // only orders created after we connect
    // page-0-only lists: dedup set, plus the adaptive page width and how long it's been quiet. seeded at the
    // ceiling so the first read covers the widest window we'll ever ask for (see FW_LIST_PAGE_MAX) — the quiet
    // ladder walks it down to the floor over the first few minutes.
    const donationList = { path: "/donations", seen: new Set<string>(), size: FW_LIST_PAGE_MAX, quiet: 0 };
    const memberList = { path: "/memberships/members", seen: new Set<string>(), size: FW_LIST_PAGE_MAX, quiet: 0 };
    let baselined = false; // first poll just records existing donation/member ids without granting time
    let polling = false;   // in-flight guard: a slow cycle must not let the interval stack up overlapping polls
    let diagnosed = false; // one-time payload dump (grep FW-DIAG) to confirm field shapes/sort/status on real data
    let timer: NodeJS.Timeout | number = 0;
    let unitsTimer: NodeJS.Timeout | number = 0;
    let thumbsTimer: NodeJS.Timeout | number = 0;
    let unitsNudge: NodeJS.Timeout | number = 0; // pending out-of-band report read (see queueUnits)
    let pollingUnits = false; // in-flight guard for the slower units-sold report poll
    let stopped = false;      // disconnected: clearing the timers isn't enough now that a failed read re-queues itself

    async function get(path: string, params: any){
        // axios's default serializer leaves [ ] literal, which fourthwall's tomcat rejects with a 400; encode them
        const res = await axios.get(`${FW_API}${path}`, {
            headers,
            params,
            timeout: FW_HTTP_TIMEOUT,
            paramsSerializer: (p: any) => new URLSearchParams(p).toString(),
        });
        return (res.data && res.data.results) || [];
    }

    // one-shot: on first working poll, dump real samples so we can settle the open unknowns (.value vs .amount,
    // order status strings, list sort order, totals, whether gift cards show as orders). grep "FW-DIAG".
    async function logDiagnostics(){
        for (const [name, path] of [["order", "/order"], ["donations", "/donations"], ["members", "/memberships/members"]]){
            try {
                const res = await axios.get(`${FW_API}${path}`, { headers, params: { size: 3 }, timeout: FW_HTTP_TIMEOUT });
                const data = res.data || {};
                const rows = data.results || [];
                const first = rows[0], last = rows[rows.length - 1];
                const sort = first && last && first.createdAt && last.createdAt
                    ? (first.createdAt > last.createdAt ? "newest-first" : "oldest-first")
                    : "unknown";
                diag(`FW-DIAG ${watching} ${name}: total=${data.total} totalPages=${data.totalPages} returned=${rows.length} sort=${sort}`);
                if (name === "order")
                    diag(`FW-DIAG ${watching} order statuses: ${rows.map((r: any) => r.status).join(", ")}`);
                diag(`FW-DIAG ${watching} ${name} sample: ${JSON.stringify(first)}`);
            } catch (e: any) {
                diag(`FW-DIAG ${watching} ${name} failed: ${e && e.response ? e.response.status : e && e.message}`);
            }
        }
    }

    async function pollOrders(){
        const rows = await get("/order", { "createdAt[gt]": ordersCursor, size: 100 });
        for (const o of rows){
            // every order in /order is paid at checkout (real data shows statuses like DELIVERED, not just CONFIRMED),
            // so count them all. refunds/cancellations aren't clawed back (known limitation).
            const usd = Number(o.amounts && o.amounts.total && o.amounts.total.value) || 0;
            if (!usd) // adds no time -> likely a field-shape mismatch (e.g. amount vs value); surface it
                diag(`FW-DIAG ${watching}: order ${o.id} parsed to $0 (check amounts.total field)`);
            const offers = Array.isArray(o.offers) ? o.offers : [];
            // what was bought rides along on the order event so a "product bought" event trigger can match on it
            const fwOffers = offers.map((line: any) => ({ id: String((line && line.id) || ""), qty: lineQty(line) }));
            emit({ platform: "fourthwall", kind: "money", usd, unit: "order", fwOffers, label: `order $${usd} from ${o.username || o.email || "someone"}` });
            // flat per-order bonus: granted once per whole order (any # of items), on top of the $-rate time
            const orderFlat = Number(session.rates && session.rates.fourthwall && session.rates.fourthwall.orderFlat) || 0;
            if (orderFlat > 0)
                emit({ platform: "fourthwall", kind: "time", seconds: orderFlat, label: `order bonus from ${o.username || o.email || "someone"}` });
            // per-product bonuses: flat seconds per item on top of the $-rate time, scaled by quantity
            for (const line of offers){
                const per = Number(line && line.id && session.fwProductBonuses && session.fwProductBonuses[line.id]) || 0;
                if (!per)
                    continue;
                const qty = lineQty(line);
                emit({ platform: "fourthwall", kind: "time", seconds: per * qty, label: `product bonus: ${displayNameFor(session, line.id, line.name || line.id)} x${qty}` });
            }
            // activity feed: one row per purchased product, carrying the buyer + their checkout message
            const buyer = o.username || "Someone";
            const orderMsg = typeof o.message === "string" ? o.message : "";
            if (offers.length)
                for (const line of offers)
                    pushFwActivity(session, { t: Date.now(), product: displayNameFor(session, line.id, line.name || "merch"), user: buyer, message: orderMsg, image: imageForLine(session, line), unit: "order", qty: lineQty(line) });
            else
                pushFwActivity(session, { t: Date.now(), product: "Purchase", user: buyer, message: orderMsg, image: "", unit: "order", qty: 1 });
            // on-stream purchase alert for the /fwalert browser source: buyer + first product + its image + sound.
            // gated on the shown product's toggle — if its alert is turned off, stay silent (orders with no
            // product line can't be toggled, so those always alert).
            const shownId = offers.length ? offers[0].id : "";
            if (!shownId || alertsEnabledFor(session, shownId)){
                const alertSound = soundForOffers(session, offers);
                emitFwAlert(session.userId, {
                    name: o.username || "Someone",
                    message: offers.length
                        ? `purchased ${displayNameFor(session, offers[0].id, offers[0].name || "merch")} x${lineQty(offers[0])}${offers.length > 1 ? ` +${offers.length - 1} more` : ""}`
                        : "made a purchase",
                    image: offers.length ? imageForLine(session, offers[0]) : "",
                    sound: alertSound ? alertSound.file : "",
                    volume: alertSound ? alertSound.volume : 1,
                    banner: bannerForOffers(session, offers),
                    shadow: shadowForOffers(session, offers),
                });
            }
        }
        for (const o of rows) // advance cursor past the newest we saw
            if (o.createdAt && o.createdAt > ordersCursor)
                ordersCursor = o.createdAt;
        // something sold, so the progress bars are now wrong — pull the report shortly rather than at the floor
        if (rows.length)
            queueUnits(FW_UNITS_NUDGE_TIME);
    }

    // one read of page 0; assumes newest-first (logged on baseline so we can confirm). new = id not seen since
    // startup. returns how the page looked so the caller can decide how wide to read next time.
    async function readPage(list: FwList, make: (row: any) => TimerEvent){
        const rows = await get(list.path, { size: list.size });
        let fresh = 0;
        for (const row of rows){
            if (!row.id || list.seen.has(row.id))
                continue;
            list.seen.add(row.id);
            fresh++;
            if (baselined)
                emit(make(row));
        }
        while (list.seen.size > 5000) // keep the dedup set bounded over a weeks-long run
            list.seen.delete(list.seen.values().next().value);
        return { returned: rows.length, fresh };
    }

    // page 0 only, so a burst bigger than the page we asked for would push rows off it unread and we'd never see
    // them again. a page that comes back entirely new is exactly that warning, and the rows are still on page 0
    // for the moment — so widen and re-read immediately instead of waiting for the next cycle. bounded, because a
    // shop whose page is always full must not spin here.
    async function pollList(list: FwList, make: (row: any) => TimerEvent){
        for (let pass = 0; pass < 5; pass++){ // min -> max doubles four times, so five reads can always reach it
            const { returned, fresh } = await readPage(list, make);
            if (!baselined) // every row is unseen on the seeding read; sizing off that would be meaningless
                return;
            const saturated = fresh > 0 && fresh >= returned && returned >= list.size;
            const before = list.size;
            const next = nextPageSize(list.size, fresh, list.quiet);
            if (next.size !== before)
                diag(`FW-DIAG ${watching}: ${list.path} page ${next.size > before ? "grown" : "shrunk"} to ${next.size} (${fresh} new of ${returned})`);
            list.size = next.size;
            list.quiet = next.quiet;
            if (!saturated || list.size === before) // caught up, or already as wide as we're allowed to look
                return;
        }
    }

    async function poll(){
        if (polling) // previous cycle still running (slow api / timeout) — skip this tick rather than stack
            return;
        polling = true;
        try {
            await pollOrders();
            await pollList(donationList, (d) => {
                const usd = Number(d.amounts && d.amounts.total && d.amounts.total.value) || 0;
                if (!usd)
                    diag(`FW-DIAG ${watching}: donation ${d.id} parsed to $0 (check amounts.total field)`);
                pushFwActivity(session, { t: Date.now(), product: `Donation $${usd}`, user: d.username || d.email || "someone", message: typeof d.message === "string" ? d.message : "", image: "", unit: "donation" });
                return { platform: "fourthwall", kind: "money", usd, unit: "donation", label: `donation $${usd} from ${d.username || d.email || "someone"}` };
            });
            await pollList(memberList, (m) => {
                // flat per new member (renewals reuse the same id so polling won't re-fire them; tiers TBD)
                pushFwActivity(session, { t: Date.now(), product: "New membership", user: m.nickname || m.email || "someone", message: "", image: "", unit: "membership" });
                return { platform: "fourthwall", kind: "member", count: 1, unit: "membership", label: `membership from ${m.nickname || m.email || "someone"}` };
            });
            if (!diagnosed){ // creds work (we got here), so dump real samples once
                await logDiagnostics();
                diagnosed = true;
            }
            if (!baselined){
                baselined = true;
                console.log(`Fourthwall baseline done for ${watching} (${donationList.seen.size} donations, ${memberList.seen.size} members seen)`);
            }
            const wasBroken = !session.fourthwallStatus || !!session.fourthwallError;
            session.fourthwallError = "";
            session.fourthwallLastOkAt = Date.now(); // each ok poll re-verifies the creds; surfaced as "verified Xs ago"
            if (!session.fourthwallStatus){
                session.fourthwallStatus = true;
                console.log(`Connected to ${watching}'s Fourthwall!`);
            }
            // only the transition is worth a broadcast. a healthy poll changes nothing a client can see except
            // lastOkAt, and the dashboard — the only page that shows it — re-syncs on its own 5s timer anyway;
            // real activity broadcasts through the timer change it causes. pushing the whole payload to every
            // open source every 5s regardless is what this used to do.
            if (wasBroken)
                emitSync(session.userId);
        } catch (err: any) {
            const wasOk = session.fourthwallStatus;
            const prevError = session.fourthwallError;
            session.fourthwallStatus = false;
            session.fourthwallError = describeError(err); // surfaced to the connections ui via wsSync
            const r = err && err.response;
            // include the failing url + fourthwall's error body so auth-vs-bad-request-vs-scope is obvious
            console.log(`Fourthwall poll failed for ${watching}:`, r
                ? `${r.status} ${err.config && err.config.method} ${err.config && err.config.url} -> ${JSON.stringify(r.data)}`
                : (err && err.message));
            // an outage that lasts an hour shouldn't re-broadcast the same red light 720 times
            if (wasOk || prevError !== session.fourthwallError)
                emitSync(session.userId);
        } finally {
            polling = false;
        }
    }

    // refresh the per-product units-sold tallies for the /fwprogress bars. runs on its own timer (guarded by
    // pollingUnits so a slow report can't stack) and never touches the order poll's status/error — a hiccup
    // here shouldn't flap the connection light.
    async function pollUnits(){
        if (pollingUnits)
            return;
        pollingUnits = true;
        try {
            const map = await fetchFourthwallUnitsSold(session);
            // the bars only move when a number does, and on a shop that sells a few things an hour that's a
            // handful of broadcasts instead of 1,440 identical ones a day. compared key by key rather than by
            // stringify, since the report is free to hand back the same rows in a different order.
            const prev = session.fwUnitsSold || {};
            const keys = Object.keys(map);
            const moved = keys.length !== Object.keys(prev).length || keys.some((k) => prev[k] !== map[k]);
            session.fwUnitsSold = map;
            if (moved)
                emitSync(session.userId); // push the fresh counts to any open progress-bar browser source
        } catch (err: any) {
            const r = err && err.response;
            diag(`FW-DIAG ${watching}: units-sold report poll failed: ${r ? `${r.status} ${JSON.stringify(r.data)}` : (err && err.message)}`);
            queueUnits(FW_UNITS_RETRY_TIME); // don't sit on stale bars for the whole floor over one bad read
        } finally {
            pollingUnits = false;
        }
    }

    // an out-of-band report read, coalesced: the first caller sets the timer and later ones ride it, so a cycle
    // that lands ten orders (or a retry landing on top of a nudge) still costs one read of the analytics endpoint.
    function queueUnits(delayMs: number){
        if (unitsNudge || stopped)
            return;
        unitsNudge = setTimeout(() => {
            unitsNudge = 0;
            if (!stopped)
                pollUnits();
        }, delayMs);
    }

    // keep offerId -> thumbnail fresh so a newly listed product's first sale doesn't have to fall back to the
    // full-size original. failures are silent: a stale map only costs image bytes, never an event.
    function refreshThumbs(){
        fetchFourthwallProducts(session).catch((err: any) =>
            diag(`FW-DIAG ${watching}: product thumbnail refresh failed: ${(err && err.message) || err}`));
    }

    poll();
    timer = setInterval(poll, FW_POLL_TIME);
    pollUnits();
    unitsTimer = setInterval(pollUnits, FW_UNITS_POLL_TIME);
    refreshThumbs();
    thumbsTimer = setInterval(refreshThumbs, FW_THUMBS_POLL_TIME);

    return {
        disconnect(){
            stopped = true;
            if (timer){
                clearInterval(timer);
                timer = 0;
            }
            if (unitsTimer){
                clearInterval(unitsTimer);
                unitsTimer = 0;
            }
            if (thumbsTimer){
                clearInterval(thumbsTimer);
                thumbsTimer = 0;
            }
            if (unitsNudge){ // a pending nudge would otherwise fire a report read after disconnect
                clearTimeout(unitsNudge);
                unitsNudge = 0;
            }
            session.fourthwallStatus = false;
        }
    };
}
