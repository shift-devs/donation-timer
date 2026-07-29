import { TimerUserSession } from "./types";
import { emitSync, emitTerminal } from "./bus";
import { logTimerEvent } from "./log";

export function setEndTime(session: TimerUserSession, newEndTime: number){
    if (!Number.isFinite(newEndTime)){
        console.log(`Ignoring non-finite endTime for ${session.name}!`);
        return;
    }
    const nowMs = Date.now();
    const deltaTime = newEndTime - nowMs;
    // user-set cap: 0 = no cap. clamp the remaining time to capSeconds when it would exceed it.
    const capMs = session.capSeconds * 1000;
    if (capMs > 0 && deltaTime > capMs)
        newEndTime = capMs + nowMs;
    newEndTime = Math.round(newEndTime);
    console.log(`Setting ${session.name}'s endTime to ${newEndTime}!`);
    session.endTime = newEndTime;
    emitSync(session.userId);
}

// has the timer run out and stopped for good? only meaningful with stopAtZero on. endTime 0 is a timer that
// was never started, which isn't the same as one that hit zero, so that still accepts time.
export function isStoppedAtZero(session: TimerUserSession): boolean {
    return !!session.stopAtZero && session.endTime > 0 && session.endTime <= Date.now();
}

export function addToEndTime(session: TimerUserSession, seconds: number, action: string){
    const oldEndTime = session.endTime;
    const nowMs = Date.now();
    // opt-in: once it hits zero the timer stays there, so late subs/donations can't revive it. setting a
    // time by hand is the way back — that path goes through setEndTime, not here.
    if (isStoppedAtZero(session)){
        console.log(`${session.name}'s timer is at zero (stop at zero on); ignoring ${seconds}s from ${action}.`);
        emitTerminal(session.userId, `Timer is at 0 — ignored ${seconds}s from "${action}" (stop at zero is on).`);
        return;
    }
    let newEndTime = session.endTime;
    if (newEndTime < nowMs)
        newEndTime = nowMs;
    newEndTime += seconds * 1000;
    console.log(`Adding ${seconds} seconds to ${session.name}'s endTime!`);
    setEndTime(session, newEndTime);
    logTimerEvent(session, action, oldEndTime, session.endTime);
}
