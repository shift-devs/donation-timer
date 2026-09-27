// raffle: a giveaway the streamer runs themselves, start to finish. same stage as the firesale — looping music,
// the title rocking in the middle, everyone who typed the command bouncing around like a dvd logo — but nobody
// else announces anything. the streamer starts it, entries close on a timer (or by hand), and WE draw however
// many winners they asked for. winners can be paid in mystery boxes on top.
//
// the payload handed to the /raffle source is deliberately the firesale's shape (one run in `runs`), so the
// same overlay draws both and they can't drift apart in look.
//
// ONE RAFFLE AT A TIME. unlike fourthwall giveaways there's no outside source opening several at once, and a
// second start while one is up just replaces it.
//
// same split as the firesale: raffleSettings is persisted config, the run is live state and never written.

import { TimerUserSession } from "./types";
import { emitRaffle, emitTerminal, reportError } from "./bus";
import { mbSettings, grantMysteryBox } from "./mysterybox";
import { firesaleSettings } from "./firesale";
import { chatAnnounce } from "./chat";

const MAX_NAME = 25;
const MAX_TITLE = 40;
const MAX_PRIZE = 200;
const MAX_ENTRANTS = 5000;
const MAX_BOUNCERS = 200;
const MAX_WINNERS = 20;
const MAX_BOXES = 99;
const PUSH_COALESCE = 250;

export const RAFFLE_ACTIONS = ["start", "draw", "stop"];

export const DEFAULT_RAFFLE = {
    // what chatters type to enter, without the "!"
    command: "raffle",
    // the big word in the middle of the overlay
    title: "RAFFLE",
    // what's up for grabs. shown under the title and on the winner card; blank = nothing extra
    prize: "",
    // how long entries stay open. 0 = until the streamer hits draw
    entrySec: 120,
    // how many names come out of the hat
    winners: 1,
    // pay each winner in mystery boxes as well
    giveBoxes: false,
    boxesPerWinner: 1,
    // say the winners in chat once they're up
    announceInChat: true,
    music: "firesale.mp3",
    volume: 0.6,
    announcer: "",
    announcerVolume: 1,
    winSound: "congratulations-you-won.mp3",
    winVolume: 1,
    showCountdown: true,
    // how long DRAWING… hangs before the names go up — a beat of suspense, since the draw itself is instant
    drawSec: 4,
    winnerHoldSec: 20,
    maxBouncers: 120,
    bgColor: "transparent",
    titleColor: "#ffd400",
    nameColor: "#ffffff",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function hexOr(v: any, fallback: string, extra?: string): string {
    const s = typeof v === "string" ? v.trim() : "";
    if (extra && s === extra)
        return s;
    return HEX.test(s) ? s : fallback;
}

function numIn(v: any, min: number, max: number, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function vol(v: any, fallback: number): number {
    return Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : fallback));
}

function str(v: any, max: number, fallback = ""): string {
    return typeof v === "string" ? v.slice(0, max) : fallback;
}

export function normalizeRaffle(raw: any): any {
    const d = DEFAULT_RAFFLE;
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        command: (typeof r.command === "string" ? r.command.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.command,
        title: str(r.title, MAX_TITLE, d.title),
        prize: str(r.prize, MAX_PRIZE, d.prize),
        entrySec: numIn(r.entrySec, 0, 3600, d.entrySec),
        winners: numIn(r.winners, 1, MAX_WINNERS, d.winners),
        giveBoxes: r.giveBoxes === undefined ? d.giveBoxes : !!r.giveBoxes,
        boxesPerWinner: numIn(r.boxesPerWinner, 1, MAX_BOXES, d.boxesPerWinner),
        announceInChat: r.announceInChat === undefined ? d.announceInChat : !!r.announceInChat,
        music: str(r.music, 200, d.music),
        volume: vol(r.volume, d.volume),
        announcer: str(r.announcer, 200, d.announcer),
        announcerVolume: vol(r.announcerVolume, d.announcerVolume),
        winSound: str(r.winSound, 200, d.winSound),
        winVolume: vol(r.winVolume, d.winVolume),
        showCountdown: r.showCountdown === undefined ? d.showCountdown : !!r.showCountdown,
        drawSec: numIn(r.drawSec, 0, 30, d.drawSec),
        winnerHoldSec: numIn(r.winnerHoldSec, 1, 600, d.winnerHoldSec),
        maxBouncers: numIn(r.maxBouncers, 1, MAX_BOUNCERS, d.maxBouncers),
        bgColor: hexOr(r.bgColor, d.bgColor, "transparent"),
        titleColor: hexOr(r.titleColor, d.titleColor),
        nameColor: hexOr(r.nameColor, d.nameColor),
    };
}

