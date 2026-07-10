import url from "url";
import axios, { AxiosResponse } from "axios";
import WebSocket from "ws";
import { WSS_PORT, WS_FORCE_SYNC_TIME, WS_HB_TIME, WS_MSG_BURST, WS_MSG_RATE, CLIENT_ID, ALLOWED_USERS } from "./config";
import { TimerWebSocket } from "./types";
import { bus, emitSync, emitFwAlert } from "./bus";
import { usersModel, dbCreate, USER_TABLE } from "./db";
import { DEFAULT_RATES, normalizeRates } from "./rates";
import { normalizeTimerEvents } from "./timerEvents";
import { testTimerEvent } from "./scheduler";
import { getUserSession, loginUser, logoutUser, connectTwitchFor, connectStreamlabsFor, connectFourthwallFor } from "./session";
import { normalizeFwProductBonuses, fetchFourthwallProducts, describeError as describeFwError } from "./platforms/fourthwall";
import { setEndTime } from "./timer";
import { logTimerEvent, sendLogPage } from "./log";
import { handle } from "./events";
import { parseCommand } from "./commands";
import { CHAT_CMD_MAX_TIME } from "./config";

let wss: WebSocket.Server;

function wsCloseError(ws: TimerWebSocket, reason: string){
    ws.send(
        JSON.stringify({
            success: false,
            error: reason,
        })
    );
    ws.close();
}

function wsSync(ws: TimerWebSocket) {
    if (!ws.isReady)
        return;
    if (ws.readyState !== WebSocket.OPEN)
        return;
    const curSession = getUserSession(ws.userId);
    ws.send(
        JSON.stringify({
            success: true,
            endTime: curSession.endTime,
            slStatus: curSession.slStatus,
            twitchStatus: curSession.twitchStatus,
            fourthwallStatus: curSession.fourthwallStatus,
            cap: curSession.shouldCap,
            anon: curSession.ignoreAnon,
            rates: curSession.rates,
            // last genuine event per platform (ms) — lets the ui prove data is flowing, esp. youtube/kick which only relay
            lastEventAt: curSession.lastEventAt || {},
            timerEvents: curSession.timerEvents || [],
            connections: {
                twitch: { channel: curSession.connections.twitch.channel, error: curSession.twitchError || "" },
                streamlabs: { hasToken: !!curSession.connections.streamlabs.token, error: curSession.slError || "" },
                fourthwall: {
                    configured: !!(curSession.connections.fourthwall && curSession.connections.fourthwall.username),
                    error: curSession.fourthwallError || "",
                    lastOkAt: curSession.fourthwallLastOkAt || 0 // last successful credential-verifying poll
                }
            },
            merchValues: curSession.merchValues,
            fwProductBonuses: curSession.fwProductBonuses || {}
        })
    );
}

async function wsLogin(ws: TimerWebSocket, accessToken: string){
    ws.userId = 0;
    ws.isAlive = true;
    ws.msgTokens = WS_MSG_BURST;
    ws.msgLast = Date.now();
    ws.msgWarnAt = 0;
    ws.forceSyncInterval = setInterval(()=>wsSync(ws),WS_FORCE_SYNC_TIME);
    ws.hbInterval = setInterval(()=>{
        if (ws.isAlive == false){
            wsCloseError(ws, "Did not heartbeat in time!");
            return;
        }
        ws.isAlive = false;
        ws.ping();
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
            shouldCap: USER_TABLE.shouldCap.defaultValue,
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

    // play commands go ONLY to this user's /events browser source(s), not the dashboard/widget
    bus.on("playEvent", (id: number, payload: any) => {
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id != ws.userId || ws.page !== "events" || ws.readyState !== WebSocket.OPEN)
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
                    if (parsed.error || !parsed.event){
                        ws.send(JSON.stringify({ commandResult: { ok: false, message: parsed.error || "Invalid command." } }));
                        return;
                    }
                    const before = curSession.endTime;
                    handle(curSession, parsed.event); // applies rates + cap, adds time, writes the log entry
                    const added = Math.round((curSession.endTime - before) / 1000);
                    const message = added !== 0
                        ? `+${added}s — ${parsed.event.label}`
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
                        if (curSession.conTMI)
                            curSession.conTMI.disconnect();
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
                case "setFwProductBonuses":
                    curSession.fwProductBonuses = normalizeFwProductBonuses(jData.bonuses);
                    break;
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
                    const pname = ((typeof jData.name === "string" && jData.name) ? jData.name : pid).slice(0, 200);
                    const usd = Math.min(Math.max(Number(jData.usd) || 0, 0), 100000);
                    if (!pid){
                        ws.send(JSON.stringify({ commandResult: { ok: false, message: "Simulated purchase: missing product id." } }));
                        return;
                    }
                    const beforeSim = curSession.endTime;
                    handle(curSession, { platform: "fourthwall", kind: "money", usd, unit: "order", manual: true, label: `simulated order: ${pname} ($${usd})` });
                    const perItem = Number(curSession.fwProductBonuses && curSession.fwProductBonuses[pid]) || 0;
                    if (perItem)
                        handle(curSession, { platform: "fourthwall", kind: "time", seconds: perItem, manual: true, label: `simulated product bonus: ${pname}` });
                    // drive the /fwalert browser source too, so a thumbnail click tests the full on-stream alert
                    emitFwAlert(id, {
                        name: "SIMULATED",
                        message: `purchased ${pname}`,
                        image: typeof jData.image === "string" ? jData.image.slice(0, 2000) : "",
                    });
                    const addedSim = Math.round((curSession.endTime - beforeSim) / 1000);
                    ws.send(JSON.stringify({ commandResult: {
                        ok: addedSim !== 0,
                        message: addedSim !== 0
                            ? `+${addedSim}s — simulated purchase: ${pname} ($${usd}${perItem ? `, +${perItem}s bonus` : ""})`
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
                case "setCap":
                    curSession.shouldCap = Boolean(jData.value) || false;
                    setEndTime(curSession, curSession.endTime);
                    break;
                case "setAnon":
                    curSession.ignoreAnon = Boolean(jData.value) || false;
                    break;
            }
            emitSync(id);
        });
    });
}
