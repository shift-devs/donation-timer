import { TimerUserSession } from "./types";
import { CAP_TIME } from "./config";
import { emitSync } from "./bus";
import { logTimerEvent } from "./log";

export function setEndTime(session: TimerUserSession, newEndTime: number){
    if (!Number.isFinite(newEndTime)){
        console.log(`Ignoring non-finite endTime for ${session.name}!`);
        return;
    }
    const nowMs = Date.now();
    const deltaTime = newEndTime - nowMs;
    if (session.shouldCap && deltaTime > CAP_TIME)
        newEndTime = CAP_TIME + nowMs;
    newEndTime = Math.round(newEndTime);
    console.log(`Setting ${session.name}'s endTime to ${newEndTime}!`);
    session.endTime = newEndTime;
    emitSync(session.userId);
}

export function addToEndTime(session: TimerUserSession, seconds: number, action: string){
    const oldEndTime = session.endTime;
    const nowMs = Date.now();
    let newEndTime = session.endTime;
    if (newEndTime < nowMs)
        newEndTime = nowMs;
    newEndTime += seconds * 1000;
    console.log(`Adding ${seconds} seconds to ${session.name}'s endTime!`);
    setEndTime(session, newEndTime);
    logTimerEvent(session, action, oldEndTime, session.endTime);
}
