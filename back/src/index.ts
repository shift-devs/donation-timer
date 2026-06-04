import { Sequelize, DataTypes, Model, ModelStatic, Op} from "sequelize";
import axios, {AxiosResponse} from "axios";
import url from "url";
import tmi from "tmi.js";
import WebSocket from "ws";
import io from "socket.io-client";

const WSS_PORT = 3003;
const WS_FORCE_SYNC_TIME = 5 * 1000;
const WS_HB_TIME = 10 * 1000;
const CAP_TIME = 30 * 3600 * 1000;
const CHAT_CMD_MAX_TIME = 10 * 3600;
const MERCH_UPDATE_TIME = 60 * 1000;
const DB_UPDATE_TIME = 5 * 1000;
const LOG_PAGE = 50;
const WS_MSG_BURST = 40;   // per-connection message burst allowance
const WS_MSG_RATE = 20;    // sustained messages/sec before dropping (FE-loop guard)
const CLIENT_ID: string = process.env.CLIENT_ID || "";
const WH_PATH: string = process.env.WH_PATH || "";
const ALLOWED_USERS: Array<String> = ["shift", "aaronrules5", "darkrta", "the_ivo_robotnik", "yoman47", "lobomfz"]

// seconds granted per unit, per platform. floats. defaults preserve old subTime=70/dollarTime=14 behavior
const DEFAULT_RATES = {
    twitch: { sub_t1: 70, sub_t2: 140, sub_t3: 350, bits: 0.14 },
    streamlabs: { donation: 14, merch: 14 },
};

function normalizeRates(raw: any){
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

// per-platform connection config (what to watch). twitch channel defaults to the login name.
function normalizeConnections(raw: any, name: string, slToken: string){
    const c = raw || {};
    const t = c.twitch || {};
    const s = c.streamlabs || {};
    return {
        twitch: { channel: typeof t.channel === "string" && t.channel ? t.channel : (name || "") },
        streamlabs: { token: typeof s.token === "string" ? s.token : (slToken || "") },
    };
}

const USER_TABLE = {
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    accessToken: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    subTime: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 70
    },
    dollarTime: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 14
    },
    slToken: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    endTime: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0
    },
    shouldCap: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    ignoreAnon: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    rates: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    connections: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    }
}

const LOG_TABLE = {
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    action: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    oldMs: {
        type: DataTypes.BIGINT,
        allowNull: false,
    },
    newMs: {
        type: DataTypes.BIGINT,
        allowNull: false,
    },
    addedMs: {
        type: DataTypes.BIGINT,
        allowNull: false,
    }
}

interface TimerState {
    sequelize: Sequelize
    usersModel: ModelStatic<any>
    logsModel: ModelStatic<any>
    userSessions: Array<TimerUserSession>
}

interface TimerUserSession {
    userId: number
    name: string
    accessToken: string
    subTime: number
    dollarTime: number
    slToken?: string
    endTime: number
    shouldCap: boolean
    ignoreAnon: boolean
    slStatus: boolean
    twitchStatus: boolean
    rates: any
    connections: any
    merchValues: Object
    conTMI?: tmi.Client
    conSL?: SocketIOClient.Socket
}

interface TimerWebSocket extends WebSocket {
    userId: number
    isAlive: boolean
    isReady: boolean
    forceSyncInterval: NodeJS.Timeout | number
    hbInterval: NodeJS.Timeout | number
    msgTokens: number
    msgLast: number
    msgWarnAt: number
}

let gWSSync = (ts: TimerState, id: number) => {} // Global callback function is registered in main
let gWSLog = (ts: TimerState, id: number, entry: any) => {} // registered in main

function getUserSession(ts: TimerState, id: number) {
    const curIndex = getUserSessionIndexById(ts, id);
    if (curIndex == -1)
        return {userId: 0} as TimerUserSession;
    return ts.userSessions[curIndex];
}

function getUserSessionIndexById(ts: TimerState, id: number){
    const usLength = ts.userSessions.length;
    let i = 0;
    while (i < usLength){
        if (ts.userSessions[i].userId == id)
            return i;
        i++;
    }
    return -1;
}

