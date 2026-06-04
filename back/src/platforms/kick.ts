import { TimerUserSession, TimerEvent } from "../types";

// placeholder adapter — no kick source wired yet. implements the connect(session, emit) contract for the future.
export function connectKick(session: TimerUserSession, emit: (e: TimerEvent) => void){
    return undefined;
}
