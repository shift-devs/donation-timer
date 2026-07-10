import axios from "axios";
import { TimerUserSession, TimerEvent } from "../types";
import { FW_POLL_TIME, FW_HTTP_TIMEOUT } from "../config";
import { emitSync } from "../bus";
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

// list the shop's products (offers) so the dashboard can attach per-product bonuses.
// offer ids here are the same ids that appear in an order's offers[] lines.
export async function fetchFourthwallProducts(session: TimerUserSession): Promise<{ id: string, name: string }[]> {
    const fw = (session.connections && session.connections.fourthwall) || {};
    if (!fw.username || !fw.password)
        throw new Error("Fourthwall is not connected.");
    const auth = "Basic " + Buffer.from(`${fw.username}:${fw.password}`).toString("base64");
    const out: { id: string, name: string }[] = [];
    for (let page = 0; page < 10; page++){ // hard page cap so a pathological shop can't loop us forever
        const res = await axios.get(`${FW_API}/products`, {
            headers: { Authorization: auth },
            params: { page, size: 100 },
            timeout: FW_HTTP_TIMEOUT,
            paramsSerializer: (p: any) => new URLSearchParams(p).toString(),
        });
        const rows = (res.data && res.data.results) || [];
        for (const r of rows)
            if (r && r.id)
                out.push({ id: String(r.id), name: String(r.name || r.slug || r.id) });
        if (rows.length < 100)
            break;
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
    const seenDonations = new Set<string>();
    const seenMembers = new Set<string>();
    let baselined = false; // first poll just records existing donation/member ids without granting time
    let polling = false;   // in-flight guard: a slow cycle must not let the interval stack up overlapping polls
    let diagnosed = false; // one-time payload dump (grep FW-DIAG) to confirm field shapes/sort/status on real data
    let timer: NodeJS.Timeout | number = 0;

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
            emit({ platform: "fourthwall", kind: "money", usd, unit: "order", label: `order $${usd} from ${o.username || o.email || "someone"}` });
            // per-product bonuses: flat seconds per item on top of the $-rate time, scaled by quantity
            const offers = Array.isArray(o.offers) ? o.offers : [];
            for (const line of offers){
                const per = Number(line && line.id && session.fwProductBonuses && session.fwProductBonuses[line.id]) || 0;
                if (!per)
                    continue;
                const qty = Math.max(1, Math.trunc(Number(line.variant && line.variant.quantity)) || 1);
                emit({ platform: "fourthwall", kind: "time", seconds: per * qty, label: `product bonus: ${line.name || line.id} x${qty}` });
            }
        }
        for (const o of rows) // advance cursor past the newest we saw
            if (o.createdAt && o.createdAt > ordersCursor)
                ordersCursor = o.createdAt;
    }

    // page 0 only; assumes newest-first (logged on baseline so we can confirm). new = id not seen since startup.
    async function pollById(path: string, seen: Set<string>, make: (row: any) => TimerEvent){
        const rows = await get(path, { size: 50 });
        for (const row of rows){
            if (!row.id || seen.has(row.id))
                continue;
            seen.add(row.id);
            if (baselined)
                emit(make(row));
        }
        if (seen.size > 5000) // keep the dedup set bounded over a weeks-long run
            seen.delete(seen.values().next().value);
    }

    async function poll(){
        if (polling) // previous cycle still running (slow api / timeout) — skip this tick rather than stack
            return;
        polling = true;
        try {
            await pollOrders();
            await pollById("/donations", seenDonations, (d) => {
                const usd = Number(d.amounts && d.amounts.total && d.amounts.total.value) || 0;
                if (!usd)
                    diag(`FW-DIAG ${watching}: donation ${d.id} parsed to $0 (check amounts.total field)`);
                return { platform: "fourthwall", kind: "money", usd, unit: "donation", label: `donation $${usd} from ${d.username || d.email || "someone"}` };
            });
            await pollById("/memberships/members", seenMembers, (m) => {
                // flat per new member (renewals reuse the same id so polling won't re-fire them; tiers TBD)
                return { platform: "fourthwall", kind: "member", count: 1, unit: "membership", label: `membership from ${m.nickname || m.email || "someone"}` };
            });
            if (!diagnosed){ // creds work (we got here), so dump real samples once
                await logDiagnostics();
                diagnosed = true;
            }
            if (!baselined){
                baselined = true;
                console.log(`Fourthwall baseline done for ${watching} (${seenDonations.size} donations, ${seenMembers.size} members seen)`);
            }
            session.fourthwallError = "";
            session.fourthwallLastOkAt = Date.now(); // each ok poll re-verifies the creds; surfaced as "verified Xs ago"
            if (!session.fourthwallStatus){
                session.fourthwallStatus = true;
                console.log(`Connected to ${watching}'s Fourthwall!`);
            }
            emitSync(session.userId);
        } catch (err: any) {
            session.fourthwallStatus = false;
            session.fourthwallError = describeError(err); // surfaced to the connections ui via wsSync
            const r = err && err.response;
            // include the failing url + fourthwall's error body so auth-vs-bad-request-vs-scope is obvious
            console.log(`Fourthwall poll failed for ${watching}:`, r
                ? `${r.status} ${err.config && err.config.method} ${err.config && err.config.url} -> ${JSON.stringify(r.data)}`
                : (err && err.message));
            emitSync(session.userId);
        } finally {
            polling = false;
        }
    }

    poll();
    timer = setInterval(poll, FW_POLL_TIME);

    return {
        disconnect(){
            if (timer){
                clearInterval(timer);
                timer = 0;
            }
            session.fourthwallStatus = false;
        }
    };
}