function setEndTime(ts: TimerState, id: number, newEndTime: number){
    const curSession = getUserSession(ts, id);
    if (!Number.isFinite(newEndTime)){
        console.log(`Ignoring non-finite endTime for ${curSession.name}!`);
        return;
    }
    const nowMs = Date.now();
    const deltaTime = newEndTime - nowMs;
    if (curSession.shouldCap && deltaTime > CAP_TIME)
        newEndTime = CAP_TIME + nowMs;
    newEndTime = Math.round(newEndTime);
    console.log(`Setting ${curSession.name}'s endTime to ${newEndTime}!`);
    curSession.endTime = newEndTime;
    gWSSync(ts, id);
}

function addToEndTime(ts: TimerState, id: number, seconds: number, action: string){
    const curSession = getUserSession(ts, id);
    const oldEndTime = curSession.endTime;
    const nowMs = Date.now();
    let newEndTime = curSession.endTime;
    if (newEndTime < nowMs)
        newEndTime = nowMs;
    newEndTime += seconds * 1000;
    console.log(`Adding ${seconds} seconds to ${curSession.name}'s endTime!`);
    setEndTime(ts, id, newEndTime);
    logTimerEvent(ts, id, action, oldEndTime, curSession.endTime);
}

function logTimerEvent(ts: TimerState, id: number, action: string, oldEndTime: number, newEndTime: number){
    const curSession = getUserSession(ts, id);
    if (curSession.userId == 0)
        return;
    const nowMs = Date.now();
    const oldMs = Math.max(Math.round(oldEndTime) - nowMs, 0);
    const newMs = Math.max(Math.round(newEndTime) - nowMs, 0);
    const entry = { t: nowMs, action, oldMs, newMs, addedMs: newMs - oldMs };
    ts.logsModel.create({ userId: id, action, oldMs, newMs, addedMs: entry.addedMs }).catch((err: any)=>{
        console.log("Failed to write log:", err);
    });
    gWSLog(ts, id, entry);
}

function loginUser(ts: TimerState, inObj: Object){
    const lvObj = Object.assign({}, inObj) as TimerUserSession;
    lvObj.endTime = Number(lvObj.endTime); // bigint comes back as a string from pg
    lvObj.rates = normalizeRates(lvObj.rates);
    lvObj.connections = normalizeConnections(lvObj.connections, lvObj.name, (lvObj as any).slToken);
    lvObj.twitchStatus = false;
    lvObj.merchValues = {};
    lvObj.slStatus = false;
    const existingSession = getUserSession(ts, lvObj.userId);
    if (existingSession.userId != 0){
        console.log(`loginUser: WARNING! Already existing userId ${existingSession.userId} is logged in! Logging them out first!`);
        logoutUser(ts, existingSession.userId);
    }

    ts.userSessions.push(lvObj);
    const curSession = ts.userSessions[ts.userSessions.length - 1];
    if (curSession.connections.twitch.channel)
        curSession.conTMI = tmiLogin(ts, curSession.userId);
    if (curSession.connections.streamlabs.token)
        curSession.conSL = slLogin(ts, curSession.userId);
    console.log(`${curSession.name} has logged in!`);
}

function logoutUser(ts: TimerState, id: number){
    const curIndex = getUserSessionIndexById(ts, id);
    const curSession = ts.userSessions[curIndex];
    if (curIndex == -1){
        console.log(`logoutUser: WARNING! Could not log out the user with userId ${id}. They are not registered as a logged in user!`);
        return;
    }
    if (curSession.conSL)
        curSession.conSL.disconnect();
    if (curSession.conTMI)
        curSession.conTMI.disconnect();
    ts.userSessions.splice(curIndex,1);
    console.log(`${curSession.name} has logged out!`);
}

