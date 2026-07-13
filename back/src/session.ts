import { TimerUserSession, TimerEvent } from "./types";
import { emitSync, reportError } from "./bus";
import { normalizeRates } from "./rates";
import { normalizeConnections } from "./connections";
import { normalizeTimerEvents } from "./timerEvents";
import { normalizeWidgetSettings } from "./widgetSettings";
import { handle } from "./events";
import { connectTwitch } from "./platforms/twitch";
import { connectStreamlabs } from "./platforms/streamlabs";
import { connectFourthwall, normalizeFwProductBonuses, normalizeFwProductSounds, normalizeFwActivity } from "./platforms/fourthwall";

export const sessions: TimerUserSession[] = [];

export function getUserSessionIndexById(id: number){
    for (let i = 0; i < sessions.length; i++){
        if (sessions[i].userId == id)
            return i;
    }
    return -1;
}

export function getUserSession(id: number){
    const curIndex = getUserSessionIndexById(id);
    if (curIndex == -1)
        return {userId: 0} as TimerUserSession;
    return sessions[curIndex];
}

// every platform adapter gets the same emit: route its events through the central handler for this session
function emitFor(session: TimerUserSession){
    return (e: TimerEvent) => {
        // only organic platform traffic counts as proof the integration is live — typed commands carry manual:true
        // and (for the terminal) never reach this emit at all, so they can't fake a "last event" freshness signal.
        if (!e.manual){
            if (!session.lastEventAt)
                session.lastEventAt = {};
            session.lastEventAt[e.platform] = Date.now();
            emitSync(session.userId); // push the freshness/relay status promptly (e.g. youtube waiting -> live)
        }
        handle(session, e);
    };
}

export function connectTwitchFor(session: TimerUserSession){
    return connectTwitch(session, emitFor(session));
}

export function connectStreamlabsFor(session: TimerUserSession){
    return connectStreamlabs(session, emitFor(session));
}

export function connectFourthwallFor(session: TimerUserSession){
    return connectFourthwall(session, emitFor(session));
}

export function loginUser(inObj: Object){
    const lvObj = Object.assign({}, inObj) as TimerUserSession;
    lvObj.endTime = Number(lvObj.endTime); // bigint comes back as a string from pg
    lvObj.rates = normalizeRates(lvObj.rates);
    lvObj.connections = normalizeConnections(lvObj.connections, lvObj.name, (lvObj as any).slToken);
    lvObj.timerEvents = normalizeTimerEvents(lvObj.timerEvents);
    lvObj.fwProductBonuses = normalizeFwProductBonuses(lvObj.fwProductBonuses);
    lvObj.fwProductSounds = normalizeFwProductSounds(lvObj.fwProductSounds);
    lvObj.widgetSettings = normalizeWidgetSettings(lvObj.widgetSettings);
    lvObj.fwActivity = normalizeFwActivity(lvObj.fwActivity);
    lvObj.twitchStatus = false;
    lvObj.twitchError = "";
    lvObj.merchValues = {};
    lvObj.slStatus = false;
    lvObj.slError = "";
    lvObj.fourthwallStatus = false;
    lvObj.fourthwallError = "";
    lvObj.fourthwallLastOkAt = 0;
    lvObj.lastEventAt = {};
    const existingSession = getUserSession(lvObj.userId);
    if (existingSession.userId != 0){
        console.log(`loginUser: WARNING! Already existing userId ${existingSession.userId} is logged in! Logging them out first!`);
        logoutUser(existingSession.userId);
    }

    sessions.push(lvObj);
    const curSession = sessions[sessions.length - 1];
    // one platform failing to spin up must not abort the login or the other platforms
    try {
        if (curSession.connections.twitch.channel)
            curSession.conTMI = connectTwitchFor(curSession);
    } catch (err) {
        reportError(curSession.userId, `connecting Twitch for ${curSession.name}`, err);
    }
    try {
        if (curSession.connections.streamlabs.token)
            curSession.conSL = connectStreamlabsFor(curSession);
    } catch (err) {
        reportError(curSession.userId, `connecting Streamlabs for ${curSession.name}`, err);
    }
    try {
        if (curSession.connections.fourthwall.username && curSession.connections.fourthwall.password)
            curSession.conFW = connectFourthwallFor(curSession);
    } catch (err) {
        reportError(curSession.userId, `connecting Fourthwall for ${curSession.name}`, err);
    }
    console.log(`${curSession.name} has logged in!`);
}

export function logoutUser(id: number){
    const curIndex = getUserSessionIndexById(id);
    const curSession = sessions[curIndex];
    if (curIndex == -1){
        console.log(`logoutUser: WARNING! Could not log out the user with userId ${id}. They are not registered as a logged in user!`);
        return;
    }
    // mark detached so a late platform event (fired before the clients fully close) is dropped by the handler.
    // teardown is best-effort: one connector failing to close must not keep the session (or the others) alive.
    curSession.loggedOut = true;
    try {
        if (curSession.conSL)
            curSession.conSL.disconnect();
    } catch (err) {
        console.log("Streamlabs disconnect failed:", err);
    }
    try {
        if (curSession.conTMI) // rejects if the client never connected — that's fine, just log it
            curSession.conTMI.disconnect().catch((err: any)=>console.log("TMI disconnect failed:", err && err.message));
    } catch (err) {
        console.log("TMI disconnect failed:", err);
    }
    try {
        if (curSession.conFW)
            curSession.conFW.disconnect();
    } catch (err) {
        console.log("Fourthwall disconnect failed:", err);
    }
    sessions.splice(curIndex,1);
    console.log(`${curSession.name} has logged out!`);
}
