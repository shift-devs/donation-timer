// the mystery box, shared by the /mysterybox browser source and the dashboard tab that configures it, so what
// the operator sets up is what OBS draws. the settings live on the server — see back/src/mysterybox.ts, whose
// defaults and allowed values these MUST match, or a save would quietly reset a field the dashboard just set.

export const DEFAULT_MYSTERYBOX = {
	enabled: true,
	command: "mb",
	raygunCommand: "raygun",
	grantOnFiresale: true,
	music: "",
	volume: 0.7,
	spinSec: 6,
	spinTiles: 20,
	revealHoldSec: 8,
	bgColor: "transparent",
	titleColor: "#ffd400",
	nameColor: "#ffffff",
	prizes: [] as any[],
};

export const DEFAULT_PRIZE = {
	name: "",
	enabled: true,
	weight: 10,
	image: "",
	sound: "",
	volume: 1,
	blurb: "",
	effect: { kind: "none", seconds: 0, factor: 2, percent: 50, charges: 5, loopSound: "", loopVolume: 0.6, eventId: "", box: "", text: "" },
};

export const MAX_PRIZES = 30;
// how many prizes may fly past the marker on one spin. the spin always takes spinSec, so this is the reel's
// speed rather than its length — more prizes over the same seconds is a faster reel.
export const MIN_SPIN_TILES = 5;
export const MAX_SPIN_TILES = 200;

// every effect a prize can have, in the order the editor lists them. `needs` is what the tab has to ask for
// once that kind is picked — it's why the editor can show one set of inputs per kind without a switch.
export const EFFECT_KINDS: { key: string; label: string; needs: string[]; hint: string }[] = [
	{ key: "none", label: "Nothing (a dud)", needs: [], hint: "Lands, plays its sound, grants nothing. Rarity needs stakes." },
	{ key: "addTime", label: "Add time", needs: ["seconds"], hint: "Goes through the timer's own cap, exactly like a donation." },
	{ key: "removeTime", label: "Take time away", needs: ["seconds"], hint: "Ignored if the timer is at 0 with \"stop at zero\" on." },
	{ key: "pauseTimer", label: "Pause the timer", needs: ["seconds"], hint: "The countdown holds still, then carries on where it left off. Time won during a pause still counts." },
	{ key: "timebomb", label: "Timebomb (freeze chat can chain)", needs: ["seconds"], hint: "Freezes the countdown, and every contribution pushes the freeze back out to its full length again. Chat keeps it frozen by chaining subs and donations; it only lets go once they've gone this long without one. Time won during it still counts." },
	{ key: "timeBoost", label: "Multiply all contributions", needs: ["factor", "seconds", "loopSound"], hint: "A bonfire sale: for this long, every sub, cheer, donation and order grants multiplied time. A typed \"time\" command is left alone, so you can still correct the clock. Overlapping sales take the later end and the bigger multiplier rather than compounding." },
	{ key: "nuke", label: "Nuke chat", needs: ["percent", "seconds"], hint: "Times out a random share of the people who have actually typed in the last 10 minutes. Mods and the broadcaster are left out — Twitch refuses a timeout on them, so counting them would make the share a lie. Needs a bot account with mod powers in chat; until then it reports who it would have hit." },
	{ key: "raygun", label: "Ray gun (shots to spend later)", needs: ["charges", "seconds"], hint: "Credits the winner with shots they keep and fire whenever they like, with \"!raygun <name>\", timing that person out. A shot that doesn't land — a name nobody has, a mod Twitch refuses — is handed back. Needs a bot account with mod powers." },
	{ key: "playEvent", label: "Play an event clip", needs: ["eventId"], hint: "Fires one of your configured events on its own /events source, its delayed command included." },
	{ key: "textBox", label: "Set a text box", needs: ["box", "text", "seconds"], hint: "Puts words on a /text source. Seconds = how long before whatever was there goes back; 0 keeps them up." },
];

// the 4:3 stage every prize is laid out inside, scaled as one to whatever size the OBS source is — the same
// arrangement the firesale source uses, and for the same reason: the art and the type stay in proportion at
// 640x480 and at 1440x1080 alike.
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