function tmiLogin(ts: TimerState, id: number){
    const curSession = getUserSession(ts, id);

    const client = new tmi.Client({
        connection: {
            reconnect: true,
            reconnectInterval: 5000,
        },
        channels: [curSession.connections.twitch.channel]
    });

    client.connect().catch((err)=>{
        console.log(`TMI - Unable to connect: ${curSession.name} and ${curSession.accessToken}`);
    });

    function l(event) {
        return function(){
            console.log(event, arguments);
        }
    }

    client.on("connecting", l(`Connecting to ${curSession.connections.twitch.channel}'s Twitch Chat...`));
    client.on("connected", () => {
        console.log(`Connected to ${curSession.connections.twitch.channel}'s Twitch Chat!`);
        curSession.twitchStatus = true;
        gWSSync(ts, id);
    });
    client.on("disconnected", () => {
        console.log(`Disconnected from ${curSession.connections.twitch.channel}'s Twitch Chat!`);
        curSession.twitchStatus = false;
        gWSSync(ts, id);
    });

    client.on("message", (channel, tags, message, self) => {
        let filterMessage = message.toLowerCase().replaceAll(/[^ -~]/g,"").trim();
        var mSplit = filterMessage.split(" ");
        console.log(`(${curSession.name}) TWITCH MESSAGE - ${tags.username}: ${filterMessage}`);
        if (tags.username) {
            if (tags.mod || tags.username.toLowerCase() == curSession.connections.twitch.channel.toLowerCase()){
                let timeToAdd = 0;
                switch (mSplit[0]) {
                    case "!nop":
                        console.log("No operation!");
                        break;
                    case "!addsub":
                        var subs = 1, tier = 1, ptr = 1;
                        while (ptr < mSplit.length){
                            if (mSplit[ptr].charAt(0) == "t"){
                                tier = parseInt(mSplit[ptr].slice(1),10);
                                if (!(tier >= 1 && tier <= 3)){
                                    console.log("Invalid Tier!");
                                    return;
                                }
                                ptr++;
                                continue;
                            }
                            if (mSplit[ptr] == ""){
                                ptr++;
                                continue;
                            }
                            subs = parseInt(mSplit[ptr],10);
                            if (!Number.isFinite(subs)){
                                console.log("Invalid Number of Subs!");
                                return;
                            }
                            ptr++;
                        }
                        timeToAdd = subs * subRate(tier);
                        break;
                    case "!addmoney":
                        let dollars = 0;
                        if (mSplit.length < 2){
                            console.log("Not Enough Parameters!");
                            return;
                        }
                        let dollarString = mSplit[1];
                        dollarString = dollarString.replaceAll("$","");
                        dollars = parseFloat(dollarString);
                        if (!Number.isFinite(dollars)){
                            console.log("Invalid Money Amount!");
                            return;
                        }
                        timeToAdd = dollars * curSession.rates.streamlabs.donation;
                        break;
                    case "!addtime":
                        let seconds = 0;
                        if (mSplit.length < 2){
                            console.log("Not Enough Parameters!");
                            return;
                        }
                        seconds = parseInt(mSplit[1],10);
                        if (!Number.isFinite(seconds)){
                            console.log("Invalid Time Amount!");
                            return;
                        }
                        timeToAdd = seconds;
                        break;
                }
                if (timeToAdd == 0)
                    return;
                if (Math.abs(timeToAdd) > CHAT_CMD_MAX_TIME){
                    console.log(`Time change would be greater than ${CHAT_CMD_MAX_TIME} seconds!`);
                    return;
                }
                addToEndTime(ts, id, timeToAdd, `Chat: ${filterMessage} (${tags.username})`);
            }
        }
    });

    const isAnon = (uname: any) => {
        const upUname = uname.toUpperCase();
        return upUname == "ANANONYMOUSGIFTER";
    }

    const calcTier = (ustate: any) => {
        const plan = ustate["msg-param-sub-plan"] || "1000";
        return plan == "Prime" ? 1 : parseInt(plan,10) / 1000;
    }

    const subRate = (tier: number) => curSession.rates.twitch["sub_t" + tier] || 0;

    client.on("submysterygift",(channel, username, numbOfSubs, methods, userstate) => {
        if (curSession.ignoreAnon && isAnon(username))
            return;
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - ${username} is gifting ${numbOfSubs} tier ${tier} subs!`);
        addToEndTime(ts, id, numbOfSubs * subRate(tier), `${numbOfSubs}x Tier ${tier} gift sub from ${username}`);
    });

    client.on("subgift",(channel, username, streakMonths, recipient, methods, userstate) => {
        if (userstate["msg-param-community-gift-id"]) // Mass subgifts are handled in submysterygift
            return;
        if (curSession.ignoreAnon && isAnon(username))
            return;
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - subgift from ${username} to ${recipient} of tier ${tier}!`);
        addToEndTime(ts, id, subRate(tier), `Tier ${tier} gift sub from ${username} -> ${recipient}`);
    });

    client.on("anongiftpaidupgrade", (_channel, _username, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - anongiftpaidupgrade from ${_username} to tier ${tier}!`);
        addToEndTime(ts, id, subRate(tier), `Gift sub upgrade (anon) Tier ${tier}`);
    });

    client.on("giftpaidupgrade", (_channel, _username, sender, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - giftpaidupgrade from ${_username} to tier ${tier}!`);
        addToEndTime(ts, id, subRate(tier), `Gift sub upgrade from ${_username} Tier ${tier}`);
    });

    client.on("resub",(_channel, _username, _months, _message, userstate, _methods) => {
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - ${_username} has resubscribed with tier ${tier}!`);
        addToEndTime(ts, id, subRate(tier), `Tier ${tier} resub (${_username})`);
    });

    client.on("subscription",(_channel, _username, _method, _message, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - ${_username} has subscribed with tier ${tier}!`);
        addToEndTime(ts, id, subRate(tier), `Tier ${tier} sub (${_username})`);
    });

    client.on("cheer", (_channel, userstate, _message) => {
        var bits: string = userstate["bits"] || "0";
        console.log(`(${curSession.name}) TMI - cheer of ${bits} bits from ${userstate["display-name"]}`);
        addToEndTime(ts, id, parseInt(bits,10) * curSession.rates.twitch.bits, `Cheer ${bits} bits (${userstate["display-name"]})`);
    });

    return client;
}

