import { TimerUserSession, TimerEvent } from "./types";
import { CHAT_CMD_MAX_TIME } from "./config";
import { toSeconds } from "./rates";
import { addToEndTime } from "./timer";
import { reportError } from "./bus";

// the one place that decides what an event does: anon filter -> rate -> cap (manual only) -> add time + log.
// every sub/donation/timer change funnels through here, so this try/catch is the containment point: a bad
// payload can lose its own event but never crash the server, and the failure lands on the dashboard terminal.
export function handle(session: TimerUserSession, event: TimerEvent){
    try {
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
    } catch (err) {
        reportError(session.userId, `applying event "${(event && event.label) || "?"}"`, err);
    }
}
