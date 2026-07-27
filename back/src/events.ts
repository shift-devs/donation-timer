import { TimerUserSession, TimerEvent } from "./types";
import { CHAT_CMD_MAX_TIME } from "./config";
import { toSeconds } from "./rates";
import { addToEndTime } from "./timer";
import { emitSync, reportError } from "./bus";

// tally a genuine (non-command) sub/membership for the /subcount browser sources. counts each gifted
// recipient (gift bombs carry count = N) and is independent of the anon/rate/cap logic below — those
// govern how much *time* a sub grants, not whether the sub happened. returns true if it counted one.
function countSub(session: TimerUserSession, event: TimerEvent): boolean {
    const n = Math.max(1, Math.trunc(Number(event.count) || 1));
    if (event.platform === "twitch" && event.kind === "sub")
        session.subCountTwitch += n;
    else if (event.platform === "kick" && event.kind === "member")
        session.subCountKick += n;
    else if (event.platform === "youtube" && event.kind === "member")
        session.subCountYoutube += n;
    else
        return false;
    return true;
}

// the one place that decides what an event does: anon filter -> rate -> cap (manual only) -> add time + log.
// every sub/donation/timer change funnels through here, so this try/catch is the containment point: a bad
// payload can lose its own event but never crash the server, and the failure lands on the dashboard terminal.
export function handle(session: TimerUserSession, event: TimerEvent){
    try {
        if (session.loggedOut)
            return;
        // count real subs before the anon/rate short-circuits so the tally reflects every sub that happened,
        // even anon ones or ones that grant no time. typed/chat commands (manual) never touch the count.
        if (!event.manual && countSub(session, event))
            emitSync(session.userId); // push updated counts to open /subcount sources promptly
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