function slLogin(ts: TimerState, id: number){
    const curSession = getUserSession(ts, id);
    let merchInterval: NodeJS.Timeout | number = 0;
    const socket = io(`https://sockets.streamlabs.com?token=${curSession.connections.streamlabs.token}`, {
        transports: ["websocket"],
    });

    socket.on("connect", () => {
        console.log(`Connected to ${curSession.name}'s Streamlabs!`);
        curSession.slStatus = true;
        gWSSync(ts, id);
        slInstallMerch(ts, id);
        if (merchInterval == 0)
            merchInterval = setInterval(slInstallMerch.bind(null, ts, id), MERCH_UPDATE_TIME);
    });

    socket.on("disconnect", () => {
        console.log(`Disconnected from ${curSession.name}'s Streamlabs!`);
        curSession.slStatus = false;
        gWSSync(ts, id);
        if (merchInterval != 0){
            clearInterval(merchInterval);
            merchInterval = 0;
        }
    });

    socket.on("event", (e: any) => {
        console.log(`(${curSession.name}) Streamlabs Event: ${JSON.stringify(e)}`);
        switch (e.type){
            case "donation":
                console.log(`(${curSession.name}) STREAMLABS - Adding $${e.message[0].amount} to timer!`);
                addToEndTime(ts, id, curSession.rates.streamlabs.donation * e.message[0].amount, `Donation $${e.message[0].amount} from ${e.message[0].from}`);
                break;
            case "merch":
                console.log(`Received merch purchase! Product name: "${e.message[0].product}"`);
                const merchHookData = `From: \`${e.message[0].from}\`\nProduct: \`${e.message[0].product}\`\nMessage: \`${e.message[0].message}\``;
                let merchValue = curSession.merchValues[e.message[0].product];
                if (!merchValue){
                    console.log(`WARNING! STREAMLABS PRODUCT "${e.message[0].product}" IS NOT IN MERCHVALUES!! Trying a fuzzier search...!`);
                    const mvEntries = Object.entries(curSession.merchValues);
                    const lowercaseProduct = e.message[0].product.toLowerCase();
                    for (var i = 0; i < mvEntries.length; i++){
                        if (mvEntries[i][0].toLowerCase().includes(lowercaseProduct)){
                            console.log(`Found "${mvEntries[i][0]}" as a close enough match!`);
                            merchValue = mvEntries[i][1];
                            break;
                        }
                    }
                }
                if (!merchValue){
                    console.log(`Definitely couldn't find a valid matching product!!! Tell Aaron! :^(`);
                    whSend(`**MERCH FAILURE!**\n${merchHookData}`);
                    return;
                }
                console.log(`(${curSession.name}) - STREAMLABS - Adding $${merchValue} to timer!`);
                whSend(`**MERCH SUCCESS!**\n${merchHookData}`);
                addToEndTime(ts, id, curSession.rates.streamlabs.merch * merchValue, `Merch: ${e.message[0].product} ($${merchValue})`);
                break;
        }
    });

    return socket;
}

