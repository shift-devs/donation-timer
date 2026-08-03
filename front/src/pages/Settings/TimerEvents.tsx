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
	NumberInput,
	NumberInputField,
	Select,
	Slider,
	SliderFilledTrack,
	SliderThumb,
	SliderTrack,
	Spacer,
	Switch,
	Text,
	VStack,
} from "@chakra-ui/react";
import { setTimerEvents, testTimerEvent } from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import { BASE_URL } from "../../Consts";
import { parseYouTube } from "../../youtube";

// media files found in public/media at build time (vite.config.ts bakes the list in) — the
// dropdown lists these and only these; audio-vs-video is derived from the chosen file's extension
const MEDIA_FILES: string[] = typeof __MEDIA_FILES__ !== "undefined" ? __MEDIA_FILES__ : [];
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;

// ---- shape helpers -------------------------------------------------------------------------------------------------
// canonical shape == what the server stores (min/max as ms|null). edit shape keeps min/max as "HH:MM:SS" strings and
// the command delay as raw text so typing doesn't fight a formatter — a half-typed "1." parses to 1 and a numeric
// value prop would rewrite the box mid-keystroke, eating the dot. it also splits the single canonical mediaSrc into
// a picked file and a typed youtube url so flipping the source dropdown doesn't discard the other one. we convert at
// the save/load boundary and compare canonical projections — so the edit-only keys must never displace a canonical
// key's position, or every event would read as dirty forever.

const uid = () =>
	(typeof crypto !== "undefined" && (crypto as any).randomUUID)
		? (crypto as any).randomUUID()
		: `e${Date.now()}${Math.floor(Math.random() * 1e6)}`;

