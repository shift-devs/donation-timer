import { Sequelize, DataTypes, Model, ModelStatic} from "sequelize";
import axios, {AxiosResponse} from "axios";
import url from "url";
import tmi from "tmi.js";
import WebSocket from "ws";
import io from "socket.io-client";

const WSS_PORT = 3003;
const WS_FORCE_SYNC_TIME = 5 * 1000;
const WS_HB_TIME = 10 * 1000;
const CAP_TIME = 30 * 3600;
const CHAT_CMD_MAX_TIME = 10 * 3600;
const MERCH_UPDATE_TIME = 60 * 1000;
const DB_UPDATE_TIME = 5 * 1000;
const CLIENT_ID: string = process.env.CLIENT_ID || "";

const ALLOWED_USERS: Array<String> = ["shift", "aaronrules5", "darkrta", "the_ivo_robotnik", "yoman47", "lobomfz"]

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
        type: DataTypes.INTEGER,
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
    }
}

interface TimerState {
    sequelize: Sequelize
    usersModel: ModelStatic<any>
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
}

let gWSSync = (ts: TimerState, id: number) => {} // Global callback function is registered in main

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
    const nowSeconds = Math.trunc(Date.now() / 1000);
    const deltaTime = newEndTime - nowSeconds;
    if (curSession.shouldCap && deltaTime > CAP_TIME)
        newEndTime = CAP_TIME + nowSeconds;
    newEndTime = Math.round(newEndTime);
    console.log(`Setting ${curSession.name}'s endTime to ${newEndTime}!`);
    curSession.endTime = newEndTime;
    gWSSync(ts, id);
}

function addToEndTime(ts: TimerState, id: number, seconds: number){
    const curSession = getUserSession(ts, id);
    const nowSeconds = Math.trunc(Date.now() / 1000);
    let newEndTime = curSession.endTime;
    if (newEndTime < nowSeconds)
        newEndTime = nowSeconds;
    newEndTime += seconds;
    console.log(`Adding ${seconds} seconds to ${curSession.name}'s endTime!`);
    setEndTime(ts, id, newEndTime);
}

function loginUser(ts: TimerState, inObj: Object){
    const lvObj = Object.assign({}, inObj) as TimerUserSession;
    lvObj.merchValues = {};
    lvObj.slStatus = false;
    const existingSession = getUserSession(ts, lvObj.userId);
    if (existingSession.userId != 0){
        console.log(`loginUser: WARNING! Already existing userId ${existingSession.userId} is logged in! Logging them out first!`);
        logoutUser(ts, existingSession.userId);
    }

    ts.userSessions.push(lvObj);
    const curSession = ts.userSessions[ts.userSessions.length - 1];
    curSession.conTMI = tmiLogin(ts, curSession.userId);
    if (curSession.slToken)
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
        channels: [curSession.name]
    });

    client.connect().catch((err)=>{
        console.log(`TMI - Unable to connect: ${curSession.name} and ${curSession.accessToken}`);
    });

    function l(event) {
        return function(){
            console.log(event, arguments);
        }
    }

    client.on("connecting", l(`Connecting to ${curSession.name}'s Twitch Chat...`));
    client.on("connected", l(`Connected to ${curSession.name}'s Twitch Chat!`));
    client.on("disconnected", l(`Disconnected from ${curSession.name}'s Twitch Chat!`));

    client.on("message", (channel, tags, message, self) => {
        let filterMessage = message.toLowerCase().replaceAll(/[^ -~]/g,"").trim();
        var mSplit = filterMessage.split(" ");
        console.log(`(${curSession.name}) TWITCH MESSAGE - ${tags.username}: ${filterMessage}`);
        if (tags.username) {
            if (tags.mod || tags.username.toLowerCase() == curSession.name){
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
                                tier = tier == 3 ? 5 : tier;
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
                        timeToAdd = tier * curSession.subTime * subs;
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
                        timeToAdd = dollars * curSession.dollarTime;
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
                addToEndTime(ts, id, timeToAdd);
            }
        }
    });

    const isAnon = (uname: any) => {
        const upUname = uname.toUpperCase();
        return upUname == "ANANONYMOUSGIFTER";
    }

    const calcTier = (ustate: any) => {
        const plan = ustate["msg-param-sub-plan"] || "1000";
        const tempTier = plan == "Prime" ? 1 : parseInt(plan,10) / 1000;
        return tempTier == 3 ? 5 : tempTier;
    }

    client.on("submysterygift",(channel, username, numbOfSubs, methods, userstate) => {
        if (curSession.ignoreAnon && isAnon(username))
            return;
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - ${username} is gifting ${numbOfSubs} tier ${tier} subs!`);
        addToEndTime(ts, id, numbOfSubs * tier * curSession.subTime);
    });

    client.on("subgift",(channel, username, streakMonths, recipient, methods, userstate) => {
        if (userstate["msg-param-community-gift-id"]) // Mass subgifts are handled in submysterygift
            return;
        if (curSession.ignoreAnon && isAnon(username))
            return;
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - subgift from ${username} to ${recipient} of tier ${tier}!`);
        addToEndTime(ts, id, tier * curSession.subTime);
    });

    client.on("anongiftpaidupgrade", (_channel, _username, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - anongiftpaidupgrade from ${_username} to tier ${tier}!`);
        addToEndTime(ts, id, tier * curSession.subTime);
    });

    client.on("giftpaidupgrade", (_channel, _username, sender, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - giftpaidupgrade from ${_username} to tier ${tier}!`);
        addToEndTime(ts, id, tier * curSession.subTime);
    });

    client.on("resub",(_channel, _username, _months, _message, userstate, _methods) => {
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - ${_username} has resubscribed with tier ${tier}!`);
        addToEndTime(ts, id, tier * curSession.subTime);
    });

    client.on("subscription",(_channel, _username, _method, _message, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${curSession.name}) TMI - ${_username} has subscribed with tier ${tier}!`);
        addToEndTime(ts, id, tier * curSession.subTime);
    });

    client.on("cheer", (_channel, userstate, _message) => {
        var bits: string = userstate["bits"] || "0";
        console.log(`(${curSession.name}) TMI - cheer of ${bits} bits from ${userstate["display-name"]}`);
        addToEndTime(ts, id, (parseInt(bits,10)/100) * curSession.dollarTime);
    });

    return client;
}

