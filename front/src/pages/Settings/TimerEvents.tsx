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
import * as consts from "../../Consts";
import { setTimerEvents, testTimerEvent } from "../../Api";

// media files found in public/media at build time (vite.config.ts bakes the list in) — the
// dropdown lists these and only these; audio-vs-video is derived from the chosen file's extension
const MEDIA_FILES: string[] = typeof __MEDIA_FILES__ !== "undefined" ? __MEDIA_FILES__ : [];
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;

// ---- shape helpers -------------------------------------------------------------------------------------------------
// canonical shape == what the server stores (min/max as ms|null). edit shape keeps min/max as "HH:MM:SS" strings so
// typing doesn't fight a re-padding formatter; we convert at the save/load boundary and compare canonical projections.

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
	const num = (v: any) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
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
		mediaKind: r.mediaKind === "video" ? "video" : "audio",
		mediaSrc: typeof r.mediaSrc === "string" ? r.mediaSrc : "",
		volume: Number.isFinite(Number(r.volume)) ? Math.min(1, Math.max(0, Number(r.volume))) : 1,
	};
}

const toEdit = (c: any) => ({ ...c, minRemaining: fmtHMS(c.minRemainingMs), maxRemaining: fmtHMS(c.maxRemainingMs) });
function toCanon(e: any) {
	const { minRemaining, maxRemaining, ...rest } = e;
	return { ...rest, minRemainingMs: parseHMS(minRemaining), maxRemainingMs: parseHMS(maxRemaining) };
}

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
	const sourceUrl = `${consts.BASE_URL}/events?token=${encodeURIComponent(token)}`;

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
					<Text fontSize="xs" color="gray.500" mt={1}>Leave a box blank for no limit on that side.</Text>
				</Box>

				{/* media */}
				<Box minW="240px" flex="1">
					<Text fontSize="sm" fontWeight={600} mb={1}>Media</Text>
					<Select
						value={e.mediaSrc}
						onChange={(ev) => {
							const src = ev.currentTarget.value;
							// kind follows the file: video extensions play in <video>, everything else in <audio>
							update(i, { mediaSrc: src, mediaKind: VIDEO_RE.test(src) ? "video" : "audio" });
						}}
					>
						<option value="">None</option>
						{MEDIA_FILES.map((f) => (
							<option key={f} value={`/media/${f}`}>{f}</option>
						))}
					</Select>
					<HStack mt={2}>
						<Text fontSize="sm" color="gray.600" minW="55px">volume</Text>
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
				</Box>
			</Flex>

			<HStack mt={3}>
				<Button
					size="sm"
					onClick={() => testTimerEvent(ws, e.id)}
					isDisabled={dirty || !e.mediaSrc}
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
					<Code p={2} fontSize="xs" maxW="100%" overflowX="auto" whiteSpace="nowrap">{sourceUrl}</Code>
					<Button size="sm" onClick={() => { try { navigator.clipboard.writeText(sourceUrl); } catch {} }}>Copy</Button>
				</HStack>
				<Text fontSize="xs" color="gray.500" mt={2}>
					The media dropdown lists the videos and audios in the site's <Code fontSize="xs">media</Code> folder
					(<Code fontSize="xs">front/public/media</Code>) and only those — drop files there and
					rebuild/restart for them to appear. Whether a clip plays as video or audio follows its file type.
				</Text>
			</Box>
		</Box>
	);
};

export default TimerEvents;
