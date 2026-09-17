import { TimerUserSession } from "./types";
import { emitSync, emitTerminal, reportError } from "./bus";
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

// ---------------------------------------------------------------------------
// pausing
// ---------------------------------------------------------------------------
//
// there is no "paused" flag in the timer's design: the countdown is a DEADLINE (endTime), and everything —
// the widget, the dashboard, the event scheduler's remaining-time windows — derives from it. so a pause is
// implemented as what a pause actually is: the deadline is dragged forward in real time, once per tick, so
// the remaining time stays where it is while the wall clock moves.
//
// the REMAINING TIME is what's authoritative here, not the deadline. the tick re-derives endTime from it
// (endTime = now + remaining) rather than adding the elapsed interval to endTime, because a sampled drag is
// always a tick behind: endTime - now would wobble by up to one interval, which is enough to flicker the
// held number by a second between syncs. anything that moved endTime since the last tick — a sub, a
// donation, a mod setting the clock — shows up as drift and is folded into the remaining, so time granted
// during a pause stays granted. it just doesn't start counting down until the pause ends.
//
// clients are told about the pause separately (timerPause on the sync) because a source only hears a new
// endTime every few seconds: left to itself it would count down from the last one it heard and then jump
// back on the next sync. knowing it's paused, it holds the number still instead.

const PAUSE_TICK = 250;  // ms; small enough that the drag is invisible in the deadline the sync carries
// one tick per user. it holds the SESSION it is dragging, refreshed on every pause, rather than closing over
// the one that started it: a logout and a fresh login replace the session object entirely, and a tick still
// pushing the old one's deadline forward would be holding a timer nobody can see.
const pauseTicks: { [userId: number]: { handle: any, session: TimerUserSession, expected: number } } = {};

// freeze the countdown for `ms`. pausing something already paused EXTENDS it to whichever end is later,
// rather than restarting it — two prizes landing close together shouldn't cut the first one short.
//
// `rollMs` makes it a TIMEBOMB: a freeze that every contribution pushes back out to rollMs from now, so chat
// can keep it alive by chaining subs and donations and it only lapses once they stop for that long. it's the
// same freeze underneath — the only difference is that something else moves the deadline (see
// refreshTimebomb, called from events.ts).
export function pauseTimerFor(session: TimerUserSession, ms: number, reason: string, rollMs = 0){
    const now = Date.now();
    const duration = Math.max(0, Math.trunc(ms));
    if (!duration)
        return;
    // a timer that isn't running has nothing to hold still, and dragging its deadline forward would quietly
    // un-expire it (or revive one that stopped at zero)
    if (session.endTime <= now){
        emitTerminal(session.userId, `Timer isn't running — nothing to pause (${reason}).`);
        return;
    }
    const cur = session.timerPause;
    // extending an existing pause keeps the remaining time it's already holding — re-reading it here would
    // pick up whatever the last tick left, and hand back the fraction of a tick's worth of drift with it
    const until = Math.max(now + duration, cur ? cur.until : 0);
    session.timerPause = {
        until,
        reason,
        remainingMs: cur ? cur.remainingMs : session.endTime - now,
        // a bomb landing on a plain pause makes the whole thing rolling, and a plain pause landing on a bomb
        // leaves it rolling — either way the more generous behaviour wins, as with the end time above
        rollMs: Math.max(Math.max(0, Math.trunc(rollMs)), cur ? cur.rollMs : 0),
    };
    const slot = pauseTicks[session.userId];
    if (slot){
        slot.session = session;
        slot.expected = session.endTime;
    } else {
        pauseTicks[session.userId] = {
            session,
            expected: session.endTime,
            handle: setInterval(() => {
                const cell = pauseTicks[session.userId];
                if (!cell)
                    return;
                try {
                    const t = Date.now();
                    const live = cell.session;
                    const p = live.timerPause;
                    if (!p || t >= p.until || live.loggedOut){
                        resumeTimer(live);
                        return;
                    }
                    // anything that moved the deadline since the last tick was somebody granting (or taking)
                    // time while we held it. fold it in, so it's still there when the clock starts again.
                    p.remainingMs += live.endTime - cell.expected;
                    // assigned, not added, and straight to endTime rather than through setEndTime: this fires
                    // four times a second and must not broadcast a sync each time. the cap can't be breached
                    // either — the remaining time is being held where it was, not grown.
                    live.endTime = t + p.remainingMs;
                    cell.expected = live.endTime;
                } catch (err) {
                    reportError(cell.session.userId, "holding the timer paused", err);
                    resumeTimer(cell.session);
                }
            }, PAUSE_TICK),
        };
    }
    emitTerminal(session.userId, session.timerPause.rollMs
        ? `${reason} — the timer is frozen, and every contribution buys another ${Math.round(session.timerPause.rollMs / 1000)}s of it.`
        : `Timer paused for ${Math.round(duration / 1000)}s — ${reason}.`, true);
    emitSync(session.userId);
}

// a contribution landed while a timebomb is running: push the freeze back out to its full length. this is
// what makes the thing a game — chat keeps the timer frozen for as long as they keep feeding it, and the
// moment they stop for rollMs the tick above lets it go.
// does nothing to a plain pause, which is a fixed window nobody can extend.
export function refreshTimebomb(session: TimerUserSession){
    const p = session.timerPause;
    if (!p || !p.rollMs)
        return;
    const now = Date.now();
    if (p.until <= now)
        return; // already lapsed; the tick is about to clear it and reviving it here would be a second freeze
    p.until = now + p.rollMs;
    emitSync(session.userId); // the countdown on stream has to be seen to reset, or chaining has no feedback
}

