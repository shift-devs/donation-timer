import { TimerUserSession, TimerEvent } from "../types";

// placeholder adapter — no youtube source wired yet. implements the connect(session, emit) contract for the future.
export function connectYoutube(session: TimerUserSession, emit: (e: TimerEvent) => void){
    return undefined;
}
