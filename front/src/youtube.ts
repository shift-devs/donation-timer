// youtube link -> video id + start offset. used by the timer-events editor (to validate what's pasted) and by the
// /events browser source (to build the embed). accepts the shapes people actually paste: watch?v=, youtu.be/,
// /shorts/, /live/, /embed/, /v/, or a bare id. the link's t / start param becomes the clip's start offset.

const ID_RE = /^[\w-]{11}$/;
const PATH_PREFIXES = ["shorts", "live", "embed", "v"];

// "90" | "90s" | "1m30s" | "1h2m3s" -> seconds
function parseTimeParam(raw: string | null): number {
	const v = (raw || "").trim().toLowerCase();
	if (!v)
		return 0;
	if (/^\d+$/.test(v))
		return parseInt(v, 10);
	const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
	if (!m || (!m[1] && !m[2] && !m[3]))
		return 0;
	return ((parseInt(m[1] || "0", 10) * 3600) + (parseInt(m[2] || "0", 10) * 60) + parseInt(m[3] || "0", 10));
}

export function parseYouTube(raw: string): { id: string; start: number } | null {
	const str = (raw || "").trim();
	if (!str)
		return null;
	if (ID_RE.test(str))
		return { id: str, start: 0 };

	let url: URL;
	try {
		// tolerate a pasted link with no scheme ("youtu.be/abc")
		url = new URL(/^https?:\/\//i.test(str) ? str : `https://${str}`);
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^www\./i, "").toLowerCase();
	if (host !== "youtu.be" && host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com")
		return null;

	const segs = url.pathname.split("/").filter(Boolean);
	let id = "";
	if (host === "youtu.be")
		id = segs[0] || "";
	else if (url.pathname === "/watch")
		id = url.searchParams.get("v") || "";
	else if (segs.length >= 2 && PATH_PREFIXES.includes(segs[0].toLowerCase()))
		id = segs[1];

	if (!ID_RE.test(id))
		return null;
	const start = parseTimeParam(url.searchParams.get("t") || url.searchParams.get("start"));
	return { id, start };
}
