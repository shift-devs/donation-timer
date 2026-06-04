import { TimerUserSession, TimerEvent } from "./types";
import { CHAT_CMD_MAX_TIME } from "./config";
import { toSeconds } from "./rates";
import { addToEndTime } from "./timer";

// the one place that decides what an event does: anon filter -> rate -> cap (manual only) -> add time + log
export function handle(session: TimerUserSession, event: TimerEvent){
    if (session.loggedOut)
        return;
    if (event.kind === "sub" && session.ignoreAnon && event.anonymous)
        return;
    const seconds = toSeconds(session.rates, event);
    if (!seconds)
        return;
    if (event.manual && Math.abs(seconds) > CHAT_CMD_MAX_TIME){
        console.log(`Time change would be greater than ${CHAT_CMD_MAX_TIME} seconds!`);
        return;
    }
    // tag every logged action with its platform (one chokepoint -> covers organic + chat + terminal commands)
    addToEndTime(session, seconds, `[${event.platform}] ${event.label}`);
}
