// the firesale giveaway overlay, shared by the /firesale browser source and the dashboard tab that configures
// it, so what the operator sets up is what OBS draws. the settings live on the server — see
// back/src/firesale.ts, whose defaults and allowed values these MUST match, or a save would quietly reset a
// field the dashboard just set.

export const DEFAULT_FIRESALE = {
	enabled: true,
	botName: "fourthwall",
	command: "enter",
	music: "firesale.mp3",
	volume: 0.6,
	announcer: "firesale announcer.mp3",
	announcerVolume: 1,
	fallbackSec: 180,
	showCountdown: false,
	drawGraceSec: 60,
	winnerHoldSec: 15,
	maxBouncers: 40,
	bgColor: "transparent",
	titleColor: "#ff2d0f",
	nameColor: "#ffffff",
};

export const MAX_BOUNCERS = 200;

// the source is built for a 4:3 canvas (a CRT), so everything inside is laid out in this fixed logical space
// and scaled as one to whatever size the OBS source is. that keeps the type, the spacing and the bounce speed
// in proportion at 640x480 and at 1440x1080 alike — a percentage layout would leave the names crawling on a
// big source and tearing across a small one.
export const STAGE_W = 1000;
export const STAGE_H = 750;

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

// fill in whatever the server left out, so both the source and the dashboard always render a complete config
export function canonFiresale(raw: any) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_FIRESALE;
	return {
		enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
		botName: typeof r.botName === "string" ? r.botName : d.botName,
		command: (typeof r.command === "string" ? r.command.replace(/^!/, "") : "") || d.command,
		music: typeof r.music === "string" ? r.music : d.music,
		volume: Math.min(1, Math.max(0, Number.isFinite(Number(r.volume)) ? Number(r.volume) : d.volume)),
		announcer: typeof r.announcer === "string" ? r.announcer : d.announcer,
		announcerVolume: Math.min(1, Math.max(0, Number.isFinite(Number(r.announcerVolume)) ? Number(r.announcerVolume) : d.announcerVolume)),
		fallbackSec: numIn(r.fallbackSec, 5, 3600, d.fallbackSec),
		showCountdown: r.showCountdown === undefined ? d.showCountdown : !!r.showCountdown,
		drawGraceSec: numIn(r.drawGraceSec, 0, 900, d.drawGraceSec),
		winnerHoldSec: numIn(r.winnerHoldSec, 1, 300, d.winnerHoldSec),
		maxBouncers: numIn(r.maxBouncers, 1, MAX_BOUNCERS, d.maxBouncers),
		bgColor: hexOr(r.bgColor, d.bgColor, "transparent"),
		titleColor: hexOr(r.titleColor, d.titleColor),
		nameColor: hexOr(r.nameColor, d.nameColor),
	};
}

// mm:ss for the entry countdown. clamps at zero so a clock that drifts past the end shows 0:00, never -0:01.
export function countdown(ms: number): string {
	const s = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