function whSend(msg: string){
    const aSnowflake = "305454678316154900";
    if (WH_PATH == ""){
        console.log("WH_PATH is not valid! Not sending hook!");
        return;
    }
    axios.post(`https://discord.com/api/webhooks/${WH_PATH}`,
    JSON.stringify(
        {
            "content": `<@${aSnowflake}> ${msg}`,
            "allowed_mentions": {
                "users": [aSnowflake]
            }
        }
    ),{headers: {
        "Content-Type": "application/json"
    }}).then(()=>{
        console.log("Sent a webhook!");
    }).catch((err)=>{
        console.log("Failed to send a webhook!");
        console.log(err);
    });
}

function slInstallMerch(ts: TimerState, id: number){
    const curSession = getUserSession(ts, id);
    const newMerchValues = {};
    console.log(`Getting New Streamlabs Merch For ${curSession.name}...`);
    axios
    .get(`https://streamlabs.com/api/v6/user/${curSession.name}`, {
    })
    .then((httpRes) => {
        if (Math.trunc(httpRes.status / 100)!=2)
            return;
        axios
        .get(`https://streamlabs.com/api/v6/${httpRes.data.token}/merchandise/products`, {
        })
        .then(httpRes2 => {
            if (Math.trunc(httpRes2.status / 100)!=2)
                return;
            let merchProducts = httpRes2.data.products;
            merchProducts.map((x: any)=>{
                newMerchValues[x.name] = x.variants[0].price / 100;
            });
            curSession.merchValues = Object.assign({}, newMerchValues);
            console.log(`Done Getting ${curSession.name}'s Streamlabs Merch!`);
        }).catch(()=>{
            console.log(`Could not get new streamlabs merch at this time! Try again later!`);
        });
    }).catch(()=>{
        console.log(`Could not get new streamlabs merch at this time! Try again later!`);
    });
}

async function dbCreate(ts: TimerState, inObj: Object){
    const lvObj = Object.assign({}, inObj) as TimerUserSession;
    await ts.usersModel.create({
        userId: lvObj.userId,
        name: lvObj.name,
        accessToken: lvObj.accessToken,
        subTime: lvObj.subTime,
        dollarTime: lvObj.dollarTime,
        slToken: lvObj.slToken,
        endTime: lvObj.endTime,
        shouldCap: lvObj.shouldCap,
        ignoreAnon: lvObj.ignoreAnon,
        rates: lvObj.rates,
        connections: lvObj.connections
    });
}

function dbUpdate(ts: TimerState){
    const usLength = ts.userSessions.length;
    let i = 0;
    while (i < usLength){
        const curSession = ts.userSessions[i];
        ts.usersModel.update(
            {
                name: curSession.name,
                accessToken: curSession.accessToken,
                subTime: curSession.subTime,
                dollarTime: curSession.dollarTime,
                slToken: curSession.slToken,
                endTime: Math.round(curSession.endTime),
                shouldCap: curSession.shouldCap,
                ignoreAnon: curSession.ignoreAnon,
                rates: curSession.rates,
                connections: curSession.connections,
            },
            {
                where: {
                    userId: curSession.userId,
                },
            }
        ).catch((err: any)=>{
            console.log("Failed to update user in DB:", err);
        });
        i++;
    }
}

