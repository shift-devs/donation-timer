// the raffle, shared by the dashboard tab and (through the firesale overlay) the /raffle source. the settings
// live on the server — see back/src/raffle.ts, whose defaults and allowed values these MUST match, or a save
// would quietly reset a field the dashboard just set.

export const DEFAULT_RAFFLE = {
	command: "raffle",
	title: "RAFFLE",
	prize: "",
	entrySec: 120,
	winners: 1,
	giveBoxes: false,
	boxesPerWinner: 1,
	announceInChat: true,
	music: "firesale.mp3",
	volume: 0.6,
	announcer: "",
	announcerVolume: 1,
	winSound: "congratulations-you-won.mp3",
	winVolume: 1,
	showCountdown: true,
	drawSec: 4,
	winnerHoldSec: 20,
	maxBouncers: 120,
	bgColor: "transparent",
	titleColor: "#ffd400",
	nameColor: "#ffffff",
};

export const MAX_RAFFLE_WINNERS = 20;

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

// fill in whatever the server left out, tidied exactly as the server tidies it so the tab's draft compares equal
export function canonRaffle(raw: any) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_RAFFLE;
	return {
		command: (typeof r.command === "string" ? r.command.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.command,
		title: str(r.title, 40, d.title),
		prize: str(r.prize, 200, d.prize),
		entrySec: numIn(r.entrySec, 0, 3600, d.entrySec),
		winners: numIn(r.winners, 1, MAX_RAFFLE_WINNERS, d.winners),
		giveBoxes: r.giveBoxes === undefined ? d.giveBoxes : !!r.giveBoxes,
		boxesPerWinner: numIn(r.boxesPerWinner, 1, 99, d.boxesPerWinner),
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
		maxBouncers: numIn(r.maxBouncers, 1, 200, d.maxBouncers),
		bgColor: hexOr(r.bgColor, d.bgColor, "transparent"),
		titleColor: hexOr(r.titleColor, d.titleColor),
		nameColor: hexOr(r.nameColor, d.nameColor),
	};
}
