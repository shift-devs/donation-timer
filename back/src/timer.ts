import { TimerUserSession } from "./types";
import { emitSync, emitTerminal, reportError } from "./bus";
import { logTimerEvent } from "./log";
import { normalizeWidgetSettings } from "./widgetSettings";

// the highest whole hour the timer has ever shown. it only ever goes UP, here, as the deadline moves — so
// reaching 300:00:00 makes 300 the new mark, and dropping back under it changes nothing. the timer sources
// pulse while they're back inside that hour (see Timer.tsx).
function notePeakHour(session: TimerUserSession){
    const hours = Math.floor((session.endTime - Date.now()) / 3600000);
    if (!(hours >= 1))
        return;
    const w = normalizeWidgetSettings(session.widgetSettings);
    if (hours <= w.peakHour)
        return;
    session.widgetSettings = { ...w, peakHour: hours };
    emitTerminal(session.userId, `TIMER — new highest hour: ${hours}.`, true);
}

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
    notePeakHour(session);
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

// the freeze colour ends up in a css property in a browser source, so it's checked HERE rather than trusted
// from the caller: this is the module that stores it, and validating at the boundary that owns the value is
// the difference between one guard and a guard at every call site that ever adds one.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const PAUSE_TICK = 250;  // ms; small enough that the drag is invisible in the deadline the sync carries
// one tick per user. it holds the SESSION it is dragging, refreshed on every pause, rather than closing over
// the one that started it: a logout and a fresh login replace the session object entirely, and a tick still
// pushing the old one's deadline forward would be holding a timer nobody can see.
const pauseTicks: { [userId: number]: { handle: any, session: TimerUserSession, expected: number } } = {};
// a timebomb's reward for being kept alive, per user: paid once, the first tick the freeze has lasted goalMs.
// held off the session for the usual reason — a closure is not state anyone should serialize or sync.
const bombGoals: { [userId: number]: { pay: () => void, miss?: (heldMs: number) => void } } = {};

// freeze the countdown for `ms`. pausing something already paused EXTENDS it to whichever end is later,
// rather than restarting it — two prizes landing close together shouldn't cut the first one short.
//
// `rollMs` makes it a TIMEBOMB: a freeze that every contribution pushes back out to rollMs from now, so chat
// can keep it alive by chaining subs and donations and it only lapses once they stop for that long. it's the
// same freeze underneath — the only difference is that something else moves the deadline (see
// refreshTimebomb, called from events.ts).
// returns whether `opts.goal` was taken on — false when the timer wasn't running, or when the freeze it landed
// on already carries a goal of its own (that one is kept).
export function pauseTimerFor(session: TimerUserSession, ms: number, reason: string,
    opts: { rollMs?: number, sound?: string, volume?: number, color?: string, pulse?: boolean,
        goal?: { ms: number, what: string, pay: () => void, miss?: (heldMs: number) => void } } = {}): boolean {
    const rollMs = opts.rollMs || 0;
    const now = Date.now();
    const duration = Math.max(0, Math.trunc(ms));
    if (!duration)
        return false;
    // a timer that isn't running has nothing to hold still, and dragging its deadline forward would quietly
    // un-expire it (or revive one that stopped at zero)
    if (session.endTime <= now){
        emitTerminal(session.userId, `Timer isn't running — nothing to pause (${reason}).`);
        return false;
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
        // when the CURRENT freeze began, and the track under it. both survive a second prize landing on top
        // and every contribution that pushes the deadline out — the music plays through the whole thing
        // rather than snapping back to the top of the track each time chat feeds it, which is the one sound
        // a viewer would notice immediately.
        startedAt: cur ? cur.startedAt : now,
        sound: cur && cur.sound ? cur.sound : (opts.sound || ""),
        volume: cur && cur.sound ? cur.volume : Math.min(1, Math.max(0, opts.volume === undefined ? 0.6 : opts.volume)),
        // what the countdown turns while it's held. same rule as the track: the freeze already on screen
        // keeps its look rather than changing colour under a viewer mid-freeze.
        color: cur && cur.color ? cur.color : (HEX_COLOR.test(String(opts.color || "").trim()) ? String(opts.color).trim() : ""),
        // whether the digits beat between their normal colour and that one, rather than just turning it
        pulse: cur && cur.color ? cur.pulse : !!opts.pulse,
        // a timebomb's keep-it-alive reward. the one already running keeps its own; a bomb landing on a freeze
        // with no goal brings one, counted from now rather than from when the freeze began.
        goalMs: cur && cur.goalMs ? cur.goalMs : (opts.goal ? Math.max(0, Math.trunc(opts.goal.ms)) : 0),
        goalFrom: cur && cur.goalMs ? cur.goalFrom : now,
        goalWhat: cur && cur.goalMs ? cur.goalWhat : (opts.goal ? String(opts.goal.what || "") : ""),
        goalPaid: cur && cur.goalMs ? cur.goalPaid : false,
    };
    const goalTaken = !!(opts.goal && !(cur && cur.goalMs) && session.timerPause.goalMs);
    if (goalTaken && opts.goal)
        bombGoals[session.userId] = { pay: opts.goal.pay, miss: opts.goal.miss };
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
                    // kept alive long enough: pay the reward, once. any time it adds lands on endTime and is
                    // folded into the held total on the next tick, like any other contribution during a freeze.
                    if (p.goalMs && !p.goalPaid && t - p.goalFrom >= p.goalMs){
                        p.goalPaid = true;
                        const goal = bombGoals[live.userId];
                        delete bombGoals[live.userId];
                        emitTerminal(live.userId, `${p.reason} — kept alive ${Math.round(p.goalMs / 1000)}s: ${p.goalWhat || "reward"} paid.`, true);
                        emitSync(live.userId);
                        if (goal){
                            try {
                                goal.pay();
                            } catch (err) {
                                reportError(live.userId, "paying a timebomb's reward", err);
                            }
                        }
                    }
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
    return goalTaken;
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
    const p = session.timerPause;
    const goal = bombGoals[session.userId];
    delete bombGoals[session.userId];
    // went off short of its goal: say how close they got
    if (p && p.goalMs && !p.goalPaid && !session.loggedOut){
        const held = Math.max(0, Date.now() - p.goalFrom);
        emitTerminal(session.userId, `${p.reason} — went off after ${Math.round(held / 1000)}s, short of the ${Math.round(p.goalMs / 1000)}s goal.`);
        if (goal && goal.miss){
            try {
                goal.miss(held);
            } catch (err) {
                reportError(session.userId, "reporting a timebomb that went off", err);
            }
        }
    }
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
        startedAt: p.startedAt,
        // a track the /mysterybox source loops for as long as the freeze lasts
        sound: p.sound || "",
        volume: p.volume,
        // what the timer's digits turn while it's held; blank leaves them as they were
        color: p.color || "",
        pulse: !!p.pulse,
        // a timebomb's keep-it-alive goal: how long, since when, what it pays, and whether it already has
        goalMs: p.goalMs || 0,
        goalFrom: p.goalFrom || 0,
        goalWhat: p.goalWhat || "",
        goalPaid: !!p.goalPaid,
    };
}

// tear down on logout so the tick can't keep dragging a detached session's deadline forward
export function endPauseTimer(userId: number){
    delete bombGoals[userId];
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