export function raffleSettings(session: TimerUserSession): any {
    return session.raffleSettings || (session.raffleSettings = normalizeRaffle(null));
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

// timers off the session, same as the firesale's
const timers: { [userId: number]: { push?: any, end?: any, draw?: any, hold?: any } } = {};

function slots(userId: number){
    return timers[userId] || (timers[userId] = {});
}

function clearRunTimers(userId: number){
    const t = slots(userId);
    clearTimeout(t.end);
    clearTimeout(t.draw);
    clearTimeout(t.hold);
    t.end = t.draw = t.hold = undefined;
}

export function getRaffle(session: TimerUserSession): any {
    if (!session.raffle || typeof session.raffle !== "object")
        session.raffle = { nonce: 0, seq: 0, run: null };
    return session.raffle;
}

function currentRun(session: TimerUserSession): any {
    return getRaffle(session).run;
}

export function isRaffling(session: TimerUserSession): boolean {
    return !!(session.raffle && session.raffle.run);
}

// what the /raffle source (and the tab) is handed. the firesale's shape on purpose — see the top of the file.
// the reward text and the settings snapshot come off the RUN, not the live settings, so editing the tab
// mid-raffle can't change what the people already on screen were promised.
export function raffleView(session: TimerUserSession): any {
    const f = getRaffle(session);
    const cfg = raffleSettings(session);
    const run = f.run;
    const names: string[] = run ? run.entrants.map((e: any) => e.name) : [];
    return {
        active: !!run,
        nonce: f.nonce,
        names: names.slice(-cfg.maxBouncers),
        total: names.length,
        runs: run ? [{
            id: run.id,
            phase: run.phase,
            startedAt: run.startedAt,
            endsAt: run.endsAt,
            prize: run.prize,
            gifter: "",
            url: "",
            winners: run.winners.map((w: any) => w.name),
            wonAt: run.wonAt,
            total: run.entrants.length,
            bonus: run.boxes > 0 ? `+${run.boxes} MYSTERY BOX${run.boxes === 1 ? "" : "ES"}${run.want > 1 ? " EACH" : ""}` : "",
        }] : [],
        want: run ? run.want : cfg.winners,
        title: (run ? run.title : cfg.title) || "RAFFLE",
        command: cfg.command,
        showCountdown: cfg.showCountdown,
        music: cfg.music,
        volume: cfg.volume,
        announcer: cfg.announcer,
        announcerVolume: cfg.announcerVolume,
        winSound: cfg.winSound,
        winVolume: cfg.winVolume,
        bgColor: cfg.bgColor,
        titleColor: cfg.titleColor,
        nameColor: cfg.nameColor,
    };
}

export function pushRaffle(session: TimerUserSession){
    emitRaffle(session.userId, raffleView(session));
}

function pushSoon(session: TimerUserSession){
    const t = slots(session.userId);
    if (t.push)
        return;
    t.push = setTimeout(() => {
        t.push = undefined;
        try {
            pushRaffle(session);
        } catch (err) {
            reportError(session.userId, "pushing the raffle state", err);
        }
    }, PUSH_COALESCE);
}

// what a single start can change about the raffle, over what's on the tab. anything left out keeps the tab's.
// a timer event carries one of these, and so can "raffle start" in the terminal.
export type RaffleOverrides = {
    seconds?: number | null,
    title?: string | null,
    prize?: string | null,
    winners?: number | null,
    giveBoxes?: boolean | null,
    boxesPerWinner?: number | null,
};

// the same bounds the settings get, applied to one start's overrides. nulls and blanks drop out, so a caller
// can pass a half-filled form straight through.
export function normalizeRaffleOverrides(raw: any): RaffleOverrides {
    const r = raw && typeof raw === "object" ? raw : {};
    const num = (v: any, min: number, max: number) => {
        if (v == null || v === "")
            return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined;
    };
    const text = (v: any, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    const out: RaffleOverrides = {};
    const seconds = num(r.seconds, 0, 3600);
    if (seconds !== undefined) out.seconds = seconds;
    const title = text(r.title, MAX_TITLE);
    if (title !== undefined) out.title = title;
    const prize = text(r.prize, MAX_PRIZE);
    if (prize !== undefined) out.prize = prize;
    const winners = num(r.winners, 1, MAX_WINNERS);
    if (winners !== undefined) out.winners = winners;
    if (typeof r.giveBoxes === "boolean") out.giveBoxes = r.giveBoxes;
    const boxes = num(r.boxesPerWinner, 1, MAX_BOXES);
    if (boxes !== undefined) out.boxesPerWinner = boxes;
    return out;
}

// start a raffle with whatever is on the tab, with any overrides laid over the top for this one run
export function startRaffle(session: TimerUserSession, overrides: RaffleOverrides = {}): any {
    const o = normalizeRaffleOverrides(overrides);
    const cfg = { ...raffleSettings(session), ...o };
    if (o.seconds !== undefined)
        cfg.entrySec = o.seconds;
    const f = getRaffle(session);
    const secs = cfg.entrySec;
    clearRunTimers(session.userId);
    f.seq = (f.seq || 0) + 1;
    f.nonce = (f.nonce || 0) + 1;
    const mb = mbSettings(session);
    f.run = {
        id: `raffle${f.seq}`,
        phase: "running",
        startedAt: Date.now(),
        endsAt: secs > 0 ? Date.now() + secs * 1000 : 0,
        title: cfg.title,
        prize: cfg.prize,
        want: cfg.winners,
        // 0 when boxes are off here or mystery boxes are off altogether — the overlay shouldn't promise one
        boxes: cfg.giveBoxes && mb.enabled ? cfg.boxesPerWinner : 0,
        winners: [] as { login: string, name: string }[],
        wonAt: 0,
        entrants: [] as { login: string, name: string }[],
        seen: new Set<string>(),
    };
    const run = f.run;
    if (secs > 0)
        slots(session.userId).end = setTimeout(() => {
            try {
                drawRaffle(session, run.id);
            } catch (err) {
                reportError(session.userId, "closing the raffle", err);
            }
        }, secs * 1000);
    if (cfg.giveBoxes && !mb.enabled)
        emitTerminal(session.userId, `RAFFLE — mystery boxes are turned off, so the winners won't get any.`);
    emitTerminal(session.userId, `RAFFLE started — !${cfg.command} to enter, ${run.want} winner${run.want === 1 ? "" : "s"}${secs > 0 ? `, ${secs}s` : ", open until drawn"}${cfg.prize ? ` for ${cfg.prize}` : ""}`, true);
    pushRaffle(session);
    return run;
}

// close entries, hang on DRAWING… for drawSec, then pull the names
export function drawRaffle(session: TimerUserSession, runId?: string): boolean {
    const run = currentRun(session);
    if (!run || run.phase !== "running" || (runId && run.id !== runId))
        return false;
    const cfg = raffleSettings(session);
    clearRunTimers(session.userId);
    run.phase = "drawing";
    pushRaffle(session);
    slots(session.userId).draw = setTimeout(() => {
        try {
            pickWinners(session, run.id);
        } catch (err) {
            reportError(session.userId, "drawing the raffle", err);
        }
    }, cfg.drawSec * 1000);
    return true;
}

function pickWinners(session: TimerUserSession, runId: string){
    const run = currentRun(session);
    if (!run || run.id !== runId || run.phase !== "drawing")
        return;
    const cfg = raffleSettings(session);
    if (!run.entrants.length){
        emitTerminal(session.userId, `RAFFLE ended — nobody entered.`);
        stopRaffle(session);
        return;
    }
    // a partial fisher-yates: only as many swaps as there are winners to pull
    const pool = run.entrants.slice();
    const n = Math.min(run.want, pool.length);
    for (let i = 0; i < n; i++){
        const j = i + Math.floor(Math.random() * (pool.length - i));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    run.winners = pool.slice(0, n);
    run.phase = "winner";
    run.wonAt = Date.now();
    const list = run.winners.map((w: any) => w.name).join(", ");
    emitTerminal(session.userId, `RAFFLE winner${n === 1 ? "" : "s"}: ${list}${run.prize ? ` — ${run.prize}` : ""} (${run.entrants.length} entered)`, true);
    if (run.boxes > 0)
        for (const w of run.winners)
            grantMysteryBox(session, w.login, w.name, run.boxes, `won the raffle`);
    if (cfg.announceInChat){
        const prize = run.prize ? ` ${run.prize}` : "";
        const boxes = run.boxes > 0 ? ` (+${run.boxes} mystery box${run.boxes === 1 ? "" : "es"}${n > 1 ? " each" : ""})` : "";
        chatAnnounce(session, `RAFFLE WINNER${n === 1 ? "" : "S"}: ${run.winners.map((w: any) => `@${w.name}`).join(", ")}${prize ? ` won${prize}` : ""}${boxes}! ${run.entrants.length} entered.`);
    }
    pushRaffle(session);
    slots(session.userId).hold = setTimeout(() => {
        try {
            const cur = currentRun(session);
            if (cur && cur.id === runId)
                stopRaffle(session);
        } catch (err) {
            reportError(session.userId, "clearing a finished raffle", err);
        }
    }, cfg.winnerHoldSec * 1000);
}

export function addRaffleEntry(session: TimerUserSession, login: string, displayName: string): boolean {
    const run = currentRun(session);
    const key = String(login || "").toLowerCase().trim();
    if (!run || run.phase !== "running" || !key || run.seen.has(key) || run.entrants.length >= MAX_ENTRANTS)
        return false;
    run.seen.add(key);
    run.entrants.push({ login: key, name: String(displayName || login).slice(0, MAX_NAME) });
    pushSoon(session);
    return true;
}

export function stopRaffle(session: TimerUserSession){
    clearRunTimers(session.userId);
    getRaffle(session).run = null;
    pushRaffle(session);
}

export function endRaffleTimers(userId: number){
    clearRunTimers(userId);
    clearTimeout(slots(userId).push);
    delete timers[userId];
}

// ---------------------------------------------------------------------------
// the "raffle <action>" command, from the terminal or a mod in chat
// ---------------------------------------------------------------------------

export function runRaffleCommand(session: TimerUserSession, cmd: { action: string, overrides?: RaffleOverrides }): { ok: boolean, message: string } {
    const cfg = raffleSettings(session);
    const run = currentRun(session);
    if (cmd.action === "start"){
        const replaced = !!run;
        const r = startRaffle(session, cmd.overrides);
        const secs = r.endsAt ? Math.round((r.endsAt - r.startedAt) / 1000) : 0;
        return { ok: true, message: `Raffle started${replaced ? " (replaced the one on screen)" : ""} — !${cfg.command} to enter, ${r.want} winner${r.want === 1 ? "" : "s"}${r.boxes ? ` getting ${r.boxes} box${r.boxes === 1 ? "" : "es"} each` : ""}, ${secs ? `${secs}s` : "open until you draw"}.` };
    }
    if (cmd.action === "draw"){
        if (!run || run.phase !== "running")
            return { ok: false, message: "No raffle is taking entries right now." };
        drawRaffle(session);
        return { ok: true, message: `Raffle closed — ${run.entrants.length} in, drawing ${Math.min(run.want, run.entrants.length)}.` };
    }
    if (!run)
        return { ok: false, message: "No raffle is running." };
    stopRaffle(session);
    return { ok: true, message: "Raffle cleared." };
}

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

// "!raffle" on its own enters. returns true if the line was consumed. two things pass through on purpose:
//   * a mod's "!raffle start / draw / stop", so the canonical command still reaches the mod path
//   * an entry that shares the firesale's command, so one "!enter" can join both
export function handleRaffleChat(session: TimerUserSession, login: string, displayName: string, text: string, isMod: boolean): boolean {
    const cfg = raffleSettings(session);
    const body = String(text || "").trim();
    if (!body.startsWith("!"))
        return false;
    const parts = body.slice(1).split(/\s+/);
    if (parts[0].toLowerCase() !== cfg.command)
        return false;
    if (isMod && RAFFLE_ACTIONS.includes(String(parts[1] || "").toLowerCase()))
        return false;
    addRaffleEntry(session, login, displayName || login);
    return cfg.command !== firesaleSettings(session).command;
}