export function resumeTimer(session: TimerUserSession){
    const wasPaused = !!session.timerPause;
    endPauseTimer(session.userId);
    session.timerPause = undefined;
    if (wasPaused){
        emitTerminal(session.userId, `Timer running again.`, true);
        emitSync(session.userId);
    }
}

// time that has landed since the last tick and hasn't been folded into the held total yet. the tick does
// that fold four times a second, which is soon enough for the clock but not for the SYNC a contribution
// sends immediately after granting time — that one would otherwise report the held time as it was a moment
// before, and a timebomb would show chat's sub arriving a quarter of a second late. read, never written:
// the fold itself belongs to the tick.
function pendingDrift(session: TimerUserSession): number {
    const cell = pauseTicks[session.userId];
    return cell ? session.endTime - cell.expected : 0;
}

// what the clients are told: how long the pause has left, and the remaining time to hold on screen while it
// lasts. the remaining comes off the pause itself rather than being re-derived from the deadline, so every
// sync during one pause reports the same number to the millisecond — a held clock that flickered a second
// each time a sync landed would be worse than not freezing it at all.
export function timerPauseView(session: TimerUserSession): any {
    const p = session.timerPause;
    if (!p)
        return null;
    return {
        until: p.until,
        reason: p.reason,
        remainingMs: Math.max(0, p.remainingMs + pendingDrift(session)),
        // non-zero means the clients should draw this as a countdown chat can reset, not a fixed wait
        rollMs: p.rollMs || 0,
    };
}

// tear down on logout so the tick can't keep dragging a detached session's deadline forward
export function endPauseTimer(userId: number){
    const slot = pauseTicks[userId];
    if (slot)
        clearInterval(slot.handle);
    delete pauseTicks[userId];
}

// ---------------------------------------------------------------------------
// boosting
// ---------------------------------------------------------------------------
//
// a window during which every contribution grants MORE time than its rate says — the "bonfire sale" a mystery
// box can hand out. it multiplies what a sub, a cheer, a donation or an order is worth for as long as it
// lasts, and then lapses on its own.
//
// it deliberately does NOT touch the rates themselves. rates are configuration the operator owns, a boost is
// a thing that is happening; writing one into the other would mean a crash mid-sale left the stream paying
// double forever, and would fight the dashboard the moment somebody edited a rate while it ran.
// the multiplication happens in events.ts, at the one point that turns an event into seconds.

const boostTimers: { [userId: number]: any } = {};

// start (or extend) a boost. an overlapping one takes the LATER end and the LARGER factor rather than
// multiplying the two together — two sales landing back to back should feel generous, not compound into a
// x4 nobody chose.
export function startTimeBoost(session: TimerUserSession, ms: number, factor: number, reason: string, sound = "", volume = 0.6){
    const duration = Math.max(0, Math.trunc(ms));
    const mult = Number.isFinite(factor) ? factor : 1;
    if (!duration || mult <= 1)
        return;
    const now = Date.now();
    const cur = session.timeBoost && session.timeBoost.until > now ? session.timeBoost : undefined;
    session.timeBoost = {
        until: Math.max(now + duration, cur ? cur.until : 0),
        factor: Math.max(mult, cur ? cur.factor : 0),
        reason,
        // when the CURRENT run of sale started. the browser source keys its looping track on this, so a sale
        // that gets extended carries on playing rather than jumping back to the top of the track.
        startedAt: cur ? cur.startedAt : now,
        // likewise the track itself: a second sale landing on a running one doesn't swap the music out from
        // under it. only a sale starting from silence chooses what plays.
        sound: cur && cur.sound ? cur.sound : sound,
        volume: cur && cur.sound ? cur.volume : Math.min(1, Math.max(0, volume)),
    };
    clearTimeout(boostTimers[session.userId]);
    boostTimers[session.userId] = setTimeout(() => {
        try {
            endTimeBoost(session);
        } catch (err) {
            reportError(session.userId, "ending a time boost", err);
        }
    }, session.timeBoost.until - now);
    emitTerminal(session.userId, `${reason} — everything is worth x${session.timeBoost.factor} for ${Math.round((session.timeBoost.until - now) / 1000)}s.`, true);
    emitSync(session.userId);
}

export function endTimeBoost(session: TimerUserSession){
    const was = session.timeBoost;
    clearTimeout(boostTimers[session.userId]);
    delete boostTimers[session.userId];
    session.timeBoost = undefined;
    if (was){
        emitTerminal(session.userId, `${was.reason} is over — back to the normal rates.`, true);
        emitSync(session.userId);
    }
}

// what a contribution's time should be multiplied by right now. 1 = nothing doing. the clock is checked here
// as well as by the timer above, so a boost can never outlive its window even if that timer never fired.
export function boostFactor(session: TimerUserSession): number {
    const b = session.timeBoost;
    if (!b || b.until <= Date.now())
        return 1;
    return b.factor > 1 ? b.factor : 1;
}

export function timeBoostView(session: TimerUserSession): any {
    const b = session.timeBoost;
    if (!b || b.until <= Date.now())
        return null;
    return {
        until: b.until,
        factor: b.factor,
        reason: b.reason,
        startedAt: b.startedAt,
        // a track the /mysterybox source loops for as long as the sale lasts
        sound: b.sound || "",
        volume: b.volume,
    };
}

// tear down on logout so the expiry can't fire against a detached session
export function endBoostTimer(userId: number){
    clearTimeout(boostTimers[userId]);
    delete boostTimers[userId];
}
