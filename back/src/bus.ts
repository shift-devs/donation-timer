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