function slLogin(ts: TimerState, id: number){
    const curSession = getUserSession(ts, id);
    let merchInterval: NodeJS.Timeout | number = 0;
    const socket = io(`https://sockets.streamlabs.com?token=${curSession.slToken}`, {
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
                addToEndTime(ts, id, curSession.dollarTime * e.message[0].amount);
                break;
            case "merch":
                if (!curSession.merchValues[e.message[0].product]){
                    console.log(`WARNING! STREAMLABS PRODUCT "${e.message[0].product}" IS NOT IN MERCHVALUES!!`);
                    return;
                }
                console.log(`(${curSession.name}) - STREAMLABS - Adding $${curSession.merchValues[e.message[0].product]} to timer!`);
                addToEndTime(ts, id, curSession.dollarTime * curSession.merchValues[e.message[0].product]);
                break;
        }
    });

    return socket;
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
        });
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
        ignoreAnon: lvObj.ignoreAnon
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
                endTime: Math.trunc(curSession.endTime),
                shouldCap: curSession.shouldCap,
                ignoreAnon: curSession.ignoreAnon,
            },
            {
                where: {
                    userId: curSession.userId,
                },
            }
        );
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
            shouldCap: USER_TABLE.endTime.defaultValue,
            ignoreAnon: USER_TABLE.endTime.defaultValue
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
    const id = ws.userId;
    const curSession = getUserSession(ts, id);
    ws.send(
        JSON.stringify({
            success: true,
            endTime: curSession.endTime,
            subTime: curSession.subTime,
            dollarTime: curSession.dollarTime,
            slStatus: curSession.slStatus,
            cap: curSession.shouldCap,
            anon: curSession.ignoreAnon,
            merchValues: curSession.merchValues
        })
    );
}

function wsUpdateSetting(ts: TimerState, ws: TimerWebSocket, data: any) {
    if (!ws.isReady)
        return;
    const id = ws.userId;
    const curSession = getUserSession(ts, id);
    switch (data.setting) {
        case "subTime":
            if (parseInt(data.value)) curSession.subTime = parseInt(data.value);
            break;
        case "dollarTime":
            if (parseInt(data.value)) curSession.dollarTime = parseInt(data.value);
            break;
    }
}

async function main(){
    console.log(`Running in ${CLIENT_ID==""?"Una":"A"}uthorized Mode!`);

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

    try {
        await ts.sequelize.authenticate();
        await ts.usersModel.sync();
        console.log("Connected has been established successfully to the database!");
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

    wss.on("connection", (ws: TimerWebSocket, req: any) => {
        console.log("A client has connected to the WSS backend!");
        ws.isReady = false;

        const urlParams = url.parse(req.url, true).query;
        const accessToken = urlParams.token as string;

        wsLogin(ts, ws, accessToken).then(()=>{
            ws.isReady = true;
            gWSSync(ts, ws.userId);
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
                case "connectStreamlabs":
                    if (jData.slToken.length >= 1000)
                        break;
                    curSession.slToken = jData.slToken;
                    if (curSession.conSL)
                        curSession.conSL.disconnect();
                    curSession.conSL = slLogin(ts, curSession.userId);
                    break;
                case "setSetting":
                    wsUpdateSetting(ts, ws, jData);
                    break;
                case "setEndTime":
                    setEndTime(ts, ws.userId, Math.trunc(parseInt(jData.value) || 0));
                    break;
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