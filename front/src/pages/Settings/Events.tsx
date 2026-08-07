import React, { useEffect, useRef, useState } from "react";
import {
	Badge,
	Box,
	Button,
	Code,
	Divider,
	Flex,
	HStack,
	Input,
	InputGroup,
	InputLeftElement,
	NumberInput,
	NumberInputField,
	Select,
	Slider,
	SliderFilledTrack,
	SliderThumb,
	SliderTrack,
	Spacer,
	Switch,
	Tag,
	TagCloseButton,
	TagLabel,
	Text,
	VStack,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import { setTimerEvents, setEventLayers, testTimerEvent } from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import { BASE_URL } from "../../Consts";
import { parseYouTube } from "../../youtube";

// media files found in public/media at build time (vite.config.ts bakes the list in) — the
// dropdown lists these and only these; audio-vs-video is derived from the chosen file's extension
const MEDIA_FILES: string[] = typeof __MEDIA_FILES__ !== "undefined" ? __MEDIA_FILES__ : [];
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i;

// the path half of a media src. a direct link carries a query string ("?rlkey=…&raw=1"), and testing the
// whole thing for an extension would never match.
function srcPath(s: string): string {
	const cut = (s || "").search(/[?#]/);
	return cut === -1 ? (s || "") : s.slice(0, cut);
}

// what a direct link should play as. unknown extensions read as video rather than audio: a cdn url often
// has no extension at all, and a <video> with an audio-only file still plays it — the reverse loses picture.
const linkKind = (url: string) => (AUDIO_RE.test(srcPath(url)) ? "audio" : "video");

// dropbox's "copy link" hands over a preview PAGE (?dl=0), not the file, so a <video> pointed at it receives
// html and silently plays nothing. raw=1 makes dropbox stream the bytes instead. we rewrite it here rather
// than asking whoever pastes the link to edit a query string, and rlkey is carried over untouched because
// the link 404s without it. anything that isn't a dropbox.com url — a cdn, or the dl.dropboxusercontent.com
// host dropbox itself redirects to — is already a direct file and passes through.
function normalizeMediaUrl(raw: string): string {
	const url = (raw || "").trim();
	if (!/^https?:\/\//i.test(url))
		return url;
	try {
		const u = new URL(url);
		if (!/(^|\.)dropbox\.com$/i.test(u.hostname))
			return url;
		u.searchParams.delete("dl");
		u.searchParams.set("raw", "1");
		return u.toString();
	} catch {
		return url; // unparseable — leave what they typed alone rather than mangling it
	}
}

// would saving rewrite this link? drives the hint under the box, so the change is never a surprise
const willRewrite = (url: string) => !!url.trim() && normalizeMediaUrl(url) !== url.trim();

// links the page's own <video> cannot play, each with its fix. worth catching while someone is pasting:
// dropped into a browser source these fail silently — no picture, no error, nothing to say why. the two
// that actually come up are bunny stream's outputs, since its dashboard offers them before the mp4.
function linkProblem(url: string): string {
	const u = (url || "").trim();
	if (!u)
		return "";
	if (/^https?:\/\/iframe\.mediadelivery\.net\//i.test(u))
		return "That's a Bunny Stream player embed, which brings its own controls and branding. Use the library's direct MP4 URL instead.";
	if (/\.(m3u8|mpd)$/i.test(srcPath(u)))
		return "HLS/DASH streams don't play here — this page uses a plain video element. Use a direct MP4 URL (on Bunny Stream, switch MP4 fallback on in the library settings).";
	return "";
}

// the kinds of trigger an event can carry. daily/once come off the clock; the rest off live platform traffic.
const TRIGGER_TYPES = [
	{ value: "daily", label: "Daily at" },
	{ value: "once", label: "Once at" },
	{ value: "gift", label: "Gifted subs" },
	{ value: "donation", label: "Donation" },
	{ value: "fwproduct", label: "Product bought" },
];

// services that relay gifted subs/memberships, for the gifted-subs trigger. mirrors the server's list.
const GIFT_PLATFORMS = [
	{ value: "any", label: "any service" },
	{ value: "twitch", label: "Twitch" },
	{ value: "youtube", label: "YouTube" },
	{ value: "kick", label: "Kick" },
];

// the money events a donation trigger can watch. mirrors DONATION_SOURCES on the server — keep the values
// identical or a saved trigger silently falls back to "any".
const DONATION_SOURCES = [
	{ value: "any", label: "any source" },
	{ value: "streamlabs_donation", label: "Streamlabs donation" },
	{ value: "streamlabs_merch", label: "Streamlabs merch" },
	{ value: "youtube_superchat", label: "YouTube Super Chat" },
	{ value: "fourthwall_order", label: "Fourthwall order" },
	{ value: "fourthwall_donation", label: "Fourthwall donation" },
];

const hasValue = (list: { value: string }[], v: any) => list.some((x) => x.value === v);

// ---- shape helpers -------------------------------------------------------------------------------------------------
// canonical shape == what the server stores (min/max as ms|null). edit shape keeps min/max as "HH:MM:SS" strings and
// the command delay as raw text so typing doesn't fight a formatter — a half-typed "1." parses to 1 and a numeric
// value prop would rewrite the box mid-keystroke, eating the dot. it also splits the single canonical mediaSrc into
// a picked file and a typed youtube url so flipping the source dropdown doesn't discard the other one. we convert at
// the save/load boundary and compare canonical projections — so the edit-only keys must never displace a canonical
// key's position, or every event would read as dirty forever. triggers follow the same rules one level down.

const uid = () =>
	(typeof crypto !== "undefined" && (crypto as any).randomUUID)
		? (crypto as any).randomUUID()
		: `e${Date.now()}${Math.floor(Math.random() * 1e6)}`;

// this browser's iana zone — daily triggers resolve in it on the server (whose container clock is usually UTC)
function browserTz(): string {
	try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}

// an unset bound/trim comes back as null, and Number(null) is 0 — so screen those out before coercing, or a
// blank max would reload as 0 and the next save would pin the range shut
function numOrNull(v: any): number | null {
	if (v == null || v === "")
		return null;
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

// same, to the cent, for the dollar bounds
function usdOrNull(v: any): number | null {
	if (v == null || v === "")
		return null;
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function parseHMS(s: string): number | null {
	const str = (s || "").trim();
	if (!str) return null; // blank = unbounded
	const parts = str.split(":").map((x) => parseInt(x, 10));
	if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
	let h = 0, m = 0, sec = 0;
	if (parts.length === 3) [h, m, sec] = parts;
	else if (parts.length === 2) [m, sec] = parts;
	else if (parts.length === 1) [sec] = parts;
	else return null;
	return ((h * 3600) + (m * 60) + sec) * 1000;
}

// a gifted-subs count box: blank = no limit on that side
const parseCount = (s: string) => numOrNull((s || "").trim());
const fmtCount = (n: number | null) => (n == null ? "" : String(n));

// a dollar box: blank = no limit on that side. a typed "$" is tolerated since the field shows one.
const parseUsd = (s: string) => usdOrNull((s || "").trim().replace(/^\$/, ""));
const fmtUsd = (n: number | null) => (n == null ? "" : String(n));

// command delay text -> seconds. decimals allowed (the backend takes them); junk/blank reads as 0 and the
// 24h ceiling mirrors the server's clamp
function parseDelaySec(s: string): number {
	const n = Number((s || "").trim());
	return Number.isFinite(n) && n > 0 ? Math.min(86400, n) : 0;
}

// clip start/end boxes: same lenient grammar as the window boxes, but in whole seconds into the media
// ("30" = 0:30, "1:05" = 65s). blank = the media's own start/end. the ceiling mirrors the server's clamp.
function parseClip(s: string): number | null {
	const ms = parseHMS(s);
	return ms == null ? null : Math.min(86400, Math.round(ms / 1000));
}
function fmtClip(sec: number | null): string {
	if (sec == null) return "";
	const m = Math.floor(sec / 60), s = sec % 60;
	return m >= 60 ? fmtHMS(sec * 1000) : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtHMS(ms: number | null): string {
	if (ms == null) return "";
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// epoch ms <-> the value an <input type="datetime-local"> expects (local "YYYY-MM-DDTHH:MM")
function toLocalInput(ms: number): string {
	if (!ms) return "";
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s: string): number {
	const t = new Date(s).getTime();
	return Number.isFinite(t) ? t : 0;
}

// ---- triggers ---------------------------------------------------------------------------------------------------
// a trigger carries every type's fields, not just its own, so flipping the type dropdown doesn't discard what
// was typed under the previous one (same reasoning as the media file/url pair).

function canonTrigger(raw: any) {
	const r = raw || {};
	return {
		id: typeof r.id === "string" && r.id ? r.id : uid(),
		type: hasValue(TRIGGER_TYPES, r.type) ? r.type : "daily",
		dailyTime: typeof r.dailyTime === "string" && r.dailyTime ? r.dailyTime : "00:00",
		tz: typeof r.tz === "string" && r.tz ? r.tz : browserTz(),
		onceAt: Number.isFinite(Number(r.onceAt)) ? Math.round(Number(r.onceAt)) : 0,
		giftPlatform: hasValue(GIFT_PLATFORMS, r.giftPlatform) ? r.giftPlatform : "any",
		giftMinCount: numOrNull(r.giftMinCount),
		giftMaxCount: numOrNull(r.giftMaxCount),
		donSource: hasValue(DONATION_SOURCES, r.donSource) ? r.donSource : "any",
		donMinUsd: usdOrNull(r.donMinUsd),
		donMaxUsd: usdOrNull(r.donMaxUsd),
		fwOfferIds: Array.isArray(r.fwOfferIds) ? r.fwOfferIds.filter((x: any) => typeof x === "string" && x) : [],
		fwMinQty: numOrNull(r.fwMinQty),
		fwMaxQty: numOrNull(r.fwMaxQty),
	};
}

const toEditTrigger = (t: any) => ({
	...t,
	giftMin: fmtCount(t.giftMinCount),
	giftMax: fmtCount(t.giftMaxCount),
	donMin: fmtUsd(t.donMinUsd),
	donMax: fmtUsd(t.donMaxUsd),
	fwMin: fmtCount(t.fwMinQty),
	fwMax: fmtCount(t.fwMaxQty),
});

function toCanonTrigger(t: any) {
	const { giftMin, giftMax, donMin, donMax, fwMin, fwMax, ...rest } = t;
	return {
		...rest,
		giftMinCount: parseCount(giftMin),
		giftMaxCount: parseCount(giftMax),
		donMinUsd: parseUsd(donMin),
		donMaxUsd: parseUsd(donMax),
		fwMinQty: parseCount(fwMin),
		fwMaxQty: parseCount(fwMax),
	};
}

const defaultTrigger = () => toEditTrigger(canonTrigger({ id: uid(), type: "daily", onceAt: Date.now() }));

// a range that can never match — nothing would ever fire, so warn instead of letting it look armed
function rangeIsBackwards(lo: number | null, hi: number | null): boolean {
	return lo != null && hi != null && hi < lo;
}
const giftBackwards = (t: any) => rangeIsBackwards(parseCount(t.giftMin), parseCount(t.giftMax));
const donBackwards = (t: any) => rangeIsBackwards(parseUsd(t.donMin), parseUsd(t.donMax));
const fwBackwards = (t: any) => rangeIsBackwards(parseCount(t.fwMin), parseCount(t.fwMax));

// ---- events -----------------------------------------------------------------------------------------------------

// coerce server data into a complete canonical event (fills any missing fields with defaults)
function canonFromServer(raw: any) {
	const r = raw || {};
	const end = numOrNull(r.clipEndSec);
	// events saved before triggers became a list carried a single inline trigger. the server upgrades those as it
	// loads them, but keep the fallback so a stale payload still opens with something to edit.
	const triggers = Array.isArray(r.triggers) ? r.triggers : [{
		type: r.triggerType,
		dailyTime: r.dailyTime,
		tz: r.tz,
		onceAt: r.onceAt,
		giftPlatform: r.giftPlatform,
		giftMinCount: r.giftMinCount,
		giftMaxCount: r.giftMaxCount,
	}];
	return {
		id: typeof r.id === "string" && r.id ? r.id : uid(),
		name: typeof r.name === "string" ? r.name : "",
		enabled: r.enabled !== false,
		// "" = the default browser source, i.e. the /events url with no ?layer=
		layerId: typeof r.layerId === "string" ? r.layerId : "",
		triggers: triggers.map(canonTrigger),
		minRemainingMs: numOrNull(r.minRemainingMs),
		maxRemainingMs: numOrNull(r.maxRemainingMs),
		mediaKind: r.mediaKind === "video" ? "video" : r.mediaKind === "youtube" ? "youtube" : "audio",
		mediaSrc: typeof r.mediaSrc === "string" ? r.mediaSrc : "",
		clipStartSec: numOrNull(r.clipStartSec),
		// same drop rule the server applies, so a stale row can't load as a window the editor would never save
		clipEndSec: end != null && end <= (numOrNull(r.clipStartSec) || 0) ? null : end,
		volume: Number.isFinite(Number(r.volume)) ? Math.min(1, Math.max(0, Number(r.volume))) : 1,
		cmdText: typeof r.cmdText === "string" ? r.cmdText : "",
		cmdDelaySec: Number.isFinite(Number(r.cmdDelaySec)) && Number(r.cmdDelaySec) >= 0 ? Number(r.cmdDelaySec) : 0,
	};
}

const toEdit = (c: any) => {
	const { cmdDelaySec, ...rest } = c;
	const yt = c.mediaKind === "youtube";
	return {
		...rest,
		triggers: c.triggers.map(toEditTrigger),
		minRemaining: fmtHMS(c.minRemainingMs),
		maxRemaining: fmtHMS(c.maxRemainingMs),
		cmdDelay: String(cmdDelaySec ?? 0),
		// a saved src is a media-folder path, a youtube link, or a direct url — split them apart so flipping
		// the dropdown keeps whatever was set under the other two
		source: yt ? "youtube" : /^https?:\/\//i.test(c.mediaSrc || "") ? "link" : "file",
		fileSrc: yt || /^https?:\/\//i.test(c.mediaSrc || "") ? "" : c.mediaSrc,
		ytUrl: yt ? c.mediaSrc : "",
		linkUrl: !yt && /^https?:\/\//i.test(c.mediaSrc || "") ? c.mediaSrc : "",
		clipStart: fmtClip(c.clipStartSec),
		clipEnd: fmtClip(c.clipEndSec),
	};
};

function toCanon(e: any) {
	const { minRemaining, maxRemaining, cmdDelay, source, fileSrc, ytUrl, linkUrl, clipStart, clipEnd, ...rest } = e;
	const yt = source === "youtube";
	const link = source === "link";
	const url = link ? normalizeMediaUrl(linkUrl) : "";
	const clipStartSec = parseClip(clipStart);
	const clipEndSec = parseClip(clipEnd);
	return {
		...rest,
		triggers: e.triggers.map(toCanonTrigger),
		// kind follows the source: youtube embeds, otherwise the extension picks <video> vs <audio>
		mediaKind: yt ? "youtube" : link ? linkKind(url) : VIDEO_RE.test(fileSrc || "") ? "video" : "audio",
		mediaSrc: link ? url : (yt ? ytUrl : fileSrc || "").trim(),
		clipStartSec,
		// mirror the server: an end at or before the start would play nothing, so it saves as unset
		clipEndSec: clipEndSec != null && clipEndSec <= (clipStartSec || 0) ? null : clipEndSec,
		minRemainingMs: parseHMS(minRemaining),
		maxRemainingMs: parseHMS(maxRemaining),
		cmdDelaySec: parseDelaySec(cmdDelay),
	};
}

// a clip start/end that reads back as unset: blank, or an end that isn't after the start (the server drops those too)
function clipIsBackwards(e: any): boolean {
	const s = parseClip(e.clipStart), en = parseClip(e.clipEnd);
	return en != null && en <= (s || 0);
}

// the media src an edited event would save as, i.e. what Test would play
const editedSrc = (e: any) => ((e.source === "youtube" ? e.ytUrl : e.source === "link" ? e.linkUrl : e.fileSrc) || "").trim();

function defaultEdit() {
	return toEdit(canonFromServer({ id: uid(), name: "New event", triggers: [canonTrigger({ id: uid(), type: "daily", onceAt: Date.now() })] }));
}

// ---- browser source layers ---------------------------------------------------------------------------------------
// a layer is one /events browser source. the default layer is not in this list: it is the id "", the source url
// with no ?layer=, and it always exists — which is exactly what an obs source built before layers existed is.

const canonLayer = (raw: any) => {
	const r = raw || {};
	return {
		id: typeof r.id === "string" && r.id ? r.id : uid(),
		name: typeof r.name === "string" ? r.name : "",
	};
};

const DEFAULT_LAYER_LABEL = "Main (default source)";

// what an event's layer dropdown shows for a given id. a layer deleted out from under an event would otherwise
// read as a blank option, so name the dangling case rather than letting it look like the default.
function layerLabel(layers: any[], id: string): string {
	if (!id)
		return DEFAULT_LAYER_LABEL;
	const l = layers.find((x) => x.id === id);
	return l ? (l.name || "(unnamed layer)") : "(missing layer)";
}

// ---- component -----------------------------------------------------------------------------------------------------

const Events: React.FC<{ ws: any; settings: any; products: any[] | null }> = ({ ws, settings, products }) => {
	const savedCanon = Array.isArray(settings.timerEvents) ? settings.timerEvents.map(canonFromServer) : [];
	const savedStr = JSON.stringify(savedCanon);
	const [draft, setDraft] = useState<any[]>(savedCanon.map(toEdit));
	const prevSavedRef = useRef(savedStr);

	// layers live in their own column and their own ws message, but they share this tab's one Save button:
	// adding a source and pointing an event at it is one thought, and making it two saves would let an event
	// be saved against a layer that was never sent.
	const savedLayers = Array.isArray(settings.eventLayers) ? settings.eventLayers.map(canonLayer) : [];
	const savedLayersStr = JSON.stringify(savedLayers);
	const [layers, setLayers] = useState<any[]>(savedLayers);
	const prevSavedLayersRef = useRef(savedLayersStr);

	// follow the server's events only when there are no unsaved local edits (mirrors TimePerAction)
	useEffect(() => {
		setDraft((prev) =>
			JSON.stringify(prev.map(toCanon)) === prevSavedRef.current ? savedCanon.map(toEdit) : prev
		);
		prevSavedRef.current = savedStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedStr]);

	useEffect(() => {
		setLayers((prev) => (JSON.stringify(prev) === prevSavedLayersRef.current ? savedLayers : prev));
		prevSavedLayersRef.current = savedLayersStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedLayersStr]);

	const eventsDirty = JSON.stringify(draft.map(toCanon)) !== savedStr;
	const layersDirty = JSON.stringify(layers) !== savedLayersStr;
	const dirty = eventsDirty || layersDirty;

	const update = (i: number, patch: any) => setDraft((d) => d.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
	const remove = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));
	const add = () => setDraft((d) => [...d, defaultEdit()]);

	// trigger edits are patches into event i's triggers array
	const updateTrigger = (i: number, ti: number, patch: any) =>
		update(i, { triggers: draft[i].triggers.map((t: any, idx: number) => (idx === ti ? { ...t, ...patch } : t)) });
	const removeTrigger = (i: number, ti: number) =>
		update(i, { triggers: draft[i].triggers.filter((_: any, idx: number) => idx !== ti) });
	const addTrigger = (i: number) => update(i, { triggers: [...draft[i].triggers, defaultTrigger()] });

	const addLayer = () => setLayers((l) => [...l, canonLayer({ id: uid(), name: `Layer ${l.length + 2}` })]);
	const updateLayer = (li: number, patch: any) =>
		setLayers((l) => l.map((x, idx) => (idx === li ? { ...x, ...patch } : x)));
	// deleting a layer moves whatever pointed at it back to the default source. leaving those events aimed at
	// an id that no longer exists would look fine in the list and silently play to nothing on stream.
	const removeLayer = (li: number) => {
		const gone = layers[li].id;
		setLayers((l) => l.filter((_, idx) => idx !== li));
		setDraft((d) => d.map((e) => (e.layerId === gone ? { ...e, layerId: "" } : e)));
	};

	const save = () => {
		setEventLayers(ws, layers);
		setTimerEvents(ws, draft.map(toCanon));
	};
	const revert = () => {
		setDraft(savedCanon.map(toEdit));
		setLayers(savedLayers);
	};

	// the shop's product list, loaded by the dashboard when Fourthwall is connected. null = not loaded yet.
	const productName = (id: string) => {
		const p = (products || []).find((x: any) => x && x.id === id);
		return (p && p.name) || id;
	};

	const token = localStorage.getItem("identity") || "";
	// the default layer's url carries no ?layer= — same string this tab has always shown, so an existing
	// obs source needs no edit
	const layerUrl = (id: string) =>
		`${BASE_URL}/events?token=${encodeURIComponent(token)}${id ? `&layer=${encodeURIComponent(id)}` : ""}`;

	// the type-specific half of a trigger row
	const triggerFields = (i: number, t: any, ti: number) => {
		const set = (patch: any) => updateTrigger(i, ti, patch);
		if (t.type === "daily")
			return (
				<HStack>
					<Input type="time" size="sm" width="130px" value={t.dailyTime} onChange={(ev) => set({ dailyTime: ev.currentTarget.value })} />
					<Text fontSize="xs" color="gray.500">{t.tz || "server time"}</Text>
				</HStack>
			);
		if (t.type === "once")
			return (
				<Input
					type="datetime-local"
					size="sm"
					width="210px"
					value={toLocalInput(t.onceAt)}
					onChange={(ev) => set({ onceAt: fromLocalInput(ev.currentTarget.value) })}
				/>
			);
		if (t.type === "gift")
			return (
				<HStack wrap="wrap">
					<Input size="sm" width="70px" placeholder="min" value={t.giftMin} onChange={(ev) => set({ giftMin: ev.currentTarget.value })} />
					<Text fontSize="sm" color="gray.600">to</Text>
					<Input size="sm" width="70px" placeholder="max" value={t.giftMax} onChange={(ev) => set({ giftMax: ev.currentTarget.value })} isInvalid={giftBackwards(t)} />
					<Text fontSize="sm" color="gray.600">subs from</Text>
					<Select size="sm" width="130px" value={t.giftPlatform} onChange={(ev) => set({ giftPlatform: ev.currentTarget.value })}>
						{GIFT_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
					</Select>
				</HStack>
			);
		if (t.type === "donation")
			return (
				<HStack wrap="wrap">
					{["donMin", "donMax"].map((k) => (
						<React.Fragment key={k}>
							{k === "donMax" && <Text fontSize="sm" color="gray.600">to</Text>}
							<InputGroup size="sm" width="90px">
								<InputLeftElement pointerEvents="none" color="gray.400" fontSize="sm">$</InputLeftElement>
								<Input
									placeholder={k === "donMin" ? "min" : "max"}
									value={t[k]}
									onChange={(ev) => set({ [k]: ev.currentTarget.value })}
									isInvalid={k === "donMax" && donBackwards(t)}
								/>
							</InputGroup>
						</React.Fragment>
					))}
					<Text fontSize="sm" color="gray.600">from</Text>
					<Select size="sm" width="180px" value={t.donSource} onChange={(ev) => set({ donSource: ev.currentTarget.value })}>
						{DONATION_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
					</Select>
				</HStack>
			);
		// fwproduct: an empty list means any product in the shop
		return (
			<Box>
				<Select
					size="sm"
					maxW="320px"
					value=""
					onChange={(ev) => {
						const id = ev.currentTarget.value;
						if (id && !t.fwOfferIds.includes(id))
							set({ fwOfferIds: [...t.fwOfferIds, id] });
					}}
				>
					<option value="">{t.fwOfferIds.length ? "+ add another product…" : "any product (pick to narrow)"}</option>
					{(products || [])
						.filter((p: any) => p && !t.fwOfferIds.includes(p.id))
						.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
				</Select>
				{!!t.fwOfferIds.length && (
					<Wrap mt={2} spacing={1}>
						{t.fwOfferIds.map((id: string) => (
							<WrapItem key={id}>
								<Tag size="sm" colorScheme="purple">
									<TagLabel>{productName(id)}</TagLabel>
									<TagCloseButton onClick={() => set({ fwOfferIds: t.fwOfferIds.filter((x: string) => x !== id) })} />
								</Tag>
							</WrapItem>
						))}
					</Wrap>
				)}
				<HStack mt={2} wrap="wrap">
					<Text fontSize="sm" color="gray.600">quantity</Text>
					<Input size="sm" width="70px" placeholder="min" value={t.fwMin} onChange={(ev) => set({ fwMin: ev.currentTarget.value })} />
					<Text fontSize="sm" color="gray.600">to</Text>
					<Input size="sm" width="70px" placeholder="max" value={t.fwMax} onChange={(ev) => set({ fwMax: ev.currentTarget.value })} isInvalid={fwBackwards(t)} />
				</HStack>
				{!products && (
					<Text fontSize="xs" color="gray.500" mt={1}>
						Product list not loaded — connect Fourthwall to pick specific products. Until then this fires on any purchase.
					</Text>
				)}
			</Box>
		);
	};

	// the one-line explanation under a trigger row
	const triggerHint = (t: any) => {
		if (t.type === "daily") return `Fires daily in ${t.tz || "the server's"} time.`;
		if (t.type === "once") return "Fires once at this date/time (your local time).";
		if (t.type === "gift")
			return giftBackwards(t)
				? "The max is below the min — as written this can never fire."
				: "Fires when one person gifts this many subs at once (a 20-sub bomb counts as 20, a single gift sub as 1). Anonymous gifters count too.";
		if (t.type === "donation")
			return donBackwards(t)
				? "The max is below the min — as written this can never fire."
				: "Fires on a cash event in this range. A Fourthwall order matches on its whole total.";
		if (fwBackwards(t))
			return "The max is below the min — as written this can never fire.";
		const what = t.fwOfferIds.length ? "these products" : "anything (pick products above to narrow it down)";
		// the quantity is summed across the order's matching lines, so 2 of one + 3 of another reads as 5
		const qty = parseCount(t.fwMin) != null || parseCount(t.fwMax) != null
			? " Counts how many of them the order contains, added up across its line items."
			: " Leave the quantity boxes blank to fire on any amount.";
		return `Fires when a Fourthwall order contains ${what}.${qty}`;
	};

	const triggerRow = (i: number, t: any, ti: number) => (
		<Box key={t.id} borderWidth="1px" borderRadius="md" borderColor="gray.200" p={2}>
			<HStack align="start">
				<Select
					size="sm"
					width="140px"
					flexShrink={0}
					value={t.type}
					onChange={(ev) => updateTrigger(i, ti, { type: ev.currentTarget.value })}
				>
					{TRIGGER_TYPES.map((tt) => <option key={tt.value} value={tt.value}>{tt.label}</option>)}
				</Select>
				<Box flex="1">{triggerFields(i, t, ti)}</Box>
				<Button size="xs" variant="ghost" colorScheme="red" onClick={() => removeTrigger(i, ti)} title="remove this trigger">✕</Button>
			</HStack>
			<Text fontSize="xs" color={giftBackwards(t) || donBackwards(t) || fwBackwards(t) ? "red.500" : "gray.500"} mt={1}>
				{triggerHint(t)}
			</Text>
		</Box>
	);

	const card = (e: any, i: number) => (
		<Box key={e.id} borderWidth="1px" borderRadius="md" p={4} mb={3} bg={e.enabled ? "white" : "gray.50"}>
			<HStack mb={3}>
				<Input
					value={e.name}
					placeholder="event name"
					onChange={(ev) => update(i, { name: ev.currentTarget.value })}
					fontWeight={600}
					maxW="320px"
				/>
				<Spacer />
				<Text fontSize="sm" color="gray.500">renders to</Text>
				<Select
					size="sm"
					width="200px"
					value={e.layerId}
					onChange={(ev) => update(i, { layerId: ev.currentTarget.value })}
				>
					<option value="">{DEFAULT_LAYER_LABEL}</option>
					{layers.map((l) => <option key={l.id} value={l.id}>{l.name || "(unnamed layer)"}</option>)}
					{/* an id with no layer behind it would otherwise select nothing and read as the default */}
					{!!e.layerId && !layers.some((l) => l.id === e.layerId) && (
						<option value={e.layerId}>{layerLabel(layers, e.layerId)}</option>
					)}
				</Select>
				<Text fontSize="sm" color="gray.500">enabled</Text>
				<Switch isChecked={e.enabled} onChange={(ev) => update(i, { enabled: ev.currentTarget.checked })} />
			</HStack>

			<Flex gap={6} wrap="wrap">
				{/* triggers */}
				<Box minW="420px" flex="1">
					<HStack mb={1}>
						<Text fontSize="sm" fontWeight={600}>Triggers</Text>
						<Text fontSize="xs" color="gray.500">any one of these fires the event</Text>
					</HStack>
					{e.triggers.length === 0 && (
						<Text fontSize="sm" color="orange.500" mb={2}>No triggers — this event can never fire.</Text>
					)}
					<VStack align="stretch" spacing={2}>
						{e.triggers.map((t: any, ti: number) => triggerRow(i, t, ti))}
					</VStack>
					<Button size="sm" mt={2} onClick={() => addTrigger(i)}>+ Add trigger</Button>
				</Box>

				{/* condition */}
				<Box minW="240px">
					<Text fontSize="sm" fontWeight={600} mb={1}>Only if remaining time is</Text>
					<HStack>
						<Text fontSize="sm" color="gray.600">between</Text>
						<Input
							value={e.minRemaining}
							placeholder="HH:MM:SS"
							onChange={(ev) => update(i, { minRemaining: ev.currentTarget.value })}
							width="110px"
						/>
						<Text fontSize="sm" color="gray.600">and</Text>
						<Input
							value={e.maxRemaining}
							placeholder="HH:MM:SS"
							onChange={(ev) => update(i, { maxRemaining: ev.currentTarget.value })}
							width="110px"
						/>
					</HStack>
					<Text fontSize="xs" color="gray.500" mt={1}>
						Applies to every trigger above. Both ends are inclusive; leave a box blank for no limit on
						that side. The check uses the exact countdown, while the on-screen clock rounds to whole
						seconds — so a max of <Code fontSize="xs">0:09:59</Code> only catches the lower half of the
						second shown as "9:59". Add a second of margin (e.g. <Code fontSize="xs">0:10:00</Code>) to
						catch the whole displayed second.
					</Text>
				</Box>

				{/* media */}
				<Box minW="380px" flex="1">
					<Text fontSize="sm" fontWeight={600} mb={1}>Media</Text>
					<HStack mb={2} align="start">
						<Select
							value={e.source}
							onChange={(ev) => update(i, { source: ev.currentTarget.value })}
							width="150px"
							flexShrink={0}
						>
							<option value="file">Media folder</option>
							<option value="link">Direct link</option>
							<option value="youtube">YouTube link</option>
						</Select>
						{e.source === "link" ? (
							<Box flex="1">
								<Input
									value={e.linkUrl}
									placeholder="https://www.dropbox.com/scl/fi/.../clip.mp4?rlkey=..."
									onChange={(ev) => update(i, { linkUrl: ev.currentTarget.value })}
									isInvalid={!!e.linkUrl.trim() && (!/^https?:\/\//i.test(e.linkUrl.trim()) || !!linkProblem(e.linkUrl))}
								/>
								{!!e.linkUrl.trim() && !/^https?:\/\//i.test(e.linkUrl.trim()) ? (
									<Text fontSize="xs" color="red.500" mt={1}>Needs to start with http:// or https://</Text>
								) : linkProblem(e.linkUrl) ? (
									<Text fontSize="xs" color="red.500" mt={1}>{linkProblem(e.linkUrl)}</Text>
								) : willRewrite(e.linkUrl) ? (
									<Text fontSize="xs" color="gray.500" mt={1}>
										Dropbox preview link — saves as a direct <Code fontSize="xs">raw=1</Code> link so it streams
										instead of loading their web page.
									</Text>
								) : null}
							</Box>
						) : e.source === "youtube" ? (
							<Box flex="1">
								<Input
									value={e.ytUrl}
									placeholder="https://www.youtube.com/watch?v=..."
									onChange={(ev) => {
										const url = ev.currentTarget.value;
										// a link pasted with a start time (?t=90) fills the empty start box, so what
										// plays is always what the boxes show
										const at = parseYouTube(url);
										const fill = at && at.start && !e.clipStart.trim() ? { clipStart: fmtClip(at.start) } : {};
										update(i, { ytUrl: url, ...fill });
									}}
									isInvalid={!!e.ytUrl.trim() && !parseYouTube(e.ytUrl)}
								/>
								{!!e.ytUrl.trim() && !parseYouTube(e.ytUrl) && (
									<Text fontSize="xs" color="red.500" mt={1}>Not a YouTube link.</Text>
								)}
							</Box>
						) : (
							<Select
								value={e.fileSrc}
								onChange={(ev) => update(i, { fileSrc: ev.currentTarget.value })}
								flex="1"
							>
								<option value="">None</option>
								{MEDIA_FILES.map((f) => (
									<option key={f} value={`/media/${f}`}>{f}</option>
								))}
							</Select>
						)}
					</HStack>
					<HStack mb={1}>
						<Text fontSize="sm" color="gray.600" minW="70px">play from</Text>
						<Input
							value={e.clipStart}
							placeholder="start"
							onChange={(ev) => update(i, { clipStart: ev.currentTarget.value })}
							width="90px"
						/>
						<Text fontSize="sm" color="gray.600">to</Text>
						<Input
							value={e.clipEnd}
							placeholder="end"
							onChange={(ev) => update(i, { clipEnd: ev.currentTarget.value })}
							width="90px"
							isInvalid={clipIsBackwards(e)}
						/>
					</HStack>
					<Text fontSize="xs" color={clipIsBackwards(e) ? "red.500" : "gray.500"} mb={2}>
						{clipIsBackwards(e)
							? "The end must be after the start — it saves as unset, playing to the end."
							: <>Time into the clip, as <Code fontSize="xs">M:SS</Code> or <Code fontSize="xs">H:MM:SS</Code> (a
								plain number is seconds). Blank start = from the beginning, blank end = to the end.</>}
					</Text>
					<HStack>
						<Text fontSize="sm" color="gray.600" minW="70px">volume</Text>
						<Slider
							value={e.volume}
							min={0}
							max={1}
							step={0.05}
							onChange={(v) => update(i, { volume: v })}
							maxW="180px"
						>
							<SliderTrack><SliderFilledTrack /></SliderTrack>
							<SliderThumb />
						</Slider>
						<Text fontSize="sm" color="gray.500" minW="40px">{Math.round(e.volume * 100)}%</Text>
					</HStack>
					{e.source === "youtube" && !e.clipEnd.trim() && (
						<Text fontSize="xs" color="gray.500" mt={1}>
							With no end set this plays the whole video — set one to keep it short.
						</Text>
					)}
				</Box>

				{/* delayed terminal command */}
				<Box minW="240px" flex="1">
					<Text fontSize="sm" fontWeight={600} mb={1}>Terminal command (optional)</Text>
					<Input
						value={e.cmdText}
						placeholder='e.g.  time 300   or   twitch sub_t1 5'
						onChange={(ev) => update(i, { cmdText: ev.currentTarget.value })}
					/>
					<HStack mt={2}>
						<NumberInput
							size="sm"
							maxW="90px"
							min={0}
							step={0.1}
							value={e.cmdDelay}
							onChange={(str: string) => update(i, { cmdDelay: str })}
						>
							<NumberInputField />
						</NumberInput>
						<Text fontSize="sm" color="gray.600">seconds after the media starts</Text>
					</HStack>
					<Text fontSize="xs" color="gray.500" mt={1}>
						Same syntax as the Terminal tab (type <Code fontSize="xs">help</Code> there for the list).
						Runs on real fires and on Test.
					</Text>
				</Box>
			</Flex>

			<HStack mt={3}>
				<Button
					size="sm"
					onClick={() => testTimerEvent(ws, e.id)}
					isDisabled={dirty || !editedSrc(e)}
					title={dirty ? "Save first — Test plays the saved version" : "Play now on the /events source"}
				>
					Test
				</Button>
				{dirty && <Text fontSize="xs" color="gray.500">save to test changes</Text>}
				<Spacer />
				<Button size="sm" variant="ghost" colorScheme="red" onClick={() => remove(i)}>Delete</Button>
			</HStack>
		</Box>
	);

	return (
		<Box textAlign="left">
			<Text color="gray.500" fontSize="sm" mb={3}>
				An event holds any number of triggers — a time of day, a one-off moment, a gifted-subs bomb, a cash
				donation, or a shop product being bought. When any of them fires, and only if the live countdown's
				remaining time is inside the window, it plays its clip on the browser source it renders to. Set up
				those sources under <b>OBS browser sources</b> below.
			</Text>

			{draft.length === 0 && (
				<Text color="gray.400" fontSize="sm" mb={3}>No events yet. Add one below.</Text>
			)}
			{draft.map((e, i) => card(e, i))}

			<Button onClick={add} mb={4}>+ Add event</Button>

			<Flex bg="white" borderTopWidth="1px" py={3} align="center" gap={3}>
				<Text color={dirty ? "orange.500" : "gray.400"} fontWeight={600}>
					{dirty ? "unsaved changes" : "all changes saved"}
				</Text>
				<Spacer />
				<Button variant="outline" isDisabled={!dirty} onClick={revert}>Revert</Button>
				<Button colorScheme="purple" isDisabled={!dirty} onClick={save}>Save</Button>
			</Flex>

			<Divider my={4} />

			<Box>
				<HStack mb={1}>
					<Text fontWeight={600}>OBS browser sources</Text>
					<Badge colorScheme="purple">setup</Badge>
				</HStack>
				<Text fontSize="sm" color="gray.600" mb={2}>
					In OBS add a <b>Browser</b> source per URL below, sized to your canvas (e.g. 1920×1080). Each page fills
					with <Code fontSize="xs">#00FF00</Code> — add a <b>Color Key</b> filter on that green so only the clip
					shows, and audio plays through the source. Use a clip's <b>Test</b> button to confirm it's wired up before going live.
				</Text>
				<Text fontSize="sm" color="gray.600" mb={2}>
					Add a layer for each place a clip should appear, then point events at it with the <b>renders to</b>
					dropdown on the event. Each layer is its own source URL and its own OBS source, so you can size and
					position them independently. Everything defaults to Main, which is the URL this tab has always shown
					— an OBS source you already set up needs no change.
				</Text>
				<VStack align="stretch" spacing={2} mb={3}>
					<HStack>
						<Text fontSize="sm" fontWeight={600} minW="180px">{DEFAULT_LAYER_LABEL}</Text>
						<MaskedUrl url={layerUrl("")} p={2} fontSize="xs" flex="1" overflowX="auto" whiteSpace="nowrap" />
						<Button size="sm" onClick={() => copyText(layerUrl(""))}>Copy</Button>
						<Box width="64px" />
					</HStack>
					{layers.map((l, li) => (
						<HStack key={l.id}>
							<Input
								size="sm"
								minW="180px"
								maxW="180px"
								value={l.name}
								placeholder="layer name"
								onChange={(ev) => updateLayer(li, { name: ev.currentTarget.value })}
							/>
							<MaskedUrl url={layerUrl(l.id)} p={2} fontSize="xs" flex="1" overflowX="auto" whiteSpace="nowrap" />
							<Button size="sm" onClick={() => copyText(layerUrl(l.id))}>Copy</Button>
							<Button size="sm" variant="ghost" colorScheme="red" width="64px" onClick={() => removeLayer(li)}>Delete</Button>
						</HStack>
					))}
				</VStack>
				<HStack mb={2}>
					<Button size="sm" onClick={addLayer}>+ Add layer</Button>
					<Text fontSize="xs" color="gray.500">
						New layers save with the button above. Deleting one sends its events back to Main.
					</Text>
				</HStack>
				<Text fontSize="xs" color="gray.500" mt={2}>
					<b>Media folder</b> lists the videos and audios in the site's <Code fontSize="xs">media</Code> folder
					(<Code fontSize="xs">front/public/media</Code>) and only those — drop files there and
					rebuild/restart for them to appear.
					<br />
					<b>Direct link</b> plays a video file hosted anywhere, as long as the URL serves the file itself
					rather than a web page around it. A Dropbox share link is rewritten to stream on save; a Bunny.net
					pull-zone URL (<Code fontSize="xs">…b-cdn.net/clip.mp4</Code>) works as-is. This is the clean
					option: it plays through the page's own player, so there's no title, watermark, captions or end
					screen to hide. The file has to still be there at showtime, so don't move or rename it once an
					event points at it. Player embeds and HLS (<Code fontSize="xs">.m3u8</Code>) links won't play —
					the box will tell you if you paste one.
					<br />
					<b>YouTube link</b> plays as an embed. It clears itself when the video ends; videos whose owner has
					disabled embedding won't play, and YouTube's own watermark and end screens can't be turned off.
					<br />
					For a file or a direct link, whether it plays as video or audio follows the file type.
				</Text>
				<Text fontSize="xs" color="gray.500" mt={2}>
					Gift, donation and product triggers fire on real activity only — a typed terminal command never sets
					one off. To rehearse one, use an event's <b>Test</b> button, or click a product thumbnail on the
					Fourthwall tab: that simulated purchase drives the product triggers exactly like a real order, as a
					single item — so a trigger with a minimum quantity above 1 won't answer it.
				</Text>
			</Box>
		</Box>
	);
};

export default Events;