function wsCloseError(ws: TimerWebSocket, reason: string){
    ws.send(
        JSON.stringify({
            success: false,
            error: reason,
        })
    );
    ws.close();
}

async function wsLogin(ts: TimerState, ws: TimerWebSocket, accessToken: string){
    ws.userId = 0;
    ws.isAlive = true;
    ws.msgTokens = WS_MSG_BURST;
    ws.msgLast = Date.now();
    ws.msgWarnAt = 0;
    ws.forceSyncInterval = setInterval(wsSync.bind(null,ts,ws),WS_FORCE_SYNC_TIME);
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

    const res = await ts.usersModel.findByPk(ws.userId);

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
        await dbCreate(ts, newUser);
        loginUser(ts, newUser);
        return;
    }

    const curSession = getUserSession(ts, ws.userId);

    if (curSession.userId == 0){
        wsCloseError(ws, `User ID ${ws.userId} is not logged in but is present in the database!`);
        return;
    }

    if (ws.userId == 1 && accessToken != curSession.name){ // Changing unauthorized user's name
        console.log(`Changing userId 1 from ${curSession.name} to ${accessToken}`);
        let newSession = Object.assign({},curSession);
        newSession.name = accessToken;
        newSession.accessToken = accessToken;
        logoutUser(ts, 1);
        loginUser(ts, newSession);
    }

    return;
}

function wsSync(ts: TimerState, ws: TimerWebSocket) {
    if (!ws.isReady)
        return;
    if (ws.readyState !== WebSocket.OPEN)
        return;
    const id = ws.userId;
    const curSession = getUserSession(ts, id);
    ws.send(
        JSON.stringify({
            success: true,
            endTime: curSession.endTime,
            slStatus: curSession.slStatus,
            twitchStatus: curSession.twitchStatus,
            cap: curSession.shouldCap,
            anon: curSession.ignoreAnon,
            rates: curSession.rates,
            connections: {
                twitch: { channel: curSession.connections.twitch.channel },
                streamlabs: { hasToken: !!curSession.connections.streamlabs.token }
            },
            merchValues: curSession.merchValues
        })
    );
}

function sendLogPage(ts: TimerState, ws: TimerWebSocket, before: any) {
    if (!ws.isReady)
        return;
    if (ws.readyState !== WebSocket.OPEN)
        return;
    const where: any = { userId: ws.userId };
    if (Number.isFinite(before))
        where.id = { [Op.lt]: before };
    ts.logsModel.findAll({ where, order: [["id", "DESC"]], limit: LOG_PAGE }).then((rows: any[]) => {
        if (ws.readyState !== WebSocket.OPEN)
            return;
        const page = rows.reverse().map((r: any) => ({
            id: r.dataValues.id,
            t: new Date(r.dataValues.createdAt).getTime(),
            action: r.dataValues.action,
            oldMs: Number(r.dataValues.oldMs),
            newMs: Number(r.dataValues.newMs),
            addedMs: Number(r.dataValues.addedMs),
        }));
        ws.send(JSON.stringify({ logPage: page, hasMore: rows.length === LOG_PAGE, before: Number.isFinite(before) ? before : null }));
    }).catch((err: any) => {
        console.log("Failed to load log page:", err);
    });
}

