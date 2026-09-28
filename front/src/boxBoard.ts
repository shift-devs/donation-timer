// the box leaderboard, shared by the dashboard tab and the /boxboard source. the settings live on the server —
// see back/src/boxBoard.ts, whose defaults and limits these MUST match, or a save would quietly reset a field
// the dashboard just set.

export const DEFAULT_BOX_BOARD = {
	title: "TOP BOX BUYERS",
	top: 5,
	products: [] as { id: string, name: string }[],
	countOrders: true,
	countFiresales: true,
	showCounts: true,
	fontSize: 36,
	bgColor: "transparent",
	titleColor: "#ffd400",
	nameColor: "#ffffff",
	countColor: "#22c55e",
};

export const MAX_BOARD_TOP = 25;

// gold, silver, bronze for the first three places
export const PLACE_COLORS = ["#ffd400", "#d8dee9", "#e08a3c"];

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

function products(raw: any): { id: string, name: string }[] {
	if (!Array.isArray(raw))
		return [];
	const out: { id: string, name: string }[] = [];
	for (const p of raw) {
		const id = p && typeof p.id === "string" ? p.id.trim().slice(0, 100) : "";
		if (!id || out.some((o) => o.id === id) || out.length >= 100)
			continue;
		out.push({ id, name: typeof p.name === "string" ? p.name.slice(0, 200) : "" });
	}
	return out;
}

// fill in whatever the server left out, tidied exactly as the server tidies it
export function canonBoxBoard(raw: any) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_BOX_BOARD;
	return {
		title: typeof r.title === "string" ? r.title.slice(0, 60) : d.title,
		top: numIn(r.top, 1, MAX_BOARD_TOP, d.top),
		products: r.products === undefined ? d.products : products(r.products),
		countOrders: r.countOrders === undefined ? d.countOrders : !!r.countOrders,
		countFiresales: r.countFiresales === undefined ? d.countFiresales : !!r.countFiresales,
		showCounts: r.showCounts === undefined ? d.showCounts : !!r.showCounts,
		fontSize: numIn(r.fontSize, 12, 120, d.fontSize),
		bgColor: hexOr(r.bgColor, d.bgColor, "transparent"),
		titleColor: hexOr(r.titleColor, d.titleColor),
		nameColor: hexOr(r.nameColor, d.nameColor),
		countColor: hexOr(r.countColor, d.countColor),
	};
}
