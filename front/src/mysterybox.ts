// the mystery box, shared by the /mysterybox browser source and the dashboard tab that configures it, so what
// the operator sets up is what OBS draws. the settings live on the server — see back/src/mysterybox.ts, whose
// defaults and allowed values these MUST match, or a save would quietly reset a field the dashboard just set.

export const DEFAULT_MYSTERYBOX = {
	enabled: true,
	allowOpening: true,
	command: "mb",
	raygunCommand: "raygun",
	activeProfile: "",
	grantOnFiresale: true,
	firesaleItems: [] as string[],
	music: "",
	volume: 0.7,
	spinSec: 6,
	spinTiles: 20,
	revealHoldSec: 8,
	bgColor: "transparent",
	titleColor: "#ffd400",
	nameColor: "#ffffff",
	prizes: [] as any[],
	quickRevive: {
		seconds: 60,
		points: 10,
		title: "QUICK REVIVE",
		music: "",
		musicVolume: 0.6,
		winSound: "",
		winVolume: 1,
		winText: "REVIVED!",
		failSound: "",
		failVolume: 1,
		failText: "YOU DIED",
		holdSec: 8,
		announce: true,
	},
};

// the quick revive's own settings, tidied exactly as back/src/quickRevive.ts does — same reason as
// canonMysteryBox: this is what the tab compares against to know its draft has landed
export function canonQuickRevive(raw: any) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_MYSTERYBOX.quickRevive;
	const vol = (v: any, fallback: number) => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : fallback));
	const text = (v: any, fallback: string) => (typeof v === "string" ? v.slice(0, 80).trim() : "") || fallback;
	return {
		seconds: numIn(r.seconds, 5, 3600, d.seconds),
		points: numIn(r.points, 1, 100000, d.points),
		title: text(r.title, d.title),
		music: typeof r.music === "string" ? r.music.slice(0, 300) : d.music,
		musicVolume: vol(r.musicVolume, d.musicVolume),
		winSound: typeof r.winSound === "string" ? r.winSound.slice(0, 300) : d.winSound,
		winVolume: vol(r.winVolume, d.winVolume),
		winText: text(r.winText, d.winText),
		failSound: typeof r.failSound === "string" ? r.failSound.slice(0, 300) : d.failSound,
		failVolume: vol(r.failVolume, d.failVolume),
		failText: text(r.failText, d.failText),
		holdSec: numIn(r.holdSec, 1, 60, d.holdSec),
		announce: r.announce === undefined ? d.announce : !!r.announce,
	};
}