async function main(){
    process.on("unhandledRejection", (reason) => {
        console.log("Unhandled rejection:", reason);
    });
    process.on("uncaughtException", (err) => {
        console.log("Uncaught exception:", err);
    });
    console.log(`Running in ${CLIENT_ID==""?"Una":"A"}uthorized Mode!`);
    whSend("**TIMER STARTED**");
    const ts = {} as TimerState;
    ts.userSessions = [];

    ts.sequelize = new Sequelize(
        process.env.DB_SCHEMA || "postgres",
        process.env.DB_USER || "postgres",
        process.env.DB_PASSWORD || "",
        {
            host: process.env.DB_HOST || "postgres",
            port: parseInt(process.env.DB_PORT || "5432", 10),
            dialect: "postgres",
            dialectOptions: {
                ssl: process.env.DB_SSL == "true",
                rejectUnauthorized: false,
            },
            logging: false,
        }
    );

    ts.usersModel = ts.sequelize.define("User", USER_TABLE);
    ts.logsModel = ts.sequelize.define("Log", LOG_TABLE, { updatedAt: false });

    try {
        await ts.sequelize.authenticate();
        await ts.usersModel.sync();
        console.log("Connection has been established successfully to the database!");
    } catch (error) {
        console.error("Unable to connect to the database:", error);
        return;
    }

    const users: Model[] = await ts.usersModel.findAll();

    users.forEach(async (user) => {
        if ((CLIENT_ID == "" && user.dataValues.userId != 1) || (CLIENT_ID != "" && user.dataValues.userId == 1)){
            console.log(`Removing bad user with userId ${user.dataValues.userId} from the DB!`)
            await user.destroy();
            return;
        }
        loginUser(ts, user.dataValues);
    });

    const wss = new WebSocket.Server({port: WSS_PORT});

    gWSSync = function(ts: TimerState, id: number){
        const numOfClients = wss.clients.size;
        const clientsArr = Array.from(wss.clients);
        let i = 0;
        while (i < numOfClients){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id == ws.userId){
                wsSync(ts, ws);
            }
            i++;
        }
    }

    gWSLog = function(ts: TimerState, id: number, entry: any){
        const clientsArr = Array.from(wss.clients);
        for (let i = 0; i < clientsArr.length; i++){
            const ws = clientsArr[i] as TimerWebSocket;
            if (id == ws.userId && ws.readyState === WebSocket.OPEN){
                ws.send(JSON.stringify({ logEntry: entry }));
            }
        }
    }

    wss.on("connection", (ws: TimerWebSocket, req: any) => {
        console.log("A client has connected to the WSS backend!");
        ws.isReady = false;

        const urlParams = url.parse(req.url, true).query;
        const accessToken = urlParams.token as string;

        wsLogin(ts, ws, accessToken).then(()=>{
            ws.isReady = true;
            gWSSync(ts, ws.userId);
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
            const curSession = getUserSession(ts, id);

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
                    sendLogPage(ts, ws, jData.before);
                    return;
                case "setConnection": {
                    const platform = jData.platform;
                    const config = jData.config || {};
                    if (platform === "twitch") {
                        const channel = (typeof config.channel === "string" ? config.channel : "").trim().toLowerCase();
                        curSession.connections.twitch.channel = channel;
                        if (curSession.conTMI)
                            curSession.conTMI.disconnect();
                        curSession.twitchStatus = false;
                        curSession.conTMI = channel ? tmiLogin(ts, curSession.userId) : undefined;
                    } else if (platform === "streamlabs") {
                        if (typeof config.token !== "string" || config.token.length >= 1000)
                            break;
                        curSession.connections.streamlabs.token = config.token;
                        if (curSession.conSL)
                            curSession.conSL.disconnect();
                        curSession.slStatus = false;
                        curSession.conSL = config.token ? slLogin(ts, curSession.userId) : undefined;
                    }
                    break;
                }
                case "setRates":
                    curSession.rates = normalizeRates(jData.rates);
                    break;
                case "setEndTime": {
                    const oldET = curSession.endTime;
                    setEndTime(ts, ws.userId, Math.trunc(parseInt(jData.value) || 0));
                    logTimerEvent(ts, ws.userId, "Manual change", oldET, curSession.endTime);
                    break;
                }
                case "setCap":
                    curSession.shouldCap = Boolean(jData.value) || false;
                    setEndTime(ts, ws.userId, curSession.endTime);
                    break;
                case "setAnon":
                    curSession.ignoreAnon = Boolean(jData.value) || false;
                    break;
            }
            gWSSync(ts, id);
        });
    });

    setInterval(dbUpdate.bind(null, ts), DB_UPDATE_TIME);
}

main();