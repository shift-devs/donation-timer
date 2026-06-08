import { TimerUserSession, TimerEvent } from "./types";
import { emitSync } from "./bus";
import { normalizeRates } from "./rates";
import { normalizeConnections } from "./connections";
import { normalizeTimerEvents } from "./timerEvents";
import { handle } from "./events";
import { connectTwitch } from "./platforms/twitch";
import { connectStreamlabs } from "./platforms/streamlabs";
import { connectFourthwall } from "./platforms/fourthwall";

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
    if (curSession.connections.twitch.channel)
        curSession.conTMI = connectTwitchFor(curSession);
    if (curSession.connections.streamlabs.token)
        curSession.conSL = connectStreamlabsFor(curSession);
    if (curSession.connections.fourthwall.username && curSession.connections.fourthwall.password)
        curSession.conFW = connectFourthwallFor(curSession);
    console.log(`${curSession.name} has logged in!`);
}

export function logoutUser(id: number){
    const curIndex = getUserSessionIndexById(id);
    const curSession = sessions[curIndex];
    if (curIndex == -1){
        console.log(`logoutUser: WARNING! Could not log out the user with userId ${id}. They are not registered as a logged in user!`);
        return;
    }
    // mark detached so a late platform event (fired before the clients fully close) is dropped by the handler
    curSession.loggedOut = true;
    if (curSession.conSL)
        curSession.conSL.disconnect();
    if (curSession.conTMI)
        curSession.conTMI.disconnect();
    if (curSession.conFW)
        curSession.conFW.disconnect();
    sessions.splice(curIndex,1);
    console.log(`${curSession.name} has logged out!`);
}