export const DEFAULT_PRIZE = {
	name: "",
	profile: "",
	enabled: true,
	weight: 10,
	image: "",
	sound: "",
	volume: 1,
	blurb: "",
	effect: { kind: "none", seconds: 0, factor: 2, percent: 50, charges: 5, boxes: 2, chants: [] as any[], rounds: 3, rewardSeconds: 300, streak: false, winSound: "", winVolume: 1, failSound: "", failVolume: 1, track: "", trackVolume: 0.8, ttsRate: 1, ttsPitch: 1, ttsVolume: 1, sayNames: false, timeoutSeconds: 600, loopSound: "", loopVolume: 0.6, freezeColor: "#5bd5ff", freezePulse: false, eventId: "", box: "", text: "" },
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
	{ key: "timebomb", label: "Timebomb (freeze chat can chain)", needs: ["seconds", "loopSound", "freezeColor"], hint: "Freezes the countdown, and every contribution pushes the freeze back out to its full length again. Chat keeps it frozen by chaining subs and donations; it only lets go once they've gone this long without one. Time won during it still counts." },
	{ key: "timeBoost", label: "Multiply all contributions", needs: ["factor", "seconds", "loopSound"], hint: "A bonfire sale: for this long, every sub, cheer, donation and order grants multiplied time. A typed \"time\" command is left alone, so you can still correct the clock. Overlapping sales take the later end and the bigger multiplier rather than compounding." },
	{ key: "nuke", label: "Nuke chat", needs: ["percent", "seconds"], hint: "Times out a random share of the people who have actually typed in the last 10 minutes. Mods and the broadcaster are left out — Twitch refuses a timeout on them, so counting them would make the share a lie. Needs a bot account with mod powers in chat; until then it reports who it would have hit." },
	{ key: "raygun", label: "Ray gun (shots to spend later)", needs: ["charges", "seconds"], hint: "Credits the winner with shots they keep and fire whenever they like, with \"!raygun <name>\", timing that person out. A shot that doesn't land — a name nobody has, a mod Twitch refuses — is handed back. Needs a bot account with mod powers." },
	{ key: "extraBoxes", label: "More mystery boxes", needs: ["boxes"], hint: "Hands the winner more boxes, which they can open straight away — so this one can chain into itself. The odds shown are for a single spin; set the rarity with that in mind. A test spin credits nobody." },
	{ key: "chant", label: "Chant rounds (say a phrase X times for time)", needs: ["chants", "rounds", "reward", "streak", "loopSound", "resultSounds"], hint: "WarioWare-style: each round draws one chant from the list at random — \"say movies 20 times in 60 seconds\" — and clearing it starts the next with a fresh clock. Clear every round and the time goes on the timer through the usual cap; run out of time in any round and it's over. Every chat line that contains the phrase counts once, whoever typed it. With \"in a row\" on, any line that doesn't say it puts the count back to zero (the bot's own lines don't). A test spin runs it for real." },
	{ key: "infection", label: "Infection (@ to spread, then timeouts)", needs: ["seconds", "timeoutSeconds", "loopSound", "endSound"], hint: "The opener is patient zero, announced in chat. Anyone infected can @ someone to infect them, and the clock and the infected count show on the Mystery Box source. When the time runs out, everyone infected is timed out. Mods and the broadcaster can't catch it — the only way a mod is in it is by opening the box — and are never timed out. Needs a bot account with mod powers; a test spin picks a random recent chatter as patient zero." },
	{ key: "jukebox", label: "Jukebox (a long track in the background)", needs: ["track"], hint: "Plays one clip through on the Mystery Box source — minutes long is fine — and gets out of the way: boxes keep opening over it, and it ends when the clip does. A second jukebox landing while one plays replaces it." },
	{ key: "schizo", label: "Schizo (chat read aloud)", needs: ["seconds", "tts"], hint: "For this long, every chat line is read out loud on the Mystery Box source in the browser's own built-in voice — no service, no AI, just the machine's text-to-speech. Commands and the bot's own lines are skipped, long lines are cut short, and if chat outruns the voice the oldest lines are dropped so it stays live. Boxes keep opening over it; a second one landing extends the time. In OBS the voice comes out of the system's speech engine, so it lands on the desktop audio device rather than the browser source's own audio track. Testing in an ordinary browser tab? Click the page once first — browsers refuse to speak until they've been clicked; OBS's source has no such rule." },
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
		profile: typeof r.profile === "string" ? r.profile.slice(0, 60).trim() : d.profile,
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
			boxes: numIn(e.boxes, 1, 99, 2),
			chants: (Array.isArray(e.chants) ? e.chants : (typeof e.phrase === "string" && e.phrase ? [{ phrase: e.phrase, times: e.times, seconds: e.seconds }] : []))
				.map((c: any) => ({
					phrase: typeof (c && c.phrase) === "string" ? c.phrase.slice(0, 60).trim() : "",
					times: numIn(c && c.times, 1, 10000, 20),
					seconds: numIn(c && c.seconds, 5, 3600, 60),
				}))
				.filter((c: any) => c.phrase)
				.slice(0, 20),
			rounds: numIn(e.rounds, 1, 50, Array.isArray(e.chants) ? 3 : 1),
			rewardSeconds: numIn(e.rewardSeconds, 0, 24 * 3600, 300),
			streak: !!e.streak,
			winSound: typeof e.winSound === "string" ? e.winSound.slice(0, 300) : "",
			winVolume: Math.min(1, Math.max(0, Number.isFinite(Number(e.winVolume)) ? Number(e.winVolume) : 1)),
			failSound: typeof e.failSound === "string" ? e.failSound.slice(0, 300) : "",
			failVolume: Math.min(1, Math.max(0, Number.isFinite(Number(e.failVolume)) ? Number(e.failVolume) : 1)),
			timeoutSeconds: numIn(e.timeoutSeconds, 1, 3600, 600),
			track: typeof e.track === "string" ? e.track.slice(0, 300) : "",
			trackVolume: Math.min(1, Math.max(0, Number.isFinite(Number(e.trackVolume)) ? Number(e.trackVolume) : 0.8)),
			ttsRate: Math.min(2, Math.max(0.5, Number.isFinite(Number(e.ttsRate)) ? Number(e.ttsRate) : 1)),
			ttsPitch: Math.min(2, Math.max(0, Number.isFinite(Number(e.ttsPitch)) ? Number(e.ttsPitch) : 1)),
			ttsVolume: Math.min(1, Math.max(0, Number.isFinite(Number(e.ttsVolume)) ? Number(e.ttsVolume) : 1)),
			sayNames: !!e.sayNames,
			loopSound: typeof e.loopSound === "string" ? e.loopSound.slice(0, 300) : "",
			loopVolume: Math.min(1, Math.max(0, Number.isFinite(Number(e.loopVolume)) ? Number(e.loopVolume) : 0.6)),
			freezeColor: HEX.test(String(e.freezeColor || "").trim()) ? String(e.freezeColor).trim() : "",
			freezePulse: !!e.freezePulse,
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
		allowOpening: r.allowOpening === undefined ? d.allowOpening : !!r.allowOpening,
		// trimmed, lowercased and cut to length exactly as the server does — this is the comparison the tab
		// uses to decide whether its draft has landed, so a field the server would tidy up (an uppercase
		// command, a stray space) would otherwise never compare equal and the box would snap back a few
		// seconds after you stopped typing
		command: (typeof r.command === "string" ? r.command.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.command,
		raygunCommand: (typeof r.raygunCommand === "string" ? r.raygunCommand.trim().replace(/^!/, "").toLowerCase().slice(0, 30) : "") || d.raygunCommand,
		activeProfile: typeof r.activeProfile === "string" ? r.activeProfile.slice(0, 60).trim() : "",
		grantOnFiresale: r.grantOnFiresale === undefined ? d.grantOnFiresale : !!r.grantOnFiresale,
		firesaleItems: Array.isArray(r.firesaleItems)
			? r.firesaleItems
				.map((v: any) => (typeof v === "string" ? v.slice(0, 200).trim() : ""))
				.filter((v: string, i: number, all: string[]) => v && all.indexOf(v) === i)
				.slice(0, 50)
			: d.firesaleItems,
		music: typeof r.music === "string" ? r.music.slice(0, 300) : d.music,
		volume: Math.min(1, Math.max(0, Number.isFinite(Number(r.volume)) ? Number(r.volume) : d.volume)),
		spinSec: numIn(r.spinSec, 1, 30, d.spinSec),
		spinTiles: numIn(r.spinTiles, MIN_SPIN_TILES, MAX_SPIN_TILES, d.spinTiles),
		revealHoldSec: numIn(r.revealHoldSec, 1, 60, d.revealHoldSec),
		bgColor: hexOr(r.bgColor, d.bgColor, "transparent"),
		titleColor: hexOr(r.titleColor, d.titleColor),
		nameColor: hexOr(r.nameColor, d.nameColor),
		prizes: (Array.isArray(r.prizes) ? r.prizes : []).map(canonPrize),
		quickRevive: canonQuickRevive(r.quickRevive),
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

// is this prize in the set currently in play? no profile = always; a profile = only while it's selected.
// mirrors inActiveProfile on the server.
export function inActiveProfile(activeProfile: string, prize: any): boolean {
	return !prize.profile || prize.profile === activeProfile;
}

// one prize's chance of being drawn, as a percentage of the pool that's actually in play. this is the number
// that tells the operator what "rarity 1 against three 10s" actually means, which raw weights never do —
// and it has to be against the CURRENT profile, or switching profiles would leave every figure on the tab
// quietly describing a draw that can't happen.
export function prizeOdds(prizes: any[], prize: any, activeProfile = ""): number {
	const live = (p: any) => p.enabled && p.weight > 0 && inActiveProfile(activeProfile, p);
	const total = prizes.reduce((sum, p) => sum + (live(p) ? p.weight : 0), 0);
	if (!total || !live(prize))
		return 0;
	return (prize.weight / total) * 100;
}

// every profile any prize has been put in, for the picker. derived from the prizes rather than kept as its
// own list: a profile with nothing in it does nothing, so naming one on a prize is all it should take to
// create it — and deleting the last prize in a profile should make it go away by itself.
export function prizeProfiles(prizes: any[], activeProfile = ""): string[] {
	const seen = new Set<string>();
	for (const p of prizes)
		if (p.profile)
			seen.add(p.profile);
	if (activeProfile)
		seen.add(activeProfile); // keep a selected-but-now-empty profile visible rather than silently dropping it
	return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

// mm:ss, clamped at zero — shared with the pause countdown on the dashboard
export function countdown(ms: number): string {
	const s = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
