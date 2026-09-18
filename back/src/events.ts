import { TimerUserSession, TimerEvent } from "./types";
import { CHAT_CMD_MAX_TIME } from "./config";
import { toSeconds } from "./rates";
import { addToEndTime, boostFactor, refreshTimebomb } from "./timer";
import { emitSync, reportError } from "./bus";
import { firePlatformTriggers } from "./scheduler";
import { creditQuickRevive } from "./quickRevive";

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

// what counts as a CONTRIBUTION — a sub, a cheer, a donation, an order, or a mod entering one by hand
// because we missed it. everything except a typed "time <seconds>", which isn't somebody giving anything but
// somebody naming the exact number of seconds they want the clock moved by.
// the prizes that react to contributions (the bonfire sale's multiplier, the timebomb's freeze) both ask
// this, so the two can't drift into disagreeing about what chat just did.
function isContribution(event: TimerEvent): boolean {
    return !(event.kind === "time" && event.manual);
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
        // a gift bomb, a donation or a shop purchase can also trigger a configured event (see scheduler.ts, which
        // decides what matches). done here, alongside the count and before the anon/rate short-circuits, because
        // the thing happened whether or not it grants any time.
        if (!event.manual)
            firePlatformTriggers(session, event);
        // a timebomb's freeze is pushed back out by every contribution. done here, before the anon and rate
        // short-circuits below, because chaining the freeze is about the contribution HAPPENING — an anon
        // gifter, or a sub whose rate is set to zero, still bought chat another few seconds.
        if (isContribution(event))
            refreshTimebomb(session);
        // a running quick revive counts every sub's points, typed ones included, and before the anon and
        // rate short-circuits: an anonymous gift bomb is still sub points chat put up
        creditQuickRevive(session, event);
        if (event.kind === "sub" && session.ignoreAnon && event.anonymous)
            return;
        const rated = toSeconds(session.rates, event);
        if (!rated)
            return;
        // a boost ("bonfire sale") multiplies what a CONTRIBUTION is worth, for as long as it lasts. this is
        // the one point every sub, cheer, donation and order passes through, so it's the only place it has
        // to be applied.
        // what it skips is a typed "time <seconds>", which is not a contribution but somebody stating the
        // exact number of seconds they want added — doubling that would fight an operator correcting the
        // clock, and would silently double the time commands that scheduled events fire. everything else is
        // in, including the flat and per-product bonuses a fourthwall order carries, because those ARE part
        // of what the purchase granted.
        const factor = isContribution(event) ? boostFactor(session) : 1;
        const seconds = factor === 1 ? rated : Math.round(rated * factor);
        const label = factor === 1
            ? event.label
            : `${event.label} (x${factor} ${(session.timeBoost && session.timeBoost.reason) || "boost"})`;
        // the command ceiling is checked on the BOOSTED number: it's a ceiling on how much time one typed
        // command may move the clock, and a boost that could carry it past would defeat the point of it
        if (event.manual && Math.abs(seconds) > CHAT_CMD_MAX_TIME){
            console.log(`Time change would be greater than ${CHAT_CMD_MAX_TIME} seconds!`);
            return;
        }
        // tag every logged action with its platform (one chokepoint -> covers organic + chat + terminal commands)
        addToEndTime(session, seconds, `[${event.platform}] ${label}`);
    } catch (err) {
        reportError(session.userId, `applying event "${(event && event.label) || "?"}"`, err);
    }
}
