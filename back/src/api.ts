import url from "url";
import axios, { AxiosResponse } from "axios";
import WebSocket from "ws";
import { WSS_PORT, WS_FORCE_SYNC_TIME, WS_HB_TIME, WS_MSG_BURST, WS_MSG_RATE, CLIENT_ID, ALLOWED_USERS } from "./config";
import { TimerWebSocket } from "./types";
import { bus, emitSync, emitFwAlert, reportError } from "./bus";
import { usersModel, dbCreate, USER_TABLE } from "./db";
import { DEFAULT_RATES, normalizeRates } from "./rates";
import { normalizeTimerEvents, normalizeEventLayers } from "./timerEvents";
import { mergeTextBoxes, findTextBox, setTextBoxText } from "./textBoxes";
import { normalizeFiresale, firesaleView, startFiresale, stopFiresale, declareFiresaleWinner, beginDraw, pushFiresale, runFiresaleCommand } from "./firesale";
import { testTimerEvent, firePlatformTriggers } from "./scheduler";
import { getUserSession, loginUser, logoutUser, connectTwitchFor, connectStreamlabsFor, connectFourthwallFor, connectTwitchSubsFor } from "./session";
import { normalizeFwProductBonuses, normalizeFwProductSounds, normalizeFwProductAlerts, normalizeFwProductBanners, normalizeFwProductShadows, normalizeFwProductNames, displayNameFor, alertsEnabledFor, fetchFourthwallProducts, pushFwActivity, describeError as describeFwError } from "./platforms/fourthwall";
import { normalizeWidgetSettings } from "./widgetSettings";
import { normalizeTwitchSubs, twitchSubsReady, startTwitchSubsDeviceAuth, runTwitchSubsDeviceAuth, describeError as describeTwitchSubsError } from "./platforms/twitchSubs";
import { setEndTime, isStoppedAtZero } from "./timer";
import { logTimerEvent, sendLogPage } from "./log";
import { handle } from "./events";
import { parseCommand } from "./commands";
import { CHAT_CMD_MAX_TIME } from "./config";

let wss: WebSocket.Server;

function wsCloseError(ws: TimerWebSocket, reason: string){
    // the socket may already be closing/broken (heartbeat timeout races the close) — never let that throw
    try {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(
                JSON.stringify({
                    success: false,
                    error: reason,
                })
            );
        ws.close();
    } catch (err) {
        console.log("Failed to close a client socket cleanly:", err);
    }
}

// which sync fields each browser-source page actually reads. everything omitted is dashboard config a source has
// no use for — the rates, the six per-product maps, the timer events, the connection/authorization state — and
// a /subcount source was being handed all of it twice a second to render one integer.
// each page's ENTRY MUST INCLUDE THE KEY IT GATES ON: the pages branch on `"subCounts" in response` and friends,
// so dropping the gate key doesn't degrade a source, it silences it. syncFieldsCoverPageGates() in the tests
// pins that down. an unlisted page (the dashboard, or a socket with no page at all) gets the whole payload.
const SYNC_CORE = ["success", "endTime"]; // endTime: the widget counts off it, the activity feed uses it as "ready"
export const PAGE_SYNC_FIELDS: { [page: string]: string[] } = {
    widget: ["widgetSettings"],
    subcount: ["widgetSettings", "activeSubs", "subCounts"],
    subprogress: ["widgetSettings", "subCounts"],
    fwprogress: ["widgetSettings", "fwUnitsSold"],
    fwalert: ["widgetSettings"],
    fwactivity: [],  // its rows arrive as targeted fwActivity/fwActivityEntry pushes, not on the sync
    events: [],      // likewise for playEvent
    // one text box per source, the one its ?box= names — a source has no use for the other 49, and the words a
    // mod put on one overlay have no business being pushed to every other overlay twice a second
    text: ["textBox"],
    // the whole run in one field (phase, entrants, winner) plus the look. targeted firesale pushes keep it
    // live between syncs — a 5s force sync would have names turning up long after the chatter typed !enter.
    firesale: ["firesale"],
};

export function projectSync(page: string | undefined, full: any): any {
    const fields = page ? PAGE_SYNC_FIELDS[page] : undefined;
    if (!fields)
        return full;
    const out: any = {};
    for (const k of SYNC_CORE.concat(fields))
        out[k] = full[k];
    return out;
}

