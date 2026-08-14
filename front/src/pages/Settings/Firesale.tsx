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
	Switch,
	Text,
	VStack,
	Wrap,
	WrapItem,
	useToast,
} from "@chakra-ui/react";
import {
	setFiresaleSettings,
	startFiresale,
	stopFiresale,
	endFiresaleEntries,
	setFiresaleWinner,
	endFiresaleRun,
} from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import { BASE_URL } from "../../Consts";
import { canonFiresale, countdown, MAX_BOUNCERS } from "../../firesale";

// audio in public/media (vite.config.ts bakes the list in) — the same folder the timer events draw on
const MEDIA_FILES: string[] = typeof __MEDIA_FILES__ !== "undefined" ? __MEDIA_FILES__ : [];
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i;
const MUSIC = MEDIA_FILES.filter((f) => AUDIO_RE.test(f));

const SEND_DEBOUNCE = 300; // colour pickers and typing fire continuously; the socket rate-limits per connection

// The firesale is the on-stream half of a Fourthwall chat giveaway. Fourthwall announces one in Twitch chat,
// the overlay starts itself, and everything on this tab is either the look of that overlay or a manual handle
// for when the announcement doesn't arrive. Everything applies immediately — no Save.
const Firesale: React.FC<{ ws: any; token: string | null; settings: any; run: any }> = ({ ws, token, settings, run }) => {
	const toast = useToast();

	const server = canonFiresale(settings.firesaleSettings || {});
	const serverStr = JSON.stringify(server);
	const [draft, setDraft] = useState<any>(server);
	// between an edit and its sync the server's copy is OLDER than the screen, so following it would undo
	// keystrokes; once it agrees again we go back to following it. mirrors the Text Boxes tab.
	const sentRef = useRef(serverStr);
	const pendingRef = useRef(0);
	const timers = useRef<{ [key: string]: any }>({});
	const [manualWinner, setManualWinner] = useState("");
	const [winnerRun, setWinnerRun] = useState("");
	const [testSec, setTestSec] = useState(60);
	// the live run carries a deadline, so the countdown here has to tick on its own
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

	// several giveaways can be open at once, so the payload carries a list
	const runs: any[] = run && Array.isArray(run.runs) ? run.runs : [];
	const anyRunning = runs.some((r) => r.phase === "running");

	useEffect(() => {
		if (!anyRunning)
			return;
		const id = setInterval(() => setTick((n) => n + 1), 500);
		return () => clearInterval(id);
	}, [anyRunning]);

	const later = (key: string, fn: () => void, delay: number) => {
		clearTimeout(timers.current[key]);
		timers.current[key] = setTimeout(fn, delay);
	};

	// mark the screen as ahead of the server, then push (now, or coalesced for the controls that fire per pixel)
	const patch = (p: any, key?: string) => {
		const next = { ...draft, ...p };
		setDraft(next);
		sentRef.current = JSON.stringify(canonFiresale(next));
		pendingRef.current = Date.now();
		if (key)
			later(key, () => setFiresaleSettings(ws, next), SEND_DEBOUNCE);
		else
			setFiresaleSettings(ws, next);
	};

	const url = `${BASE_URL}/firesale?token=${encodeURIComponent(token || "")}`;

	const copyUrl = () => {
		copyText(url).then((ok) =>
			toast(ok
				? { title: "Source URL copied", status: "success", duration: 1500 }
				: { title: "Couldn't copy — reveal the URL and copy it manually", status: "error", duration: 3000 }));
	};

	const active = !!(run && run.active);
	const entrants: string[] = run && Array.isArray(run.names) ? run.names : [];

	const badgeFor = (phase: string) => phase === "running"
		? <Badge colorScheme="red">TAKING ENTRIES</Badge>
		: phase === "drawing"
			? <Badge colorScheme="yellow">DRAWING</Badge>
			: phase === "winner"
				? <Badge colorScheme="green">WINNER UP</Badge>
				: <Badge>IDLE</Badge>;

	return (
		<Box maxW="900px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={2}>
				One OBS <b>Browser</b> source for Fourthwall giveaways. When Fourthwall announces a giveaway in
				Twitch chat, this starts itself: the music loops, <b>FIRESALE</b> flashes in the middle, and everyone
				who types <Code fontSize="xs">!{draft.command}</Code> bounces around the frame like a DVD logo. When
				Fourthwall announces the winner, that name goes up in the middle.
			</Text>
			<Text fontSize="sm" color="gray.600" mb={3}>
				Size the source <b>4:3</b> (like a CRT) — 800×600 or 1024×768. The overlay draws nothing at all
				between giveaways, so it can stay in the scene permanently. Everything here applies immediately —
				no Save.
			</Text>

			<Flex align="center" gap={2} mb={4} wrap="wrap">
				<MaskedUrl url={url} p={2} fontSize="xs" flex="1" minW="140px" overflowX="auto" whiteSpace="nowrap" />
				<Button size="sm" onClick={copyUrl}>Copy</Button>
			</Flex>

			{/* ---- the giveaways happening right now ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Live</Text>
					{!active && <Badge>IDLE</Badge>}
					{runs.length > 1 && <Badge colorScheme="purple">{runs.length} AT ONCE</Badge>}
					{active && <Text fontSize="sm" color="gray.600">{run.total} people entered in total</Text>}
				</Flex>

				{/* one row per giveaway. each carries its OWN count and deadline, because a viewer who entered
				    before a later giveaway opened is not in that one. */}
				{runs.map((r) => (
					<Flex key={r.id} align="center" gap={2} mb={2} wrap="wrap" fontSize="sm">
						{badgeFor(r.phase)}
						<Text flex="1" minW="180px">
							<b>{r.prize || "(no prize named)"}</b>
							{r.gifter ? ` — ${r.gifter}` : ""}
						</Text>
						<Text color="gray.600">{r.total} in</Text>
						{r.phase === "running" && r.endsAt && (
							<Text color="gray.600">{countdown(r.endsAt - Date.now())} left</Text>
						)}
						{r.phase === "winner" && <Text><b>{r.winner}</b> won</Text>}
						<Button size="xs" variant="ghost" onClick={() => endFiresaleRun(ws, r.id)}>Clear</Button>
					</Flex>
				))}

				{active && entrants.length > 0 && (
					<Wrap spacing={1} mb={2} mt={2}>
						{entrants.map((n) => (
							<WrapItem key={n}><Badge variant="subtle">{n}</Badge></WrapItem>
						))}
					</Wrap>
				)}
				{active && run.total > entrants.length && (
					<Text fontSize="xs" color="gray.500" mb={2}>
						Showing the {entrants.length} most recent of {run.total} — those are the names on screen.
					</Text>
				)}

				<HStack spacing={2} mb={2} wrap="wrap">
					<Text fontSize="sm" color="gray.500">Test run</Text>
					<NumberInput
						size="sm"
						maxW="90px"
						min={5}
						max={3600}
						value={testSec}
						onChange={(_, n) => setTestSec(Number.isFinite(n) ? Math.min(3600, Math.max(5, Math.trunc(n))) : 60)}
					>
						<NumberInputField />
					</NumberInput>
					<Text fontSize="sm" color="gray.500">sec</Text>
					<Button size="sm" colorScheme="red" onClick={() => startFiresale(ws, testSec, "", "")}>
						{active ? "Add another" : "Start"}
					</Button>
					<Button size="sm" isDisabled={!anyRunning} onClick={() => endFiresaleEntries(ws)}>
						Close entries
					</Button>
					<Button size="sm" isDisabled={!active} onClick={() => stopFiresale(ws)}>Clear all</Button>
				</HStack>

				<HStack spacing={2} wrap="wrap">
					<Input
						size="sm"
						w="180px"
						placeholder="winner's name"
						value={manualWinner}
						onChange={(e) => setManualWinner(e.currentTarget.value)}
					/>
					{/* with more than one giveaway open, a bare name is ambiguous — say which prize it won */}
					{runs.length > 1 && (
						<Select size="sm" w="220px" value={winnerRun} onChange={(e) => setWinnerRun(e.currentTarget.value)}>
							<option value="">(the one drawing)</option>
							{runs.map((r) => <option key={r.id} value={r.id}>{r.prize || r.id}</option>)}
						</Select>
					)}
					<Button
						size="sm"
						isDisabled={!active || !manualWinner.trim()}
						onClick={() => { setFiresaleWinner(ws, manualWinner.trim(), winnerRun); setManualWinner(""); }}
					>
						Set winner
					</Button>
					<Text fontSize="xs" color="gray.500">
						Only needed if Fourthwall&apos;s winner announcement never lands.
					</Text>
				</HStack>
			</Box>

			<Divider my={4} />

			{/* ---- config ---- */}
			<VStack align="stretch" spacing={3}>
				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Start automatically</Text>
					<Switch isChecked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
					<Text color="gray.500" fontSize="xs">
						Off = Fourthwall&apos;s announcements are ignored and runs are started from here or the Terminal.
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Announced by</Text>
					<Input
						size="sm"
						w="180px"
						value={draft.botName}
						placeholder="fourthwall"
						onChange={(e) => patch({ botName: e.currentTarget.value }, "botName")}
					/>
					<Text color="gray.500" fontSize="xs">
						The Twitch account whose giveaway announcements count. Blank = trust any mod.
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Entry command</Text>
					<Flex align="center">
						<Text mr={1}>!</Text>
						<Input
							size="sm"
							w="140px"
							value={draft.command}
							placeholder="enter"
							onChange={(e) => patch({ command: e.currentTarget.value.replace(/^!/, "") }, "command")}
						/>
					</Flex>
					<Text color="gray.500" fontSize="xs">
						What chatters type. Not case sensitive, and one entry per person.
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Music</Text>
					<Select size="sm" w="280px" value={draft.music} onChange={(e) => patch({ music: e.currentTarget.value })}>
						<option value="">(silent)</option>
						{MUSIC.map((f) => <option key={f} value={f}>{f}</option>)}
						{draft.music && !MUSIC.includes(draft.music) && <option value={draft.music}>{draft.music} (missing)</option>}
					</Select>
					<Input
						type="range"
						min={0}
						max={1}
						step={0.05}
						w="130px"
						p={0}
						cursor="pointer"
						value={draft.volume}
						onChange={(e) => patch({ volume: Number(e.currentTarget.value) }, "volume")}
					/>
					<Text color="gray.500" w="46px">{Math.round(draft.volume * 100)}%</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Announcer</Text>
					<Select size="sm" w="280px" value={draft.announcer} onChange={(e) => patch({ announcer: e.currentTarget.value })}>
						<option value="">(none)</option>
						{MUSIC.map((f) => <option key={f} value={f}>{f}</option>)}
						{draft.announcer && !MUSIC.includes(draft.announcer) && <option value={draft.announcer}>{draft.announcer} (missing)</option>}
					</Select>
					<Input
						type="range"
						min={0}
						max={1}
						step={0.05}
						w="130px"
						p={0}
						cursor="pointer"
						value={draft.announcerVolume}
						onChange={(e) => patch({ announcerVolume: Number(e.currentTarget.value) }, "announcerVolume")}
					/>
					<Text color="gray.500" w="46px">{Math.round(draft.announcerVolume * 100)}%</Text>
				</Flex>
				<Text fontSize="xs" color="gray.500" ml="158px" mt={-1}>
					Played once over the top of the music when a firesale starts. A source that loads into a giveaway
					already in progress stays quiet and just joins the music.
				</Text>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Win sound</Text>
					<Select size="sm" w="280px" value={draft.winSound} onChange={(e) => patch({ winSound: e.currentTarget.value })}>
						<option value="">(none)</option>
						{MUSIC.map((f) => <option key={f} value={f}>{f}</option>)}
						{draft.winSound && !MUSIC.includes(draft.winSound) && <option value={draft.winSound}>{draft.winSound} (missing)</option>}
					</Select>
					<Input
						type="range"
						min={0}
						max={1}
						step={0.05}
						w="130px"
						p={0}
						cursor="pointer"
						value={draft.winVolume}
						onChange={(e) => patch({ winVolume: Number(e.currentTarget.value) }, "winVolume")}
					/>
					<Text color="gray.500" w="46px">{Math.round(draft.winVolume * 100)}%</Text>
				</Flex>
				<Text fontSize="xs" color="gray.500" ml="158px" mt={-1}>
					Played when a winner goes up, and the looping music <b>stops</b> at that moment so it lands in the
					clear. With several giveaways open the music keeps going until the last one resolves — cutting it
					while chat is still entering another would leave the overlay silent mid-firesale.
				</Text>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Entry window</Text>
					<NumberInput
						size="sm"
						maxW="100px"
						min={5}
						max={3600}
						value={draft.fallbackSec}
						onChange={(_, n) => patch({ fallbackSec: Number.isFinite(n) ? Math.min(3600, Math.max(5, Math.trunc(n))) : 180 }, "fallbackSec")}
					>
						<NumberInputField />
					</NumberInput>
					<Text color="gray.500" fontSize="xs">
						sec — only used when the announcement doesn&apos;t say (it usually says &quot;in the next 180 seconds&quot;).
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Countdown on stream</Text>
					<Switch isChecked={draft.showCountdown} onChange={(e) => patch({ showCountdown: e.target.checked })} />
					<Text color="gray.500" fontSize="xs">
						Off = the overlay just says TYPE !{draft.command}. The entry window still runs either way — this
						is only whether viewers see the clock.
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Wait for winner</Text>
					<NumberInput
						size="sm"
						maxW="100px"
						min={0}
						max={900}
						value={draft.drawGraceSec}
						onChange={(_, n) => patch({ drawGraceSec: Number.isFinite(n) ? Math.min(900, Math.max(0, Math.trunc(n))) : 60 }, "drawGraceSec")}
					>
						<NumberInputField />
					</NumberInput>
					<Text color="gray.500" fontSize="xs">
						sec on DRAWING… before giving up on Fourthwall and picking one of the entrants at random.
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Hold the winner</Text>
					<NumberInput
						size="sm"
						maxW="100px"
						min={1}
						max={300}
						value={draft.winnerHoldSec}
						onChange={(_, n) => patch({ winnerHoldSec: Number.isFinite(n) ? Math.min(300, Math.max(1, Math.trunc(n))) : 15 }, "winnerHoldSec")}
					>
						<NumberInputField />
					</NumberInput>
					<Text color="gray.500" fontSize="xs">sec on screen before the overlay clears itself.</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Names on screen</Text>
					<NumberInput
						size="sm"
						maxW="100px"
						min={1}
						max={MAX_BOUNCERS}
						value={draft.maxBouncers}
						onChange={(_, n) => patch({ maxBouncers: Number.isFinite(n) ? Math.min(MAX_BOUNCERS, Math.max(1, Math.trunc(n))) : 120 }, "maxBouncers")}
					>
						<NumberInputField />
					</NumberInput>
					<Text color="gray.500" fontSize="xs">
						The most recent this many bounce around. Everyone else is still entered, still counted, and can
						still win.
					</Text>
				</Flex>

				<Flex align="center" gap={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="150px">Colours</Text>
					<Input type="color" w="42px" p={1} cursor="pointer" value={draft.titleColor} onChange={(e) => patch({ titleColor: e.currentTarget.value }, "titleColor")} />
					<Text color="gray.500">FIRESALE</Text>
					<Input type="color" w="42px" p={1} cursor="pointer" value={draft.nameColor} onChange={(e) => patch({ nameColor: e.currentTarget.value }, "nameColor")} />
					<Text color="gray.500">winner</Text>
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
				A <b>transparent</b> fill needs no Color Key filter — OBS composites the overlay straight over your
				scene. Pick a colour instead if you&apos;d rather key it out. The bouncing names always carry their
				own black outline, so they stay readable over anything.
				<br />
				The winner shown is always the one <b>Fourthwall</b> announces, so the overlay can never disagree with
				chat or with who gets the redeem link. The random draw above is only the fallback for an announcement
				that never arrives.
				<br />
				<b>Several giveaways at once</b> are handled: each keeps its own entrants, deadline and winner, and the
				overlay lists them together over one shared field of names. Since <Code fontSize="xs">!{draft.command}</Code>{" "}
				can&apos;t say which giveaway a viewer means, one entry joins <i>every</i> giveaway open at that moment —
				so someone who entered before a later one started isn&apos;t in it, which is why the counts differ.
				Winners are matched back to the right giveaway by the gifter and prize in Fourthwall&apos;s announcement;
				one that matches nothing waiting is reported in the Terminal rather than pinned to the wrong giveaway.
				Past four at once, the oldest is dropped to make room.
				<br />
				From the Terminal (or chat, as a mod):{" "}
				<Code fontSize="xs">firesale start 180</Code>, <Code fontSize="xs">firesale stop</Code>,{" "}
				<Code fontSize="xs">firesale draw</Code>, <Code fontSize="xs">firesale winner someone</Code>.
			</Text>
		</Box>
	);
};

export default Firesale;
