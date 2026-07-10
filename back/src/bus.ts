import { EventEmitter } from "events";

// decouples timer/log from the WS layer: timer/log emit here, api subscribes + broadcasts.
// replaces the old gWSSync/gWSLog globals.
export const bus = new EventEmitter();

export function emitSync(userId: number) {
    bus.emit("sync", userId);
}

export function emitLog(userId: number, entry: any) {
    bus.emit("logEntry", userId, entry);
}

// tell this user's /events browser source(s) to play a clip. api.ts routes it to page=events clients only.
export function emitPlayEvent(userId: number, payload: any) {
    bus.emit("playEvent", userId, payload);
}

// purchase alert for this user's /fwalert browser source(s). api.ts routes it to page=fwalert clients only.
export function emitFwAlert(userId: number, payload: any) {
    bus.emit("fwAlert", userId, payload);
}

// live entry for this user's /fwactivity feed page(s). api.ts routes it to page=fwactivity clients only.
export function emitFwActivity(userId: number, entry: any) {
    bus.emit("fwActivityEntry", userId, entry);
}
