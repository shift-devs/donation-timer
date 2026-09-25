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
	Switch,
	Text,
	VStack,
	Wrap,
	WrapItem,
	useToast,
} from "@chakra-ui/react";
import { setRaffleSettings, startRaffle, drawRaffle, stopRaffle } from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import NumberField from "../../NumberField";
import { BASE_URL } from "../../Consts";
import { countdown } from "../../firesale";
import { canonRaffle, MAX_RAFFLE_WINNERS } from "../../raffle";

// audio in public/media (vite.config.ts bakes the list in) — the same folder the firesale draws on
const MEDIA_FILES: string[] = typeof __MEDIA_FILES__ !== "undefined" ? __MEDIA_FILES__ : [];
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i;
const MUSIC = MEDIA_FILES.filter((f) => AUDIO_RE.test(f));

const SEND_DEBOUNCE = 300;

// a raffle the streamer runs themselves, on the firesale's overlay. set it up, hit start, and the app draws
// the winners itself. everything applies immediately — no Save.
const Raffle: React.FC<{ ws: any; token: string | null; settings: any; run: any }> = ({ ws, token, settings, run }) => {
	const toast = useToast();

	const server = canonRaffle(settings.raffleSettings || {});
	const serverStr = JSON.stringify(server);
	const [draft, setDraft] = useState<any>(server);
	// between an edit and its sync the server's copy is older than the screen — same bargain as the Firesale tab
	const sentRef = useRef(serverStr);
	const pendingRef = useRef(0);
	const timers = useRef<{ [key: string]: any }>({});
	const [, setTick] = useState(0);

	useEffect(() => {
		if (serverStr === sentRef.current) {
			pendingRef.current = 0;
			return;
		}
		if (pendingRef.current && Date.now() - pendingRef.current < 10000)
			return;
		setDraft(server);
		sentRef.current = serverStr;
		pendingRef.current = 0;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [serverStr]);

	useEffect(() => () => {
		for (const key of Object.keys(timers.current))
			clearTimeout(timers.current[key]);
	}, []);

	const r: any = run && Array.isArray(run.runs) && run.runs.length ? run.runs[0] : null;
	const phase = r ? r.phase : "idle";

	useEffect(() => {
		if (phase !== "running" || !r.endsAt)
			return;
		const id = setInterval(() => setTick((n) => n + 1), 500);
		return () => clearInterval(id);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [phase, r && r.endsAt]);

	const later = (key: string, fn: () => void, delay: number) => {
		clearTimeout(timers.current[key]);
		timers.current[key] = setTimeout(fn, delay);
	};

	const patch = (p: any, key?: string) => {
		const next = { ...draft, ...p };
		setDraft(next);
		sentRef.current = JSON.stringify(canonRaffle(next));
		pendingRef.current = Date.now();
		if (key)
			later(key, () => setRaffleSettings(ws, next), SEND_DEBOUNCE);
		else
			setRaffleSettings(ws, next);
	};

	const url = `${BASE_URL}/raffle?token=${encodeURIComponent(token || "")}`;

	const copyUrl = () => {
		copyText(url).then((ok) =>
			toast(ok
				? { title: "Source URL copied", status: "success", duration: 1500 }
				: { title: "Couldn't copy — reveal the URL and copy it manually", status: "error", duration: 3000 }));
	};

	// a start sends what's on screen, so flush any edit still waiting on its debounce first
	const start = () => {
		for (const key of Object.keys(timers.current))
			clearTimeout(timers.current[key]);
		timers.current = {};
		setRaffleSettings(ws, draft);
		startRaffle(ws);
	};

	const entrants: string[] = run && Array.isArray(run.names) ? run.names : [];
	const mbOn = !(settings.mysteryBoxSettings && settings.mysteryBoxSettings.enabled === false);
	const clashesWithFiresale = settings.firesaleSettings && settings.firesaleSettings.command === draft.command;

	const badge = phase === "running"
		? <Badge colorScheme="red">TAKING ENTRIES</Badge>
		: phase === "drawing"
			? <Badge colorScheme="yellow">DRAWING</Badge>
			: phase === "winner"
				? <Badge colorScheme="green">WINNERS UP</Badge>
				: <Badge>IDLE</Badge>;

	const soundRow = (label: string, file: string, fileKey: string, volume: number, volKey: string, none: string) => (
		<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
			<Text color="gray.500" w="150px">{label}</Text>
			<Select size="sm" w="280px" value={file} onChange={(e) => patch({ [fileKey]: e.currentTarget.value })}>
				<option value="">{none}</option>
				{MUSIC.map((f) => <option key={f} value={f}>{f}</option>)}
				{file && !MUSIC.includes(file) && <option value={file}>{file} (missing)</option>}
			</Select>
			<Input
				type="range"
				min={0}
				max={1}
				step={0.05}
				w="130px"
				p={0}
				cursor="pointer"
				value={volume}
				onChange={(e) => patch({ [volKey]: Number(e.currentTarget.value) }, volKey)}
			/>
			<Text color="gray.500" w="46px">{Math.round(volume * 100)}%</Text>
		</Flex>
	);

	return (
		<Box maxW="900px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={2}>
				One OBS <b>Browser</b> source for raffles you run yourself. Set it up below and hit <b>Start</b>: the
				music loops, <b>{draft.title || "RAFFLE"}</b> flashes in the middle, and everyone who types{" "}
				<Code fontSize="xs">!{draft.command}</Code> bounces around the frame. When entries close, the app draws{" "}
				{draft.winners === 1 ? "a winner" : `${draft.winners} winners`} at random and puts them up in the middle.
			</Text>
			<Text fontSize="sm" color="gray.600" mb={3}>
				It&apos;s the firesale&apos;s overlay, so size it the same — <b>4:3</b>, e.g. 800×600. It draws nothing
				between raffles, so it can stay in the scene permanently.
			</Text>

			<Flex align="center" gap={2} mb={4} wrap="wrap">
				<MaskedUrl url={url} p={2} fontSize="xs" flex="1" minW="140px" overflowX="auto" whiteSpace="nowrap" />
				<Button size="sm" onClick={copyUrl}>Copy</Button>
			</Flex>

			{/* ---- the raffle happening right now ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Live</Text>
					{badge}
					{r && <Text fontSize="sm" color="gray.600">{r.total} entered</Text>}
					{phase === "running" && r.endsAt > 0 && (
						<Text fontSize="sm" color="gray.600">{countdown(r.endsAt - Date.now())} left</Text>
					)}
					{phase === "running" && !r.endsAt && (
						<Text fontSize="sm" color="gray.600">open until you draw</Text>
					)}
				</Flex>

				{phase === "winner" && (
					<Text fontSize="sm" mb={2}>
						<b>{(r.winners || []).join(", ")}</b> won{r.prize ? ` ${r.prize}` : ""}
						{r.winners.length < (run.want || 0) ? ` — only ${r.winners.length} entered, so not all ${run.want} could be drawn` : ""}
						{r.bonus ? ` (${r.bonus.toLowerCase()})` : ""}
					</Text>
				)}

				{r && entrants.length > 0 && (
					<Wrap spacing={1} mb={2}>
						{entrants.map((n) => (
							<WrapItem key={n}><Badge variant="subtle">{n}</Badge></WrapItem>
						))}
					</Wrap>
				)}
				{r && run.total > entrants.length && (
					<Text fontSize="xs" color="gray.500" mb={2}>
						Showing the {entrants.length} most recent of {run.total} — those are the names on screen.
					</Text>
				)}

				<HStack spacing={2} wrap="wrap">
					<Button size="sm" colorScheme="red" onClick={start}>{r ? "Restart" : "Start raffle"}</Button>
					<Button size="sm" isDisabled={phase !== "running"} onClick={() => drawRaffle(ws)}>Draw now</Button>
					<Button size="sm" isDisabled={!r} onClick={() => stopRaffle(ws)}>Clear</Button>
					{r && <Text fontSize="xs" color="gray.500">Restart throws away this raffle&apos;s entries.</Text>}
				</HStack>
			</Box>

			<Divider my={4} />

			{/* ---- the raffle itself ---- */}
			<Text fontWeight="bold" mb={2}>The raffle</Text>
			<VStack align="stretch" spacing={3} mb={5}>
				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Title</Text>
					<Input
						size="sm"
						w="220px"
						maxLength={40}
						value={draft.title}
						placeholder="RAFFLE"
						onChange={(e) => patch({ title: e.currentTarget.value }, "title")}
					/>
					<Text color="gray.500" fontSize="xs">The big word in the middle of the overlay.</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Prize</Text>
					<Input
						size="sm"
						w="320px"
						maxLength={200}
						value={draft.prize}
						placeholder="e.g. Signed poster"
						onChange={(e) => patch({ prize: e.currentTarget.value }, "prize")}
					/>
					<Text color="gray.500" fontSize="xs">Optional — shown under the title and with the winners.</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Entry command</Text>
					<Flex align="center">
						<Text mr={1}>!</Text>
						<Input
							size="sm"
							w="140px"
							value={draft.command}
							placeholder="raffle"
							onChange={(e) => patch({ command: e.currentTarget.value.replace(/^!/, "") }, "command")}
						/>
					</Flex>
					<Text color="gray.500" fontSize="xs">
						One entry per person.
						{clashesWithFiresale ? " Same as the firesale's, so one entry joins both while both are open." : ""}
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Entry window</Text>
					<NumberField width="100px" min={0} max={3600} value={draft.entrySec} onCommit={(n) => patch({ entrySec: n }, "entrySec")} />
					<Text color="gray.500" fontSize="xs">
						sec{draft.entrySec === 0 ? " — 0 means it stays open until you hit Draw now." : ". 0 = open until you hit Draw now."}
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Winners</Text>
					<NumberField width="100px" min={1} max={MAX_RAFFLE_WINNERS} value={draft.winners} onCommit={(n) => patch({ winners: n }, "winners")} />
					<Text color="gray.500" fontSize="xs">
						Drawn at random, nobody twice. If fewer people enter, everyone who entered wins.
					</Text>
				</Flex>

				<Box borderWidth="1px" borderRadius="md" p={3}>
					<HStack spacing={2} mb={draft.giveBoxes ? 2 : 0}>
						<Switch isChecked={draft.giveBoxes} onChange={(e) => patch({ giveBoxes: e.target.checked })} />
						<Text fontSize="sm" fontWeight="bold">Winners get mystery boxes</Text>
						{!draft.giveBoxes && <Badge>OFF</Badge>}
					</HStack>
					{draft.giveBoxes && (<>
						<HStack spacing={2} wrap="wrap">
							<NumberField width="80px" min={1} max={99} value={draft.boxesPerWinner} onCommit={(n) => patch({ boxesPerWinner: n }, "boxes")} />
							<Text fontSize="sm" color="gray.600">
								box{draft.boxesPerWinner === 1 ? "" : "es"} for each winner, banked the moment they&apos;re drawn
							</Text>
						</HStack>
						{!mbOn && (
							<Text fontSize="xs" color="orange.500" mt={1}>
								Mystery boxes are switched off on the Mystery Box tab, so none will be given out until they&apos;re back on.
							</Text>
						)}
					</>)}
				</Box>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Announce in chat</Text>
					<Switch isChecked={draft.announceInChat} onChange={(e) => patch({ announceInChat: e.target.checked })} />
					<Text color="gray.500" fontSize="xs">Posts the winners as a Twitch announcement from the bot account.</Text>
				</Flex>
			</VStack>

			{/* ---- look and sound ---- */}
			<Text fontWeight="bold" mb={2}>Look &amp; sound</Text>
			<VStack align="stretch" spacing={3}>
				{soundRow("Music", draft.music, "music", draft.volume, "volume", "(silent)")}
				{soundRow("Announcer", draft.announcer, "announcer", draft.announcerVolume, "announcerVolume", "(none)")}
				<Text fontSize="xs" color="gray.500" ml="158px" mt={-1}>
					Played once over the music when a raffle starts.
				</Text>
				{soundRow("Win sound", draft.winSound, "winSound", draft.winVolume, "winVolume", "(none)")}
				<Text fontSize="xs" color="gray.500" ml="158px" mt={-1}>
					Played when the winners go up. The music stops at that moment so it lands in the clear.
				</Text>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Countdown on stream</Text>
					<Switch isChecked={draft.showCountdown} onChange={(e) => patch({ showCountdown: e.target.checked })} />
					<Text color="gray.500" fontSize="xs">Shown next to TYPE !{draft.command.toUpperCase()} when there&apos;s an entry window.</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Drawing suspense</Text>
					<NumberField width="100px" min={0} max={30} value={draft.drawSec} onCommit={(n) => patch({ drawSec: n }, "drawSec")} />
					<Text color="gray.500" fontSize="xs">sec on DRAWING… before the winners go up.</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Hold the winners</Text>
					<NumberField width="100px" min={1} max={600} value={draft.winnerHoldSec} onCommit={(n) => patch({ winnerHoldSec: n }, "hold")} />
					<Text color="gray.500" fontSize="xs">sec on screen before the overlay clears itself.</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Names on screen</Text>
					<NumberField width="100px" min={1} max={200} value={draft.maxBouncers} onCommit={(n) => patch({ maxBouncers: n }, "bouncers")} />
					<Text color="gray.500" fontSize="xs">
						The most recent this many bounce around. Everyone else is still entered and can still win.
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Colours</Text>
					<Input type="color" w="42px" p={1} cursor="pointer" value={draft.titleColor} onChange={(e) => patch({ titleColor: e.currentTarget.value }, "titleColor")} />
					<Text color="gray.500">title</Text>
					<Input type="color" w="42px" p={1} cursor="pointer" value={draft.nameColor} onChange={(e) => patch({ nameColor: e.currentTarget.value }, "nameColor")} />
					<Text color="gray.500">winners</Text>
					<Input
						type="color"
						w="42px"
						p={1}
						cursor="pointer"
						opacity={draft.bgColor === "transparent" ? 0.4 : 1}
						value={draft.bgColor === "transparent" ? "#00ff00" : draft.bgColor}
						onChange={(e) => patch({ bgColor: e.currentTarget.value }, "bgColor")}
					/>
					<Text color="gray.500">fill</Text>
					<Button size="xs" isDisabled={draft.bgColor === "transparent"} onClick={() => patch({ bgColor: "transparent" })}>
						transparent
					</Button>
				</Flex>
			</VStack>

			<Divider my={4} />

			<Text fontSize="xs" color="gray.500">
				One raffle at a time — starting another replaces the one on screen. A mystery box can&apos;t be opened
				while a raffle is up, the same as during a firesale.
				<br />
				From the Terminal (or chat, as a mod):{" "}
				<Code fontSize="xs">raffle start</Code>, <Code fontSize="xs">raffle start 60</Code> (a different entry
				window, 0 = until drawn), <Code fontSize="xs">raffle draw</Code>, <Code fontSize="xs">raffle stop</Code>.
			</Text>
		</Box>
	);
};

export default Raffle;