function wsSync(ws: TimerWebSocket) {
    if (!ws.isReady)
        return;
    if (ws.readyState !== WebSocket.OPEN)
        return;
    const curSession = getUserSession(ws.userId);
    ws.send(
        JSON.stringify(projectSync(ws.page, {
            success: true,
            endTime: curSession.endTime,
            slStatus: curSession.slStatus,
            twitchStatus: curSession.twitchStatus,
            fourthwallStatus: curSession.fourthwallStatus,
            twitchSubsStatus: !!curSession.twitchSubsStatus,
            capSeconds: curSession.capSeconds,
            stopAtZero: !!curSession.stopAtZero,
            anon: curSession.ignoreAnon,
            rates: curSession.rates,
            // last genuine event per platform (ms) — lets the ui prove data is flowing, esp. youtube/kick which only relay
            lastEventAt: curSession.lastEventAt || {},
            timerEvents: curSession.timerEvents || [],
            eventLayers: curSession.eventLayers || [],
            textBoxes: curSession.textBoxes || [],
            // per-socket, not per-user: the single box this client's ?box= resolves to (null for the dashboard,
            // which reads the whole list above). the projection hands this to /text sources and nothing else.
            textBox: ws.box ? findTextBox(curSession, ws.box) : null,
            // the giveaway currently on screen (idle when there isn't one). carried on the sync so a source
            // that connects mid-firesale, or reconnects after a blip, picks the run straight back up.
            firesale: firesaleView(curSession),
            firesaleSettings: curSession.firesaleSettings || {},
            connections: {
                twitch: { channel: curSession.connections.twitch.channel, error: curSession.twitchError || "" },
                streamlabs: { hasToken: !!curSession.connections.streamlabs.token, error: curSession.slError || "" },
                fourthwall: {
                    configured: !!(curSession.connections.fourthwall && curSession.connections.fourthwall.username),
                    error: curSession.fourthwallError || "",
                    lastOkAt: curSession.fourthwallLastOkAt || 0 // last successful credential-verifying poll
                },
                twitchSubs: {
                    // credentials pasted, but the one-time authorize may still be outstanding — the ui needs
                    // to tell those two states apart to know which step to show
                    hasApp: !!(curSession.connections.twitchSubs && curSession.connections.twitchSubs.clientId
                        && curSession.connections.twitchSubs.clientSecret),
                    authorized: twitchSubsReady(curSession),
                    error: curSession.twitchSubsError || "",
                    lastOkAt: curSession.twitchSubsLastOkAt || 0,
                    login: curSession.twitchSubsLogin || "",
                    // the code the streamer still has to type in. deviceCode is deliberately not included —
                    // it's the credential half, and the browser has no use for it.
                    pending: curSession.twitchSubsPending ? {
                        userCode: curSession.twitchSubsPending.userCode,
                        verificationUri: curSession.twitchSubsPending.verificationUri,
                        expiresAt: curSession.twitchSubsPending.expiresAt
                    } : null
                }
            },
            merchValues: curSession.merchValues,
            fwProductBonuses: curSession.fwProductBonuses || {},
            fwProductSounds: curSession.fwProductSounds || {},
            fwProductAlerts: curSession.fwProductAlerts || {},
            fwProductBanners: curSession.fwProductBanners || {},
            fwProductShadows: curSession.fwProductShadows || {},
            fwProductNames: curSession.fwProductNames || {},
            // { [offerId]: units sold } powering the /fwprogress sales-progress browser sources
            fwUnitsSold: curSession.fwUnitsSold || {},
            widgetSettings: curSession.widgetSettings || {},
            // live snapshot of who is subscribed right now (falls as subs lapse), separate from the all-time
            // tallies below. ok=false means the number is stale — the sources show a dash rather than a lie.
            activeSubs: {
                count: curSession.subsActive || 0,
                points: curSession.subsPoints || 0,
                ok: !!curSession.twitchSubsStatus
            },
            // all-time per-service sub tallies for the dashboard + /subcount browser sources
            subCounts: {
                twitch: curSession.subCountTwitch || 0,
                youtube: curSession.subCountYoutube || 0,
                kick: curSession.subCountKick || 0
            }
        }))
    );
}

