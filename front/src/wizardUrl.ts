// paste-to-edit for the browser-source builders: pull the query off a URL that a wizard produced so it can
// be loaded back in and adjusted, instead of rebuilding the look from scratch to change one colour.
//
// the readers below mirror what each source page accepts and fall back to whatever the wizard already had,
// so a URL that predates a field (or has one hand-mangled) leaves that control alone rather than resetting
// it to a default. the token is deliberately never read back — the wizard always stamps in the identity of
// the dashboard doing the editing.
const HEX = /^#[0-9a-fA-F]{6}$/;

export function parseSourceUrl(text: string, expectedPath: string): URLSearchParams | null {
	const raw = (text || "").trim();
	if (!raw)
		return null;
	let u: URL;
	try {
		// second arg tolerates a bare "/widget?..." paste as well as a full URL
		u = new URL(raw, window.location.origin);
	} catch {
		return null;
	}
	if (u.pathname.replace(/\/+$/, "") !== expectedPath)
		return null;
	return u.searchParams;
}

// `extra` allows one non-hex keyword through, e.g. the timer background's "transparent"
export function hexParam(sp: URLSearchParams, key: string, fallback: string, extra?: string): string {
	const v = (sp.get(key) || "").trim();
	if (extra && v === extra)
		return v;
	return HEX.test(v) ? v : fallback;
}

export function oneOfParam(sp: URLSearchParams, key: string, allowed: string[], fallback: string): string {
	const v = (sp.get(key) || "").trim();
	return allowed.includes(v) ? v : fallback;
}

export function intParam(sp: URLSearchParams, key: string, min: number, max: number, fallback: number): number {
	if (!sp.has(key))
		return fallback;
	const n = Number(sp.get(key));
	if (!Number.isFinite(n))
		return fallback;
	return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function textParam(sp: URLSearchParams, key: string, fallback: string, max = 200): string {
	const v = sp.get(key);
	return typeof v === "string" ? v.slice(0, max) : fallback;
}