export function canonPrize(raw: any, i: number) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_PRIZE;
	const e = r.effect && typeof r.effect === "object" ? r.effect : {};
	return {
		id: typeof r.id === "string" && r.id ? r.id : `p${i + 1}`,
		name: typeof r.name === "string" ? r.name.slice(0, 60).trim() : d.name,
		enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
		weight: numIn(r.weight, 0, 1000, d.weight),
		image: typeof r.image === "string" ? r.image.slice(0, 300) : d.image,
		sound: typeof r.sound === "string" ? r.sound.slice(0, 300) : d.sound,
		volume: Math.min(1, Math.max(0, Number.isFinite(Number(r.volume)) ? Number(r.volume) : d.volume)),
		blurb: typeof r.blurb === "string" ? r.blurb.slice(0, 120) : d.blurb,
		effect: {
			kind: EFFECT_KINDS.some((k) => k.key === e.kind) ? e.kind : "none",
			seconds: numIn(e.seconds, 0, 24 * 3600, 0),
			factor: Math.min(10, Math.max(1, Number.isFinite(Number(e.factor)) ? Number(e.factor) : 2)),
			percent: numIn(e.percent, 1, 100, 50),
			charges: numIn(e.charges, 1, 99, 5),
			loopSound: typeof e.loopSound === "string" ? e.loopSound.slice(0, 300) : "",
			loopVolume: Math.min(1, Math.max(0, Number.isFinite(Number(e.loopVolume)) ? Number(e.loopVolume) : 0.6)),
			eventId: typeof e.eventId === "string" ? e.eventId.slice(0, 100) : "",
			box: typeof e.box === "string" ? e.box.slice(0, 100) : "",
			text: typeof e.text === "string" ? e.text.slice(0, 500) : "",
		},
	};
}

// fill in whatever the server left out, so both the source and the dashboard always render a complete config
export function canonMysteryBox(raw: any) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_MYSTERYBOX;
	return {
		enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
		// trimmed, lowercased and cut to length exactly as the server does — this is the comparison the tab
		// uses to decide whether its draft has landed, so a field the server would tidy up (an uppercase
		// command, a stray space) would otherwise never compare equal and the box would snap back a few
		// seconds after you stopped typing
		command: (typeof r.command === "string" ? r.command.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.command,
		raygunCommand: (typeof r.raygunCommand === "string" ? r.raygunCommand.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.raygunCommand,
		grantOnFiresale: r.grantOnFiresale === undefined ? d.grantOnFiresale : !!r.grantOnFiresale,
		music: typeof r.music === "string" ? r.music.slice(0, 300) : d.music,
		volume: Math.min(1, Math.max(0, Number.isFinite(Number(r.volume)) ? Number(r.volume) : d.volume)),
		spinSec: numIn(r.spinSec, 1, 30, d.spinSec),
		spinTiles: numIn(r.spinTiles, MIN_SPIN_TILES, MAX_SPIN_TILES, d.spinTiles),
		revealHoldSec: numIn(r.revealHoldSec, 1, 60, d.revealHoldSec),
		bgColor: hexOr(r.bgColor, d.bgColor, "transparent"),
		titleColor: hexOr(r.titleColor, d.titleColor),
		nameColor: hexOr(r.nameColor, d.nameColor),
		prizes: (Array.isArray(r.prizes) ? r.prizes : []).map(canonPrize),
	};
}

// where a prize's art actually lives: a full url is used as-is, a bare filename is one of ours in
// public/prizes. the same split the timer events make between a media-folder file and a link.
export function prizeImageSrc(image: string): string {
	const s = String(image || "").trim();
	if (!s)
		return "";
	return /^https?:\/\//i.test(s) || s.startsWith("/") ? s : `/prizes/${encodeURIComponent(s)}`;
}

// one prize's chance of being drawn, as a percentage of the enabled pool. this is the number that tells the
// operator what "rarity 1 against three 10s" actually means, which raw weights never do.
export function prizeOdds(prizes: any[], prize: any): number {
	const total = prizes.reduce((sum, p) => sum + (p.enabled && p.weight > 0 ? p.weight : 0), 0);
	if (!total || !prize.enabled || prize.weight <= 0)
		return 0;
	return (prize.weight / total) * 100;
}

// mm:ss, clamped at zero — shared with the pause countdown on the dashboard
export function countdown(ms: number): string {
	const s = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