async function wsLogin(ws: TimerWebSocket, accessToken: string){
    ws.userId = 0;
    ws.isAlive = true;
    ws.msgTokens = WS_MSG_BURST;
    ws.msgLast = Date.now();
    ws.msgWarnAt = 0;
    ws.forceSyncInterval = setInterval(()=>{
        try {
            wsSync(ws);
        } catch (err) {
            console.log("Periodic sync failed for a client:", err);
        }
    },WS_FORCE_SYNC_TIME);
    ws.hbInterval = setInterval(()=>{
        if (ws.isAlive == false){
            wsCloseError(ws, "Did not heartbeat in time!");
            return;
        }
        ws.isAlive = false;
        try {
            ws.ping(); // throws if the socket died between ticks
        } catch (err) {
            console.log("Heartbeat ping failed for a client:", err);
        }
    }, WS_HB_TIME);

    if (!accessToken){
        wsCloseError(ws, "No token provided!");
        return;
    }

    let userName = "";

    if (CLIENT_ID == ""){ // Unauthorized Logins
        ws.userId = 1;
        userName = accessToken;
    }
    else { // Authorized Logins
        let httpRes: AxiosResponse;
        try {
            httpRes = await axios.get(`https://api.twitch.tv/helix/users`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Client-Id": CLIENT_ID,
                }
            });
        } catch {
            wsCloseError(ws, "Failed to login!");
            return;
        }
        ws.userId = httpRes.data.data[0].id;
        userName = httpRes.data.data[0].login;
    }

    if (!ALLOWED_USERS.includes(userName)){
        wsCloseError(ws,"Channel name is not in ALLOWED_USERS!");
        return;
    }

    const res = await usersModel.findByPk(ws.userId);

    if (!res){
        const newUser = {
            userId: ws.userId,
            name: userName as string,
            accessToken: accessToken as string,
            slToken: "",
            subTime: USER_TABLE.subTime.defaultValue,
            dollarTime: USER_TABLE.dollarTime.defaultValue,
            endTime: USER_TABLE.endTime.defaultValue,
            capSeconds: USER_TABLE.capSeconds.defaultValue,
            stopAtZero: USER_TABLE.stopAtZero.defaultValue,
            ignoreAnon: USER_TABLE.ignoreAnon.defaultValue,
            rates: DEFAULT_RATES,
            connections: { twitch: { channel: userName }, streamlabs: { token: "" } }
        }
        await dbCreate(newUser);
        loginUser(newUser);
        return;
    }

    const curSession = getUserSession(ws.userId);

    if (curSession.userId == 0){
        wsCloseError(ws, `User ID ${ws.userId} is not logged in but is present in the database!`);
        return;
    }

    if (ws.userId == 1 && accessToken != curSession.name){ // Changing unauthorized user's name
        console.log(`Changing userId 1 from ${curSession.name} to ${accessToken}`);
        let newSession = Object.assign({},curSession);
        newSession.name = accessToken;
        newSession.accessToken = accessToken;
        logoutUser(1);
        loginUser(newSession);
    }

    return;
}

