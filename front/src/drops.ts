// drops, shared by the dashboard tab and anything else that reads the config. the settings live on the
// server — see back/src/drops.ts, whose defaults and allowed values these MUST match, or the tab's draft would
// never compare equal to what came back and would snap back a few seconds after an edit.

import { canonPrize, DEFAULT_PRIZE, EFFECT_KINDS } from "./mysterybox";

// the rewards that are a minigame of their own, which a drop — already a minigame — can't pay out
export const NOT_A_DROP = ["chant", "infection"];
export const REWARD_KINDS = EFFECT_KINDS.filter((k) => !NOT_A_DROP.includes(k.key));

export const GAME_KINDS: { key: string; label: string; hint: string }[] = [
	{ key: "chant", label: "Say a word X times", hint: "Every chat line that contains the phrase counts once, whoever typed it. One phrase is drawn from the list for each drop. With \"in a row\" on, any other line resets the count." },
	{ key: "count", label: "Count from A to B", hint: "Chat counts one number per message. The same person can't say two in a row, and anything that isn't a number is ignored. Counting down works too (set From above To)." },
	{ key: "subpoints", label: "Sub points", hint: "Like the quick revive: Tier 1 and Prime count 1, Tier 2 counts 2, Tier 3 counts 6, a gift bomb counts every sub. A YouTube or Kick membership counts 1. Whoever gifted the last of them is who a personal reward goes to." },
	{ key: "scramble", label: "Unscramble a word", hint: "The word goes up with its letters shuffled; the first chatter to type it gets it for chat. One word is drawn from the list for each drop. Punctuation and spaces don't matter." },
	{ key: "secret", label: "Guess a secret phrase", hint: "A hint goes up and the first chatter to type the phrase it points at gets it for chat. Each phrase can have several hints: one phrase is drawn for each drop, then one of its hints. A guess counts if the phrase is anywhere in the line, so \"is it zombies?\" lands — capitals, spaces and punctuation don't matter. The phrase itself is never shown until it's been got or the clock runs out." },
];

export const DEFAULT_POOL = {
	name: "Standard",
};

export const DEFAULT_GAME = {
	name: "",
	enabled: true,
	kind: "chant",
	seconds: 60,
	pool: "",
	words: [] as string[],
	secrets: [] as { phrase: string; hints: string[] }[],
	times: 20,
	streak: false,
	from: 1,
	to: 50,
	resetOnMistake: true,
	points: 10,
};

export const DEFAULT_DROPS = {
	enabled: false,
	chance: 0.5,
	maxPerHour: 4,
	guaranteeEnabled: true,
	guaranteeMin: 45,
	guaranteeMax: 60,
	title: "DROP!",
	dropSound: "",
	dropVolume: 1,
	music: "",
	musicVolume: 0.6,
	winSound: "",
	winVolume: 1,
	winText: "GRABBED IT!",
	failSound: "",
	failVolume: 1,
	failText: "TOO SLOW!",
	holdSec: 8,
	announce: true,
	pools: [] as any[],
	rewards: [] as any[],
	games: [] as any[],
};

export const MAX_REWARDS = 30;
export const MAX_GAMES = 30;
export const MAX_POOLS = 10;
export const MAX_SECRETS = 50;
export const MAX_HINTS = 20;

export { DEFAULT_PRIZE };

function numIn(v: any, min: number, max: number, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function vol(v: any, fallback: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : fallback));
}

function text(v: any, fallback: string): string {
	return (typeof v === "string" ? v.slice(0, 80).trim() : "") || fallback;
}

function path(v: any): string {
	return typeof v === "string" ? v.slice(0, 300) : "";
}

function uniqueIds(list: any[]): any[] {
	const seen = new Set<string>();
	return list.map((x, i) => {
		const id = seen.has(x.id) ? `${x.id}_${i}` : x.id;
		seen.add(id);
		return id === x.id ? x : { ...x, id };
	});
}

// the pools, and there's always one so every reward and game has somewhere to be
export function canonPools(raw: any): any[] {
	const out: any[] = [];
	const seen = new Set<string>();
	if (Array.isArray(raw)) {
		for (let i = 0; i < raw.length && out.length < MAX_POOLS; i++) {
			const p = raw[i];
			if (!p || typeof p !== "object")
				continue;
			let id = typeof p.id === "string" && p.id ? p.id.slice(0, 100) : `pool${i + 1}`;
			if (seen.has(id))
				id = `${id}_${i}`;
			seen.add(id);
			out.push({ id, name: (typeof p.name === "string" ? p.name.slice(0, 60).trim() : "") || `Pool ${out.length + 1}` });
		}
	}
	if (!out.length)
		out.push({ id: "pool1", name: DEFAULT_POOL.name });
	return out;
}

function poolIn(pools: any[], v: any): string {
	return pools.some((p) => p.id === v) ? v : pools[0].id;
}