// this browser's iana zone — daily triggers resolve in it on the server (whose container clock is usually UTC)
function browserTz(): string {
	try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
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

// coerce server data into a complete canonical event (fills any missing fields with defaults)
function canonFromServer(raw: any) {
	const r = raw || {};
	// an unset bound/trim comes back as null, and Number(null) is 0 — so screen those out before coercing, or a
	// blank max would reload as 00:00:00 and the next save would pin the window shut
	const num = (v: any) => {
		if (v == null || v === "")
			return null;
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
	};
	const end = num(r.clipEndSec);
	return {
		id: typeof r.id === "string" && r.id ? r.id : uid(),
		name: typeof r.name === "string" ? r.name : "",
		enabled: r.enabled !== false,
		triggerType: r.triggerType === "once" ? "once" : "daily",
		dailyTime: typeof r.dailyTime === "string" && r.dailyTime ? r.dailyTime : "00:00",
		tz: typeof r.tz === "string" && r.tz ? r.tz : browserTz(),
		onceAt: Number.isFinite(Number(r.onceAt)) ? Math.round(Number(r.onceAt)) : 0,
		minRemainingMs: num(r.minRemainingMs),
		maxRemainingMs: num(r.maxRemainingMs),
		mediaKind: r.mediaKind === "video" ? "video" : r.mediaKind === "youtube" ? "youtube" : "audio",
		mediaSrc: typeof r.mediaSrc === "string" ? r.mediaSrc : "",
		clipStartSec: num(r.clipStartSec),
		// same drop rule the server applies, so a stale row can't load as a window the editor would never save
		clipEndSec: end != null && end <= (num(r.clipStartSec) || 0) ? null : end,
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
		minRemaining: fmtHMS(c.minRemainingMs),
		maxRemaining: fmtHMS(c.maxRemainingMs),
		cmdDelay: String(cmdDelaySec ?? 0),
		source: yt ? "youtube" : "file",
		fileSrc: yt ? "" : c.mediaSrc,
		ytUrl: yt ? c.mediaSrc : "",
		clipStart: fmtClip(c.clipStartSec),
		clipEnd: fmtClip(c.clipEndSec),
	};
};
function toCanon(e: any) {
	const { minRemaining, maxRemaining, cmdDelay, source, fileSrc, ytUrl, clipStart, clipEnd, ...rest } = e;
	const yt = source === "youtube";
	const clipStartSec = parseClip(clipStart);
	const clipEndSec = parseClip(clipEnd);
	return {
		...rest,
		// kind follows the source: youtube embeds, otherwise the file's extension picks <video> vs <audio>
		mediaKind: yt ? "youtube" : VIDEO_RE.test(fileSrc || "") ? "video" : "audio",
		mediaSrc: (yt ? ytUrl : fileSrc || "").trim(),
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
const editedSrc = (e: any) => ((e.source === "youtube" ? e.ytUrl : e.fileSrc) || "").trim();

function defaultEdit() {
	return toEdit(canonFromServer({ id: uid(), name: "New event", triggerType: "daily", dailyTime: "00:00", onceAt: Date.now() }));
}

// ---- component -----------------------------------------------------------------------------------------------------

const TimerEvents: React.FC<{ ws: any; settings: any }> = ({ ws, settings }) => {
	const savedCanon = Array.isArray(settings.timerEvents) ? settings.timerEvents.map(canonFromServer) : [];
	const savedStr = JSON.stringify(savedCanon);
	const [draft, setDraft] = useState<any[]>(savedCanon.map(toEdit));
	const prevSavedRef = useRef(savedStr);

	// follow the server's events only when there are no unsaved local edits (mirrors TimePerAction)
	useEffect(() => {
		setDraft((prev) =>
			JSON.stringify(prev.map(toCanon)) === prevSavedRef.current ? savedCanon.map(toEdit) : prev
		);
		prevSavedRef.current = savedStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedStr]);

	const dirty = JSON.stringify(draft.map(toCanon)) !== savedStr;

	const update = (i: number, patch: any) => setDraft((d) => d.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
	const remove = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));
	const add = () => setDraft((d) => [...d, defaultEdit()]);

	const token = localStorage.getItem("identity") || "";
	const sourceUrl = `${BASE_URL}/events?token=${encodeURIComponent(token)}`;

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
				<Text fontSize="sm" color="gray.500">enabled</Text>
				<Switch isChecked={e.enabled} onChange={(ev) => update(i, { enabled: ev.currentTarget.checked })} />
			</HStack>

			<Flex gap={6} wrap="wrap">
				{/* trigger */}
				<Box minW="240px">
					<Text fontSize="sm" fontWeight={600} mb={1}>Trigger</Text>
					<HStack>
						<Select
							value={e.triggerType}
							onChange={(ev) => update(i, { triggerType: ev.currentTarget.value })}
							width="130px"
						>
							<option value="daily">Daily at</option>
							<option value="once">Once at</option>
						</Select>
						{e.triggerType === "daily" ? (
							<Input
								type="time"
								value={e.dailyTime}
								onChange={(ev) => update(i, { dailyTime: ev.currentTarget.value })}
								width="140px"
							/>
						) : (
							<Input
								type="datetime-local"
								value={toLocalInput(e.onceAt)}
								onChange={(ev) => update(i, { onceAt: fromLocalInput(ev.currentTarget.value) })}
								width="220px"
							/>
						)}
					</HStack>
					<Text fontSize="xs" color="gray.500" mt={1}>
						{e.triggerType === "daily" ? `Fires daily in ${e.tz || "the server's"} time.` : "Fires once at this date/time (your local time)."}
					</Text>
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
						Both ends are inclusive. Leave a box blank for no limit on that side. The check
						uses the exact countdown, while the on-screen clock rounds to whole seconds — so a
						max of <Code fontSize="xs">0:09:59</Code> only catches the lower half of the second
						shown as "9:59". Add a second of margin (e.g. <Code fontSize="xs">0:10:00</Code>) to
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
							<option value="youtube">YouTube link</option>
						</Select>
						{e.source === "youtube" ? (
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
				An event fires at its trigger time and, only if the live countdown's remaining time is inside the window,
				plays its clip on the browser-source page below.
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
				<Button variant="outline" isDisabled={!dirty} onClick={() => setDraft(savedCanon.map(toEdit))}>Revert</Button>
				<Button colorScheme="purple" isDisabled={!dirty} onClick={() => setTimerEvents(ws, draft.map(toCanon))}>Save</Button>
			</Flex>

			<Divider my={4} />

			<Box>
				<HStack mb={1}>
					<Text fontWeight={600}>OBS browser source</Text>
					<Badge colorScheme="purple">setup</Badge>
				</HStack>
				<Text fontSize="sm" color="gray.600" mb={2}>
					In OBS add a <b>Browser</b> source with this URL, sized to your canvas (e.g. 1920×1080). The page fills
					with <Code fontSize="xs">#00FF00</Code> — add a <b>Color Key</b> filter on that green so only the clip
					shows, and audio plays through the source. Use a clip's <b>Test</b> button to confirm it's wired up before going live.
				</Text>
				<HStack>
					<MaskedUrl url={sourceUrl} p={2} fontSize="xs" maxW="100%" overflowX="auto" whiteSpace="nowrap" />
					<Button size="sm" onClick={() => copyText(sourceUrl)}>Copy</Button>
				</HStack>
				<Text fontSize="xs" color="gray.500" mt={2}>
					The media dropdown lists the videos and audios in the site's <Code fontSize="xs">media</Code> folder
					(<Code fontSize="xs">front/public/media</Code>) and only those — drop files there and
					rebuild/restart for them to appear. Whether a clip plays as video or audio follows its file type.
					A YouTube link plays as an embed instead, and clears itself when the video ends; videos whose owner
					has disabled embedding won't play.
				</Text>
			</Box>
		</Box>
	);
};

export default TimerEvents;