export function startApi(){
    wss = new WebSocket.Server({port: WSS_PORT});

    // a server-level socket error (EMFILE, EADDRINUSE after a rebind, ...) must be logged, never thrown
    wss.on("error", (err) => {
        console.log("WebSocket server error:", err);
    });

    // server-side lines land in the dashboard terminal (page=settings) as commandResult lines — red for the
    // errors this mostly carries, green for the successes worth showing (a mod's chat command landing)
    bus.on("terminalLine", (id: number, message: string, ok: boolean) => {
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id != ws.userId || ws.page !== "settings" || ws.readyState !== WebSocket.OPEN)
                continue;
            try {
                ws.send(JSON.stringify({ commandResult: { ok: !!ok, message } }));
            } catch (err) {
                console.log("Failed to send a terminal line to a client:", err);
            }
        }
    });

    bus.on("sync", (id: number) => {
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id != ws.userId)
                continue;
            // one dying socket must not abort the broadcast to the rest, nor unwind back into the event handler
            try {
                wsSync(ws);
            } catch (err) {
                console.log("Failed to sync a client:", err);
            }
        }
    });

    bus.on("logEntry", (id: number, entry: any) => {
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id != ws.userId || ws.readyState !== WebSocket.OPEN)
                continue;
            try {
                ws.send(JSON.stringify({ logEntry: entry }));
            } catch (err) {
                console.log("Failed to send a log entry to a client:", err);
            }
        }
    });

    // live feed entries go ONLY to this user's /fwactivity page(s)
    bus.on("fwActivityEntry", (id: number, entry: any) => {
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id != ws.userId || ws.page !== "fwactivity" || ws.readyState !== WebSocket.OPEN)
                continue;
            try {
                ws.send(JSON.stringify({ fwActivityEntry: entry }));
            } catch (err) {
                console.log("Failed to send an activity entry to a client:", err);
            }
        }
    });

    // purchase alerts go ONLY to this user's /fwalert browser source(s)
    bus.on("fwAlert", (id: number, payload: any) => {
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id != ws.userId || ws.page !== "fwalert" || ws.readyState !== WebSocket.OPEN)
                continue;
            try {
                ws.send(JSON.stringify({ fwAlert: payload }));
            } catch (err) {
                console.log("Failed to send a purchase alert to a client:", err);
            }
        }
    });

    // firesale state goes to this user's /firesale browser source(s) and to the dashboard, which shows the run
    // (entrants, countdown, winner) on its Firesale tab. everything else on the sync is unchanged, so a source
    // that missed a push still catches up on the next one.
    bus.on("firesale", (id: number, payload: any) => {
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id != ws.userId || ws.readyState !== WebSocket.OPEN)
                continue;
            if (ws.page !== "firesale" && ws.page !== "settings")
                continue;
            try {
                ws.send(JSON.stringify({ firesale: payload }));
            } catch (err) {
                console.log("Failed to send firesale state to a client:", err);
            }
        }
    });

    // play commands go ONLY to this user's /events browser source(s), not the dashboard/widget — and only to
    // the ones on the event's layer, so a scene can hold several sources in different places and each event
    // renders to the one it names. "" is the default layer: a source url with no ?layer=, and an event that
    // names none. that pairing is what keeps a setup built before layers existed working untouched.
    bus.on("playEvent", (id: number, payload: any) => {
        const layer = String((payload && payload.layer) || "");
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id != ws.userId || ws.page !== "events" || ws.readyState !== WebSocket.OPEN)
                continue;
            if (String(ws.layer || "") !== layer)
                continue;
            try {
                ws.send(JSON.stringify({ playEvent: payload }));
            } catch (err) {
                console.log("Failed to send a play event to a client:", err);
            }
        }
    });

    wss.on("connection", (ws: TimerWebSocket, req: any) => {
        console.log("A client has connected to the WSS backend!");
        ws.isReady = false;

        const urlParams = url.parse(req.url, true).query;
        const accessToken = urlParams.token as string;
        ws.page = urlParams.page as string; // which page this client is (settings/widget/events) — routes play commands
        // page=events only: which browser-source layer, so playEvent can pick out the right source(s)
        ws.layer = typeof urlParams.layer === "string" ? urlParams.layer.slice(0, 100) : "";
        // page=text only: which text box this source shows
        ws.box = typeof urlParams.box === "string" ? urlParams.box.slice(0, 100) : "";

        wsLogin(ws, accessToken).then(()=>{
            ws.isReady = true;
            emitSync(ws.userId);
        }).catch((err)=>{
            console.log("wsLogin failed:", err);
            wsCloseError(ws, "Failed to login!");
        });

        ws.on("pong",()=>{
            ws.isAlive = true;
        });

        // without a listener, a socket error (client vanished mid-write, protocol violation) is re-thrown
        // by the emitter and would only be saved by the process-level net — handle it here instead
        ws.on("error", (err)=>{
            console.log("Client socket error:", err);
        });

        ws.on('close',()=>{
            console.log("A client has disconnected from the WSS backend!");
            clearInterval(ws.forceSyncInterval);
            clearInterval(ws.hbInterval);
        });

        ws.on("message", (data: any)=>{
            if (!ws.isReady)
                return;
            // token-bucket rate limit per connection — guards against FE loops spamming the server
            const now = Date.now();
            ws.msgTokens = Math.min(WS_MSG_BURST, ws.msgTokens + ((now - ws.msgLast) / 1000) * WS_MSG_RATE);
            ws.msgLast = now;
            if (ws.msgTokens < 1){
                if (now - ws.msgWarnAt > 5000){
                    ws.msgWarnAt = now;
                    console.log(`Rate limiting userId ${ws.userId} (too many messages) — dropping.`);
                }
                return;
            }
            ws.msgTokens -= 1;
            const id = ws.userId;
            const curSession = getUserSession(id);

            try {
                var jData = JSON.parse(data);
            } catch (error) {
                wsCloseError(ws, "Error while parsing JSON payload!");
                return;
            }

            // one containment for every inbound message: a throw inside any case (setConnection teardown,
            // runCommand, setEndTime, ...) is logged + surfaced on the dashboard terminal, never fatal
            try {
            switch (jData.event) {
                case "getTime":
                    break;
                case "getLogPage":
                    sendLogPage(ws, jData.before);
                    return;
                case "runCommand": {
                    // terminal input: same parser/grammar as chat would use, routed through the one handler
                    const parsed = parseCommand(typeof jData.command === "string" ? jData.command : "");
                    if (parsed.help){
                        ws.send(JSON.stringify({ commandResult: { ok: true, message: parsed.help } }));
                        return;
                    }
                    if (parsed.text){
                        // a text command changes no time, so it reports itself and skips the timer path entirely
                        const res = setTextBoxText(curSession, parsed.text.box, parsed.text.text);
                        ws.send(JSON.stringify({ commandResult: res }));
                        if (res.ok)
                            emitSync(id); // pushes the new words to that box's browser source(s)
                        return;
                    }
                    if (parsed.firesale){
                        // drives the giveaway overlay; grants no time, so it reports itself and stops here
                        const res = runFiresaleCommand(curSession, parsed.firesale);
                        ws.send(JSON.stringify({ commandResult: res }));
                        return;
                    }
                    if (parsed.error || !parsed.event){
                        ws.send(JSON.stringify({ commandResult: { ok: false, message: parsed.error || "Invalid command." } }));
                        return;
                    }
                    const before = curSession.endTime;
                    const wasStopped = isStoppedAtZero(curSession); // handle() returns early in that case
                    handle(curSession, parsed.event); // applies rates + cap, adds time, writes the log entry
                    const added = Math.round((curSession.endTime - before) / 1000);
                    const message = added !== 0
                        ? `+${added}s — ${parsed.event.label}`
                        : wasStopped
                            ? `no time added — the timer is at 0 and "stop at zero" is on`
                            : `no time added — rate is 0 or over the ${CHAT_CMD_MAX_TIME / 3600}h command cap`;
                    ws.send(JSON.stringify({ commandResult: { ok: added !== 0, message } }));
                    return;
                }
                case "setConnection": {
                    const platform = jData.platform;
                    const config = jData.config || {};
                    if (platform === "twitch") {
                        const channel = (typeof config.channel === "string" ? config.channel : "").trim().toLowerCase();
                        curSession.connections.twitch.channel = channel;
                        if (curSession.conTMI) // rejects if the client never connected — that's fine, just log it
                            curSession.conTMI.disconnect().catch((err: any)=>console.log("TMI disconnect failed:", err && err.message));
                        curSession.twitchStatus = false;
                        curSession.conTMI = channel ? connectTwitchFor(curSession) : undefined;
                    } else if (platform === "streamlabs") {
                        if (typeof config.token !== "string" || config.token.length >= 1000)
                            break;
                        curSession.connections.streamlabs.token = config.token;
                        if (curSession.conSL)
                            curSession.conSL.disconnect();
                        curSession.slStatus = false;
                        curSession.conSL = config.token ? connectStreamlabsFor(curSession) : undefined;
                    } else if (platform === "twitchsubs") {
                        if (curSession.conTwitchSubs)
                            curSession.conTwitchSubs.disconnect();
                        curSession.conTwitchSubs = undefined;
                        curSession.twitchSubsStatus = false;
                        curSession.twitchSubsError = "";
                        curSession.twitchSubsPending = undefined; // a code for the old app is worthless
                        if (config.disconnect) {
                            curSession.connections.twitchSubs = normalizeTwitchSubs({});
                            curSession.subsActive = 0;
                            curSession.subsPoints = 0;
                            break;
                        }
                        // changing the app means the old refresh token is worthless, so drop it and make them
                        // authorize again rather than leaving a token that can only fail
                        const prev = curSession.connections.twitchSubs || {};
                        const clientId = typeof config.clientId === "string" ? config.clientId.trim() : "";
                        const clientSecret = typeof config.clientSecret === "string" ? config.clientSecret.trim() : "";
                        const sameApp = clientId === prev.clientId && clientSecret === prev.clientSecret;
                        curSession.connections.twitchSubs = normalizeTwitchSubs({
                            clientId,
                            clientSecret,
                            refreshToken: sameApp ? prev.refreshToken : "",
                            broadcasterId: sameApp ? prev.broadcasterId : "",
                        });
                        if (twitchSubsReady(curSession))
                            curSession.conTwitchSubs = connectTwitchSubsFor(curSession);
                    } else if (platform === "fourthwall") {
                        if (curSession.conFW)
                            curSession.conFW.disconnect();
                        curSession.fourthwallStatus = false;
                        curSession.fourthwallError = "";
                        if (config.disconnect) {
                            curSession.connections.fourthwall = { username: "", password: "" };
                            curSession.conFW = undefined;
                            break;
                        }
                        const username = typeof config.username === "string" ? config.username.trim() : "";
                        const password = typeof config.password === "string" ? config.password : "";
                        if (!username || !password)
                            break;
                        curSession.connections.fourthwall = { username, password };
                        curSession.conFW = connectFourthwallFor(curSession);
                    }
                    break;
                }
                case "setRates":
                    curSession.rates = normalizeRates(jData.rates);
                    break;
                case "setTimerEvents":
                    curSession.timerEvents = normalizeTimerEvents(jData.timerEvents);
                    break;
                case "setEventLayers":
                    curSession.eventLayers = normalizeEventLayers(jData.layers);
                    break;
                case "setTextBoxes":
                    // the box list and how each one looks. the words are left alone — those only move through
                    // setTextBoxText / !changetext, so this can't undo a mod's last change.
                    curSession.textBoxes = mergeTextBoxes(curSession.textBoxes, jData.boxes);
                    break;
                case "setTextBoxText": {
                    // the dashboard typing into a box, same path a chat command takes
                    const res = setTextBoxText(curSession, jData.box, typeof jData.text === "string" ? jData.text : "");
                    if (!res.ok)
                        ws.send(JSON.stringify({ commandResult: res }));
                    break;
                }
                case "setFiresaleSettings": {
                    // merged onto what's stored, so the tab can push one field without resending the rest
                    const patch = jData.settings && typeof jData.settings === "object" && !Array.isArray(jData.settings)
                        ? jData.settings
                        : {};
                    curSession.firesaleSettings = normalizeFiresale({ ...(curSession.firesaleSettings || {}), ...patch });
                    // the look (colours, music, bouncer cap) rides the firesale payload, so a source already on
                    // screen picks up a change immediately rather than at the next force sync
                    pushFiresale(curSession);
                    break;
                }
                case "startFiresale":
                    // the dashboard starting one by hand — a rehearsal, or a giveaway whose announcement we
                    // missed. same path fourthwall's announcement takes.
                    startFiresale(curSession, {
                        seconds: Number(jData.seconds) || 0,
                        prize: typeof jData.prize === "string" ? jData.prize : "",
                        gifter: typeof jData.gifter === "string" ? jData.gifter : "",
                    });
                    break;
                case "stopFiresale":
                    stopFiresale(curSession);
                    break;
                case "endFiresaleEntries":
                    // close entries early and go to DRAWING…, still waiting on fourthwall for the winner
                    beginDraw(curSession);
                    break;
                case "setFiresaleWinner": {
                    // the operator naming the winner by hand, for when fourthwall's announcement never lands
                    const name = typeof jData.name === "string" ? jData.name.trim() : "";
                    if (name)
                        declareFiresaleWinner(curSession, name);
                    break;
                }
                case "setFwProductBonuses":
                    curSession.fwProductBonuses = normalizeFwProductBonuses(jData.bonuses);
                    break;
                case "setFwProductSounds":
                    curSession.fwProductSounds = normalizeFwProductSounds(jData.sounds);
                    break;
                case "setFwProductAlerts":
                    curSession.fwProductAlerts = normalizeFwProductAlerts(jData.alerts);
                    break;
                case "setFwProductBanners":
                    curSession.fwProductBanners = normalizeFwProductBanners(jData.banners);
                    break;
                case "setFwProductShadows":
                    curSession.fwProductShadows = normalizeFwProductShadows(jData.shadows);
                    break;
                case "setFwProductNames":
                    curSession.fwProductNames = normalizeFwProductNames(jData.names);
                    break;
                case "setWidgetSettings": {
                    // merged onto what's already stored, so a client can push one field without having to
                    // resend the others (the normalizer would otherwise reset the omitted ones to defaults)
                    const patch = jData.settings && typeof jData.settings === "object" && !Array.isArray(jData.settings)
                        ? jData.settings
                        : {};
                    curSession.widgetSettings = normalizeWidgetSettings({ ...(curSession.widgetSettings || {}), ...patch });
                    break;
                }
                case "startTwitchSubsDeviceAuth": {
                    // no redirect url is involved: twitch requires https on those and this app is served over
                    // plain http, so we ask for a short code the streamer types in on any device instead
                    const t = curSession.connections.twitchSubs || {};
                    if (!t.clientId || !t.clientSecret){
                        curSession.twitchSubsError = "Save the Client ID and Secret first.";
                        emitSync(id);
                        return;
                    }
                    startTwitchSubsDeviceAuth(curSession)
                        .then(() => {
                            curSession.twitchSubsError = "";
                            emitSync(id); // hands the code to the dashboard via the normal sync
                            runTwitchSubsDeviceAuth(curSession, () => {
                                if (curSession.conTwitchSubs)
                                    curSession.conTwitchSubs.disconnect();
                                curSession.conTwitchSubs = connectTwitchSubsFor(curSession);
                                emitSync(id);
                            });
                        })
                        .catch((err) => {
                            curSession.twitchSubsError = err && err.response
                                ? describeTwitchSubsError(err)
                                : (err && err.message) || "Couldn't start the Twitch authorization.";
                            emitSync(id);
                        });
                    return;
                }
                case "getFwActivity":
                    // backlog for the /fwactivity page; live additions arrive as fwActivityEntry pushes
                    ws.send(JSON.stringify({ fwActivity: curSession.fwActivity || [] }));
                    return;
                case "getFwProducts":
                    // fetched on demand with the stored credentials; reply only to the asking client
                    fetchFourthwallProducts(curSession)
                        .then((products) => {
                            if (ws.readyState === WebSocket.OPEN)
                                ws.send(JSON.stringify({ fwProducts: products }));
                        })
                        .catch((err) => {
                            if (ws.readyState === WebSocket.OPEN)
                                ws.send(JSON.stringify({ fwProducts: [], fwProductsError: err && err.response ? describeFwError(err) : (err && err.message) || "Failed to load products." }));
                        });
                    return;
                case "testTimerEvent":
                    // play immediately on the /events source, bypassing the schedule + remaining-time window
                    testTimerEvent(curSession, typeof jData.id === "string" ? jData.id : "");
                    return;
                case "testFwPurchase": {
                    // simulate a shop order from the dashboard: same rate + per-product-bonus path a real order
                    // takes, but manual (command-capped, doesn't count as platform liveness). the price comes from
                    // the product list the client loaded. future hook: also fire a browser-source notification here.
                    const pid = typeof jData.id === "string" ? jData.id.slice(0, 100) : "";
                    // the shop's name arrives from the client; the custom name (if any) overrides it, exactly
                    // as it would on a real order
                    const shopName = ((typeof jData.name === "string" && jData.name) ? jData.name : pid).slice(0, 200);
                    const pname = displayNameFor(curSession, pid, shopName);
                    const usd = Math.min(Math.max(Number(jData.usd) || 0, 0), 100000);
                    if (!pid){
                        ws.send(JSON.stringify({ commandResult: { ok: false, message: "Simulated purchase: missing product id." } }));
                        return;
                    }
                    const simWasStopped = isStoppedAtZero(curSession);
                    const beforeSim = curSession.endTime;
                    handle(curSession, { platform: "fourthwall", kind: "money", usd, unit: "order", manual: true, label: `simulated order: ${pname} ($${usd})` });
                    const orderFlat = Number(curSession.rates && curSession.rates.fourthwall && curSession.rates.fourthwall.orderFlat) || 0;
                    if (orderFlat > 0)
                        handle(curSession, { platform: "fourthwall", kind: "time", seconds: orderFlat, manual: true, label: `simulated order bonus` });
                    const perItem = Number(curSession.fwProductBonuses && curSession.fwProductBonuses[pid]) || 0;
                    if (perItem)
                        handle(curSession, { platform: "fourthwall", kind: "time", seconds: perItem, manual: true, label: `simulated product bonus: ${pname}` });
                    // donation / product-bought event triggers fire too, so a simulated purchase exercises them the
                    // same way it does the feed and the alert. handle() skipped them above: this order is manual,
                    // and manual traffic must never fire triggers on its own (a mod's terminal command isn't a sale).
                    firePlatformTriggers(curSession, {
                        platform: "fourthwall", kind: "money", usd, unit: "order",
                        fwOffers: [{ id: pid, qty: 1 }], label: `simulated order: ${pname}`,
                    });
                    // feed always fires; the alert respects the per-product toggle so a simulated purchase
                    // reflects exactly what a real one would show
                    pushFwActivity(curSession, { t: Date.now(), product: pname, user: "SIMULATED", message: "this is a test purchase", image: typeof jData.image === "string" ? jData.image.slice(0, 2000) : "", unit: "order", qty: 1 });
                    if (alertsEnabledFor(curSession, pid)){
                        const simSound = (curSession.fwProductSounds && curSession.fwProductSounds[pid]) || null;
                        emitFwAlert(id, {
                            name: "SIMULATED",
                            message: `purchased ${pname} x1`,
                            image: typeof jData.image === "string" ? jData.image.slice(0, 2000) : "",
                            sound: simSound && simSound.file ? simSound.file : "",
                            volume: simSound && Number.isFinite(simSound.volume) ? simSound.volume : 1,
                            banner: (curSession.fwProductBanners && curSession.fwProductBanners[pid]) || "",
                            shadow: !!(curSession.fwProductShadows && curSession.fwProductShadows[pid]),
                        });
                    }
                    const addedSim = Math.round((curSession.endTime - beforeSim) / 1000);
                    ws.send(JSON.stringify({ commandResult: {
                        ok: addedSim !== 0,
                        message: addedSim !== 0
                            ? `+${addedSim}s — simulated purchase: ${pname} ($${usd}${perItem ? `, +${perItem}s bonus` : ""})`
                            : simWasStopped
                                ? `no time added — the timer is at 0 and "stop at zero" is on`
                                : `no time added — order rate and product bonus are both 0 for ${pname}`,
                    }}));
                    emitSync(id);
                    return;
                }
                case "setEndTime": {
                    const oldET = curSession.endTime;
                    setEndTime(curSession, Math.trunc(parseInt(jData.value) || 0));
                    logTimerEvent(curSession, "Manual change", oldET, curSession.endTime);
                    break;
                }
                case "setCapSeconds":
                    // user-set max timer length in seconds; 0 = no cap. re-clamp the current timer right away.
                    curSession.capSeconds = Math.max(0, Math.trunc(Number(jData.value) || 0));
                    setEndTime(curSession, curSession.endTime);
                    break;
                case "setStopAtZero":
                    curSession.stopAtZero = Boolean(jData.value) || false;
                    break;
                case "setAnon":
                    curSession.ignoreAnon = Boolean(jData.value) || false;
                    break;
                case "setSubCount": {
                    // dashboard reconciles a service's tally to its real current number (drift correction)
                    const v = Math.max(0, Math.trunc(Number(jData.value) || 0));
                    if (jData.platform === "twitch") curSession.subCountTwitch = v;
                    else if (jData.platform === "youtube") curSession.subCountYoutube = v;
                    else if (jData.platform === "kick") curSession.subCountKick = v;
                    break;
                }
            }
            emitSync(id);
            } catch (err) {
                reportError(id, `handling "${jData.event}" message`, err);
            }
        });
    });
}