export function canonGame(raw: any, i: number, pools: any[]) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_GAME;
	return {
		id: typeof r.id === "string" && r.id ? r.id.slice(0, 100) : `g${i + 1}`,
		name: typeof r.name === "string" ? r.name.slice(0, 60).trim() : "",
		enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
		kind: GAME_KINDS.some((k) => k.key === r.kind) ? r.kind : d.kind,
		seconds: numIn(r.seconds, 5, 3600, d.seconds),
		pool: poolIn(pools, r.pool),
		words: Array.isArray(r.words)
			? r.words
				.map((w: any) => (typeof w === "string" ? w.slice(0, 60).trim() : ""))
				.filter((w: string, j: number, all: string[]) => w && all.indexOf(w) === j)
				.slice(0, 50)
			: [],
		secrets: Array.isArray(r.secrets)
			? r.secrets
				.filter((s: any) => s && typeof s === "object")
				.slice(0, MAX_SECRETS)
				.map((s: any) => ({
					phrase: typeof s.phrase === "string" ? s.phrase.slice(0, 60).trim() : "",
					hints: Array.isArray(s.hints)
						? s.hints
							.map((h: any) => (typeof h === "string" ? h.slice(0, 120).trim() : ""))
							.filter((h: string, j: number, all: string[]) => h && all.indexOf(h) === j)
							.slice(0, MAX_HINTS)
						: [],
				}))
			: [],
		times: numIn(r.times, 1, 10000, d.times),
		streak: !!r.streak,
		from: numIn(r.from, -100000, 100000, d.from),
		to: numIn(r.to, -100000, 100000, d.to),
		resetOnMistake: r.resetOnMistake === undefined ? d.resetOnMistake : !!r.resetOnMistake,
		points: numIn(r.points, 1, 100000, d.points),
	};
}

export function canonDrops(raw: any) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_DROPS;
	const lo = numIn(r.guaranteeMin, 1, 600, d.guaranteeMin);
	const chance = Number(r.chance);
	const pools = canonPools(r.pools);
	const rawRewards: any[] = (Array.isArray(r.rewards) ? r.rewards : []).filter((p: any) => p && typeof p === "object").slice(0, MAX_REWARDS);
	return {
		enabled: r.enabled === undefined ? d.enabled : !!r.enabled,
		chance: Number.isFinite(chance) ? Math.min(100, Math.max(0, Math.round(chance * 100) / 100)) : d.chance,
		maxPerHour: numIn(r.maxPerHour, 1, 60, d.maxPerHour),
		guaranteeEnabled: r.guaranteeEnabled === undefined ? d.guaranteeEnabled : !!r.guaranteeEnabled,
		guaranteeMin: lo,
		guaranteeMax: Math.max(lo, numIn(r.guaranteeMax, 1, 600, d.guaranteeMax)),
		title: text(r.title, d.title),
		dropSound: path(r.dropSound),
		dropVolume: vol(r.dropVolume, d.dropVolume),
		music: path(r.music),
		musicVolume: vol(r.musicVolume, d.musicVolume),
		winSound: path(r.winSound),
		winVolume: vol(r.winVolume, d.winVolume),
		winText: text(r.winText, d.winText),
		failSound: path(r.failSound),
		failVolume: vol(r.failVolume, d.failVolume),
		failText: text(r.failText, d.failText),
		holdSec: numIn(r.holdSec, 1, 60, d.holdSec),
		announce: r.announce === undefined ? d.announce : !!r.announce,
		pools,
		rewards: uniqueIds(rawRewards.map(canonPrize)).map((p: any, i: number) => ({
			...p,
			profile: "",
			pool: poolIn(pools, rawRewards[i].pool),
			effect: NOT_A_DROP.includes(p.effect.kind) ? { ...p.effect, kind: "none" } : p.effect,
		})),
		games: uniqueIds((Array.isArray(r.games) ? r.games : []).filter((g: any) => g && typeof g === "object").slice(0, MAX_GAMES).map((g: any, i: number) => canonGame(g, i, pools))),
	};
}

// can this reward drop
export function rewardLive(p: any): boolean {
	return p.enabled && p.weight > 0;
}

// one reward's share of the draw, as a percentage of its own pool's rewards that can drop
export function rewardOdds(rewards: any[], reward: any): number {
	const live = (p: any) => rewardLive(p) && p.pool === reward.pool;
	const total = rewards.reduce((sum, p) => sum + (live(p) ? p.weight : 0), 0);
	if (!total || !live(reward))
		return 0;
	return (reward.weight / total) * 100;
}

// a secret phrase that can go up: it has a phrase, and at least one hint
export function secretReady(s: any): boolean {
	return !!(s.phrase && s.hints.length);
}

// can this minigame actually be played — the word games need words, a count needs somewhere to go, a
// secret needs a phrase with a hint
export function gamePlayable(g: any): boolean {
	if (!g.enabled)
		return false;
	if (g.kind === "chant" || g.kind === "scramble")
		return g.words.length > 0;
	if (g.kind === "secret")
		return g.secrets.some(secretReady);
	if (g.kind === "count")
		return g.from !== g.to;
	return true;
}

// can this minigame go up: playable, and with something in its pool to hand out
export function gameArmed(g: any, rewards: any[]): boolean {
	return gamePlayable(g) && rewards.some((p) => rewardLive(p) && p.pool === g.pool);
}

// how likely an hour is to see at least one rolled drop, for the tab to put the chance in terms that mean
// something: contributions per hour → odds of one or more
export function chanceOfAny(percent: number, contributions: number): number {
	const p = Math.min(1, Math.max(0, percent / 100));
	return (1 - Math.pow(1 - p, Math.max(0, contributions))) * 100;
}
