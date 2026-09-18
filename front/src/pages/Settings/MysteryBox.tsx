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
	Checkbox,
	Switch,
	Text,
	Textarea,
	VStack,
	useToast,
} from "@chakra-ui/react";
import {
	setMysteryBoxSettings,
	giveMysteryBox,
	giveRaygun,
	renameMysteryBoxOwner,
	testMysteryBox,
	stopMysteryBox,
	startQuickRevive,
	stopQuickRevive,
	resumeTimer,
	endTimeBoost,
} from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import NumberField from "../../NumberField";
import { BASE_URL } from "../../Consts";
import { canonMysteryBox, prizeImageSrc, prizeOdds, prizeProfiles, inActiveProfile, countdown, EFFECT_KINDS, MAX_PRIZES, MIN_SPIN_TILES, MAX_SPIN_TILES, DEFAULT_PRIZE } from "../../mysterybox";

// prize art in public/prizes, audio in public/media (vite.config.ts bakes both lists in at build time)
const PRIZE_IMAGES: string[] = typeof __PRIZES__ !== "undefined" ? __PRIZES__ : [];
const MEDIA_FILES: string[] = typeof __MEDIA_FILES__ !== "undefined" ? __MEDIA_FILES__ : [];
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i;
const SOUNDS = MEDIA_FILES.filter((f) => AUDIO_RE.test(f));

const SEND_DEBOUNCE = 300; // colour pickers and typing fire continuously; the socket rate-limits per connection

// The mystery box is what putting an item up for firesale earns you. Fourthwall announces a giveaway, the
// gifter is credited one box, and they spend it with "!mb open" in chat — which takes over the /mysterybox
// browser source and lands on a prize whose effect then fires for real. Everything here applies immediately —
// no Save.
const MysteryBox: React.FC<{ ws: any; token: string | null; settings: any; run: any; revive: any; products: any[] | null }> = ({ ws, token, settings, run, revive, products }) => {
	const toast = useToast();

	const server = canonMysteryBox(settings.mysteryBoxSettings || {});
	const serverStr = JSON.stringify(server);
	const [draft, setDraft] = useState<any>(server);
	// between an edit and its sync the server's copy is OLDER than the screen, so following it would undo
	// keystrokes; once it agrees again we go back to following it. mirrors the Firesale tab.
	const sentRef = useRef(serverStr);
	const pendingRef = useRef(0);
	const timers = useRef<{ [key: string]: any }>({});
	const [giveName, setGiveName] = useState("");
	const [giveCount, setGiveCount] = useState(1);
	const [mergeFrom, setMergeFrom] = useState("");
	const [mergeTo, setMergeTo] = useState("");
	const [openPrize, setOpenPrize] = useState<string>("");
	const [itemRule, setItemRule] = useState("");
	// the live open and the pause both carry deadlines, so the countdowns here tick on their own
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

	const phase: string = (run && run.phase) || "idle";
	const pause = settings.timerPause || null;
	const boost = settings.timeBoost || null;
	// the quick revive challenge: running, decided (won/lost, result still up), or idle
	const revivePhase: string = (revive && revive.phase) || "idle";
	const ticking = phase !== "idle" || !!pause || !!boost || revivePhase !== "idle";

	useEffect(() => {
		if (!ticking)
			return;
		const id = setInterval(() => setTick((n) => n + 1), 500);
		return () => clearInterval(id);
	}, [ticking]);

	const later = (key: string, fn: () => void, delay: number) => {
		clearTimeout(timers.current[key]);
		timers.current[key] = setTimeout(fn, delay);
	};

	// mark the screen as ahead of the server, then push (now, or coalesced for the controls that fire per pixel)
	const patch = (p: any, key?: string) => {
		const next = { ...draft, ...p };
		setDraft(next);
		sentRef.current = JSON.stringify(canonMysteryBox(next));
		pendingRef.current = Date.now();
		if (key)
			later(key, () => setMysteryBoxSettings(ws, next), SEND_DEBOUNCE);
		else
			setMysteryBoxSettings(ws, next);
	};

	// one prize changed. the whole list goes back every time, which is what keeps the server's copy and this
	// one the same shape — the normalizer there rebuilds it from scratch either way.
	const patchPrize = (id: string, p: any, key?: string) =>
		patch({ prizes: draft.prizes.map((z: any) => (z.id === id ? { ...z, ...p } : z)) }, key);

	const patchEffect = (id: string, p: any, key?: string) =>
		patch({ prizes: draft.prizes.map((z: any) => (z.id === id ? { ...z, effect: { ...z.effect, ...p } } : z)) }, key);

	// one chant in a chant prize's list changed
	const patchChant = (id: string, i: number, p: any, key?: string) =>
		patch({ prizes: draft.prizes.map((z: any) => (z.id === id
			? { ...z, effect: { ...z.effect, chants: z.effect.chants.map((c: any, j: number) => (j === i ? { ...c, ...p } : c)) } }
			: z)) }, key);

	// the quick revive's settings ride inside the same blob, so they go up the same way
	const patchRevive = (p: any, key?: string) => patch({ quickRevive: { ...draft.quickRevive, ...p } }, key);

	const addPrize = () => {
		if (draft.prizes.length >= MAX_PRIZES)
			return;
		// ids only have to be unique within the list, and a timestamp is the cheapest way to be sure of that
		const id = `p${Date.now().toString(36)}`;
		patch({ prizes: [...draft.prizes, { ...DEFAULT_PRIZE, id, name: `Prize ${draft.prizes.length + 1}`, effect: { ...DEFAULT_PRIZE.effect } }] });
	};

	const removePrize = (id: string) => patch({ prizes: draft.prizes.filter((z: any) => z.id !== id) });

	const addItemRule = () => {
		const v = itemRule.trim();
		if (!v || draft.firesaleItems.includes(v))
			return;
		patch({ firesaleItems: [...draft.firesaleItems, v] });
		setItemRule("");
	};

	const url = `${BASE_URL}/mysterybox?token=${encodeURIComponent(token || "")}`;

	const copyUrl = () => {
		copyText(url).then((ok) =>
			toast(ok
				? { title: "Source URL copied", status: "success", duration: 1500 }
				: { title: "Couldn't copy — reveal the URL and copy it manually", status: "error", duration: 3000 }));
	};

	// the ledger, biggest holdings first — that's who is about to spend one
	const boxes: { [key: string]: any } = settings.mysteryBoxes || {};
	const owners = Object.keys(boxes)
		.map((k) => ({ key: k, name: boxes[k].name || k, count: boxes[k].count || 0 }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	const outstanding = owners.reduce((sum, o) => sum + o.count, 0);
	// unfired ray gun shots — the same kind of wallet, won from a prize instead of a firesale
	const guns: { [key: string]: any } = settings.rayguns || {};
	const gunners = Object.keys(guns)
		.map((k) => ({ key: k, name: guns[k].name || k, count: guns[k].count || 0 }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

	// what the /events and /text effects can point at
	// the profiles that exist, and what the current one leaves in play
	const profiles = prizeProfiles(draft.prizes, draft.activeProfile);
	const inPlay = draft.prizes.filter((p: any) => p.enabled && p.weight > 0 && inActiveProfile(draft.activeProfile, p));
	const events: any[] = Array.isArray(settings.timerEvents) ? settings.timerEvents : [];
	const textBoxes: any[] = Array.isArray(settings.textBoxes) ? settings.textBoxes : [];

	const badge = phase === "spinning"
		? <Badge colorScheme="purple">SPINNING</Badge>
		: phase === "reveal"
			? <Badge colorScheme="green">PRIZE UP</Badge>
			: <Badge>IDLE</Badge>;

	const qr = draft.quickRevive;
	const reviveBadge = revivePhase === "running"
		? <Badge colorScheme="purple">RUNNING</Badge>
		: revivePhase === "won"
			? <Badge colorScheme="green">REVIVED</Badge>
			: revivePhase === "lost"
				? <Badge colorScheme="red">FAILED</Badge>
				: <Badge>IDLE</Badge>;

	// the inputs one effect kind needs, rendered from its `needs` list so the editor can't offer a field the
	// server would ignore
	const effectFields = (prize: any) => {
		const spec = EFFECT_KINDS.find((k) => k.key === prize.effect.kind) || EFFECT_KINDS[0];
		return (
			<VStack align="stretch" spacing={2} mt={2}>
				<Text fontSize="xs" color="gray.500">{spec.hint}</Text>
				<HStack spacing={2} wrap="wrap">
					{spec.needs.includes("rounds") && (
						<HStack spacing={1}>
							<NumberField
								width="80px"
								min={1}
								max={50}
								value={prize.effect.rounds}
								onCommit={(n) => patchEffect(prize.id, { rounds: n }, `rd${prize.id}`)}
							/>
							<Text fontSize="sm" color="gray.600">round{prize.effect.rounds === 1 ? "" : "s"}, each drawn from the list below</Text>
						</HStack>
					)}
					{spec.needs.includes("seconds") && (
						<HStack spacing={1}>
							<Text fontSize="sm" color="gray.600">
								{prize.effect.kind === "pauseTimer" ? "Pause for"
									: prize.effect.kind === "timebomb" ? "Each contribution buys"
									: prize.effect.kind === "textBox" ? "Hold for"
									: prize.effect.kind === "timeBoost" ? "for"
									: prize.effect.kind === "nuke" ? ""
									: prize.effect.kind === "raygun" ? ""
									: "Seconds"}
							</Text>
							<NumberField
								width="110px"
								min={0}
								max={86400}
								value={prize.effect.seconds}
								onCommit={(n) => patchEffect(prize.id, { seconds: n }, `sec${prize.id}`)}
							/>
							<Text fontSize="sm" color="gray.500">
								{prize.effect.seconds >= 60 ? `= ${countdown(prize.effect.seconds * 1000)}` : "sec"}
							</Text>
						</HStack>
					)}
					{spec.needs.includes("reward") && (
						<HStack spacing={1}>
							<Text fontSize="sm" color="gray.600">for</Text>
							<NumberField
								width="110px"
								min={0}
								max={86400}
								value={prize.effect.rewardSeconds}
								onCommit={(n) => patchEffect(prize.id, { rewardSeconds: n }, `rw${prize.id}`)}
							/>
							<Text fontSize="sm" color="gray.500">
								{prize.effect.rewardSeconds >= 60 ? `sec = +${countdown(prize.effect.rewardSeconds * 1000)}` : "sec on the timer"}
							</Text>
						</HStack>
					)}
					{spec.needs.includes("streak") && (
						<HStack spacing={1}>
							<Switch
								size="sm"
								isChecked={prize.effect.streak}
								onChange={(e) => patchEffect(prize.id, { streak: e.target.checked })}
							/>
							<Text fontSize="sm" color="gray.600">in a row</Text>
							<Text fontSize="xs" color="gray.500">(any other line resets the count)</Text>
						</HStack>
					)}
					{spec.needs.includes("factor") && (
						<HStack spacing={1}>
							<Text fontSize="sm" color="gray.600">Everything is worth</Text>
							<Text fontSize="sm" color="gray.500">x</Text>
							<NumberField
								width="80px"
								min={2}
								max={10}
								value={prize.effect.factor}
								onCommit={(n) => patchEffect(prize.id, { factor: n }, `f${prize.id}`)}
							/>
						</HStack>
					)}
					{spec.needs.includes("charges") && (
						<HStack spacing={1}>
							<Text fontSize="sm" color="gray.600">Gives</Text>
							<NumberField
								width="80px"
								min={1}
								max={99}
								value={prize.effect.charges}
								onCommit={(n) => patchEffect(prize.id, { charges: n }, `ch${prize.id}`)}
							/>
							<Text fontSize="sm" color="gray.500">shots, each</Text>
						</HStack>
					)}
					{spec.needs.includes("boxes") && (
						<HStack spacing={1}>
							<Text fontSize="sm" color="gray.600">Gives</Text>
							<NumberField
								width="80px"
								min={1}
								max={99}
								value={prize.effect.boxes}
								onCommit={(n) => patchEffect(prize.id, { boxes: n }, `bx${prize.id}`)}
							/>
							<Text fontSize="sm" color="gray.500">more boxes</Text>
						</HStack>
					)}
					{spec.needs.includes("percent") && (
						<HStack spacing={1}>
							<Text fontSize="sm" color="gray.600">Hits</Text>
							<NumberField
								width="80px"
								min={1}
								max={100}
								value={prize.effect.percent}
								onCommit={(n) => patchEffect(prize.id, { percent: n }, `pc${prize.id}`)}
							/>
							<Text fontSize="sm" color="gray.500">% of chat, for</Text>
						</HStack>
					)}
					{spec.needs.includes("eventId") && (
						<Select
							size="sm"
							maxW="260px"
							value={prize.effect.eventId}
							onChange={(e) => patchEffect(prize.id, { eventId: e.target.value })}
						>
							<option value="">(pick an event)</option>
							{events.map((ev) => (
								<option key={ev.id} value={ev.id}>{ev.name || ev.id}</option>
							))}
						</Select>
					)}
					{spec.needs.includes("box") && (
						<Select
							size="sm"
							maxW="200px"
							value={prize.effect.box}
							onChange={(e) => patchEffect(prize.id, { box: e.target.value })}
						>
							<option value="">(pick a text box)</option>
							{textBoxes.map((b) => (
								<option key={b.id} value={b.name || b.id}>{b.name || b.id}</option>
							))}
						</Select>
					)}
				</HStack>
				{spec.needs.includes("loopSound") && (
					<HStack spacing={2} wrap="wrap">
						<Text fontSize="sm" color="gray.600">Loop</Text>
						<Select
							size="sm"
							maxW="240px"
							value={prize.effect.loopSound}
							onChange={(e) => patchEffect(prize.id, { loopSound: e.target.value })}
						>
							<option value="">(no music)</option>
							{SOUNDS.map((f) => (
								<option key={f} value={f}>{f}</option>
							))}
						</Select>
						<Text fontSize="sm" color="gray.600">Vol</Text>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={prize.effect.loopVolume}
							onChange={(e) => patchEffect(prize.id, { loopVolume: Number(e.target.value) }, `lv${prize.id}`)}
						/>
						<Text fontSize="xs" color="gray.500">
							plays on the Mystery Box source for as long as it lasts
						</Text>
					</HStack>
				)}
				{spec.needs.includes("chants") && (
					<VStack align="stretch" spacing={1}>
						{prize.effect.chants.length === 0 && (
							<Text fontSize="xs" color="red.300">Nothing for chat to say yet — add a chant.</Text>
						)}
						{prize.effect.chants.map((c: any, i: number) => (
							<HStack key={i} spacing={2} wrap="wrap">
								<Text fontSize="sm" color="gray.600">Say</Text>
								<Input
									size="sm"
									maxW="180px"
									placeholder="movies"
									value={c.phrase}
									onChange={(e) => patchChant(prize.id, i, { phrase: e.target.value }, `cp${prize.id}${i}`)}
								/>
								<NumberField
									width="80px"
									min={1}
									max={10000}
									value={c.times}
									onCommit={(n) => patchChant(prize.id, i, { times: n }, `ct${prize.id}${i}`)}
								/>
								<Text fontSize="sm" color="gray.600">times within</Text>
								<NumberField
									width="80px"
									min={5}
									max={3600}
									value={c.seconds}
									onCommit={(n) => patchChant(prize.id, i, { seconds: n }, `cs${prize.id}${i}`)}
								/>
								<Text fontSize="sm" color="gray.600">sec</Text>
								<Button
									size="xs"
									variant="ghost"
									colorScheme="red"
									onClick={() => patchEffect(prize.id, { chants: prize.effect.chants.filter((_: any, j: number) => j !== i) })}
								>
									remove
								</Button>
							</HStack>
						))}
						<HStack>
							<Button
								size="xs"
								isDisabled={prize.effect.chants.length >= 20}
								onClick={() => patchEffect(prize.id, { chants: [...prize.effect.chants, { phrase: "", times: 20, seconds: 60 }] })}
							>
								Add chant
							</Button>
							{prize.effect.chants.length > 0 && prize.effect.chants.some((c: any) => !c.phrase.trim()) && (
								<Text fontSize="xs" color="gray.500">a chant with no words is dropped when it&apos;s saved</Text>
							)}
						</HStack>
					</VStack>
				)}
				{spec.needs.includes("resultSounds") && (
					<HStack spacing={2} wrap="wrap">
						<Badge colorScheme="green">MADE IT</Badge>
						<Select
							size="sm"
							maxW="220px"
							value={prize.effect.winSound}
							onChange={(e) => patchEffect(prize.id, { winSound: e.target.value })}
						>
							<option value="">(sound: none)</option>
							{SOUNDS.map((f) => (
								<option key={f} value={f}>{f}</option>
							))}
						</Select>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={prize.effect.winVolume}
							onChange={(e) => patchEffect(prize.id, { winVolume: Number(e.target.value) }, `wv${prize.id}`)}
						/>
						<Badge colorScheme="red">TOO SLOW</Badge>
						<Select
							size="sm"
							maxW="220px"
							value={prize.effect.failSound}
							onChange={(e) => patchEffect(prize.id, { failSound: e.target.value })}
						>
							<option value="">(sound: none)</option>
							{SOUNDS.map((f) => (
								<option key={f} value={f}>{f}</option>
							))}
						</Select>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={prize.effect.failVolume}
							onChange={(e) => patchEffect(prize.id, { failVolume: Number(e.target.value) }, `fv${prize.id}`)}
						/>
					</HStack>
				)}
				{spec.needs.includes("freezeColor") && (
					<HStack spacing={2} wrap="wrap">
						<Text fontSize="sm" color="gray.600">Timer turns</Text>
						<input
							type="color"
							value={prize.effect.freezeColor || "#5bd5ff"}
							onChange={(e) => patchEffect(prize.id, { freezeColor: e.target.value }, `fc${prize.id}`)}
						/>
						{prize.effect.freezeColor ? (
							<>
								<HStack spacing={1}>
									<Switch
										size="sm"
										isChecked={prize.effect.freezePulse}
										onChange={(e) => patchEffect(prize.id, { freezePulse: e.target.checked })}
									/>
									<Text fontSize="sm" color="gray.600">pulse</Text>
								</HStack>
								<Button size="xs" variant="ghost" onClick={() => patchEffect(prize.id, { freezeColor: "" })}>
									leave it alone
								</Button>
							</>
						) : (
							<Text fontSize="xs" color="gray.500">not tinted — pick a colour to turn the digits while it holds</Text>
						)}
						<Text fontSize="xs" color="gray.500">
							{prize.effect.freezeColor
								? prize.effect.freezePulse
									? "the countdown beats between its normal colour and this one for as long as the freeze lasts"
									: "the countdown holds this colour for as long as the freeze lasts"
								: ""}
						</Text>
					</HStack>
				)}
				{spec.needs.includes("text") && (
					<Textarea
						size="sm"
						rows={2}
						placeholder="What the text box should say"
						value={prize.effect.text}
						onChange={(e) => patchEffect(prize.id, { text: e.target.value }, `txt${prize.id}`)}
					/>
				)}
			</VStack>
		);
	};

	return (
		<Box maxW="960px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={2}>
				One OBS <b>Browser</b> source for mystery boxes. Putting an item up for firesale earns the gifter
				one box; they spend it by typing <Code fontSize="xs">!{draft.command} open</Code> in chat, and the
				source spins through the prize art and stops on what they won. The prize's effect then fires for
				real — time, a pause, a clip, whatever it's set to.
			</Text>
			<Text fontSize="sm" color="gray.600" mb={3}>
				Size the source <b>4:3</b> (800×600 or 1024×768), same as the Firesale source. It draws nothing
				between opens, so it can stay in the scene permanently. <b>Only one box opens at a time</b> — anyone
				else who types while a box is open is ignored and keeps theirs. Everything here applies immediately —
				no Save.
			</Text>

			<Flex align="center" gap={2} mb={4} wrap="wrap">
				<MaskedUrl url={url} p={2} fontSize="xs" flex="1" minW="140px" overflowX="auto" whiteSpace="nowrap" />
				<Button size="sm" onClick={copyUrl}>Copy</Button>
			</Flex>

			{/* ---- what's happening right now ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Live</Text>
					{badge}
					{phase !== "idle" && (
						<Text fontSize="sm" color="gray.600">
							<b>{run.opener}</b>
							{phase === "spinning" && run.endsAt ? ` — landing in ${Math.max(0, Math.ceil((run.endsAt - Date.now()) / 1000))}s` : ""}
							{phase === "reveal" && run.prize ? ` won ${run.prize.name || run.prize.id}` : ""}
						</Text>
					)}
					{phase !== "idle" && <Button size="xs" variant="ghost" onClick={() => stopMysteryBox(ws)}>Clear</Button>}
				</Flex>

				{/* one thing at a time: while anything is playing out, "!mb open" is answered with a reason
				    rather than queued, so it's worth showing the operator what chat is being told */}
				{!draft.allowOpening && draft.enabled && (
					<Text fontSize="sm" color="orange.300" mb={2}>
						Chat can&apos;t open boxes at the moment — they&apos;re still earning them, and you can still
						open one from here.
					</Text>
				)}
				{run && run.blocked && (
					<Text fontSize="sm" color="orange.300" mb={2}>
						Chat can&apos;t open a box right now — {run.blocked}.
					</Text>
				)}

				{/* a prize that pauses the timer outlives the reveal by minutes, so it gets its own line — and its
				    own way out, for when it has to end early */}
				{pause && (
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Badge colorScheme="orange">{pause.rollMs ? "TIMEBOMB" : "TIMER PAUSED"}</Badge>
						<Text fontSize="sm" color="gray.600">
							{countdown(pause.until - Date.now())} left — {pause.reason}
							{pause.rollMs ? ` (each contribution resets it to ${Math.round(pause.rollMs / 1000)}s)` : ""}
						</Text>
						<Button size="xs" onClick={() => resumeTimer(ws)}>Resume now</Button>
					</Flex>
				)}

				{boost && (
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Badge colorScheme="red">x{boost.factor} ON EVERYTHING</Badge>
						<Text fontSize="sm" color="gray.600">
							{countdown(boost.until - Date.now())} left — {boost.reason}
						</Text>
						<Button size="xs" onClick={() => endTimeBoost(ws)}>End now</Button>
					</Flex>
				)}

				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="gray.500">Test spin</Text>
					<Select size="sm" maxW="220px" value={openPrize} onChange={(e) => setOpenPrize(e.target.value)}>
						<option value="">(a fair draw)</option>
						{draft.prizes.map((p: any) => (
							<option key={p.id} value={p.id}>{p.name || p.id}</option>
						))}
					</Select>
					<Button size="sm" onClick={() => testMysteryBox(ws, openPrize)} isDisabled={!draft.prizes.length}>
						Spin
					</Button>
					<Text fontSize="xs" color="gray.500">
						Spends nobody's box — but the prize's effect fires for real, exactly as it would in front of chat.
					</Text>
				</HStack>
			</Box>

			{/* ---- quick revive: the hand-started challenge that runs on the same source ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Quick revive</Text>
					{reviveBadge}
					{revivePhase === "running" && (
						<Text fontSize="sm" color="gray.600">
							{revive.kind === "chant" ? <><b>{revive.title}</b> — </> : null}
							<b>{revive.points} / {revive.goal}</b> {String(revive.unit || "sub points").toLowerCase()} — {countdown(revive.endsAt - Date.now())} left
						</Text>
					)}
					{(revivePhase === "won" || revivePhase === "lost") && (
						<Text fontSize="sm" color="gray.600">
							{revivePhase === "won" ? revive.winText : revive.failText} — chat got <b>{revive.points} / {revive.goal}</b> {String(revive.unit || "sub points").toLowerCase()}
						</Text>
					)}
					<Box flex="1" />
					<Button
						size="sm"
						colorScheme="green"
						isDisabled={revivePhase !== "idle" || phase !== "idle"}
						title={phase !== "idle" ? "Wait for the box on screen to finish" : ""}
						onClick={() => startQuickRevive(ws)}
					>
						Start quick revive
					</Button>
					{revivePhase !== "idle" && (
						<Button size="xs" variant="ghost" onClick={() => stopQuickRevive(ws)}>
							{revivePhase === "running" ? "Call off" : "Clear"}
						</Button>
					)}
				</Flex>
				<Text fontSize="xs" color="gray.500" mb={3}>
					Chat gets <b>{qr.seconds}s</b> to put up <b>{qr.points}</b> sub points, on the Mystery Box source. Points
					are weighted the way Twitch weights them: Tier 1 and Prime count 1, Tier 2 counts 2, Tier 3 counts 6,
					and a gift bomb counts every sub in it. A YouTube or Kick membership counts 1. Subs a mod adds by hand
					count too, so <Code fontSize="xs">twitch sub_t3</Code> in the Terminal is how you rehearse it — or
					start and stop it from there with <Code fontSize="xs">mb revive</Code> and <Code fontSize="xs">mb revive stop</Code>.
					Boxes can&apos;t be opened while it runs.
				</Text>

				<VStack align="stretch" spacing={2}>
					<HStack spacing={2} wrap="wrap">
						<Text fontSize="sm" color="gray.600">Chat gets</Text>
						<NumberField width="90px" min={5} max={3600} value={qr.seconds} onCommit={(n) => patchRevive({ seconds: n }, "qrsec")} />
						<Text fontSize="sm" color="gray.600">seconds to reach</Text>
						<NumberField width="90px" min={1} max={100000} value={qr.points} onCommit={(n) => patchRevive({ points: n }, "qrpts")} />
						<Text fontSize="sm" color="gray.600">sub points. Result stays up</Text>
						<NumberField width="80px" min={1} max={60} value={qr.holdSec} onCommit={(n) => patchRevive({ holdSec: n }, "qrhold")} />
						<Text fontSize="sm" color="gray.600">s</Text>
						<HStack spacing={1} ml={2}>
							<Switch size="sm" isChecked={qr.announce} onChange={(e) => patchRevive({ announce: e.target.checked })} />
							<Text fontSize="sm" color="gray.600">Announce in chat</Text>
						</HStack>
					</HStack>

					<HStack spacing={2} wrap="wrap">
						<Text fontSize="sm" color="gray.600">Title</Text>
						<Input
							size="sm"
							maxW="220px"
							value={qr.title}
							onChange={(e) => patchRevive({ title: e.target.value }, "qrtitle")}
						/>
						<Text fontSize="sm" color="gray.600" ml={2}>Music loop</Text>
						<Select
							size="sm"
							maxW="240px"
							value={qr.music}
							onChange={(e) => patchRevive({ music: e.target.value })}
						>
							<option value="">(no music)</option>
							{SOUNDS.map((f) => (
								<option key={f} value={f}>{f}</option>
							))}
						</Select>
						<Text fontSize="sm" color="gray.600">Vol</Text>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={qr.musicVolume}
							onChange={(e) => patchRevive({ musicVolume: Number(e.target.value) }, "qrmv")}
						/>
						<Text fontSize="xs" color="gray.500">loops while the clock runs, stops the moment it&apos;s decided</Text>
					</HStack>

					<HStack spacing={2} wrap="wrap">
						<Badge colorScheme="green">WIN</Badge>
						<Select
							size="sm"
							maxW="240px"
							value={qr.winSound}
							onChange={(e) => patchRevive({ winSound: e.target.value })}
						>
							<option value="">(sound: none)</option>
							{SOUNDS.map((f) => (
								<option key={f} value={f}>{f}</option>
							))}
						</Select>
						<Text fontSize="sm" color="gray.600">Vol</Text>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={qr.winVolume}
							onChange={(e) => patchRevive({ winVolume: Number(e.target.value) }, "qrwv")}
						/>
						<Input
							size="sm"
							maxW="260px"
							placeholder="What goes up on stream"
							value={qr.winText}
							onChange={(e) => patchRevive({ winText: e.target.value }, "qrwt")}
						/>
					</HStack>

					<HStack spacing={2} wrap="wrap">
						<Badge colorScheme="red">FAIL</Badge>
						<Select
							size="sm"
							maxW="240px"
							value={qr.failSound}
							onChange={(e) => patchRevive({ failSound: e.target.value })}
						>
							<option value="">(sound: none)</option>
							{SOUNDS.map((f) => (
								<option key={f} value={f}>{f}</option>
							))}
						</Select>
						<Text fontSize="sm" color="gray.600">Vol</Text>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={qr.failVolume}
							onChange={(e) => patchRevive({ failVolume: Number(e.target.value) }, "qrfv")}
						/>
						<Input
							size="sm"
							maxW="260px"
							placeholder="What goes up on stream"
							value={qr.failText}
							onChange={(e) => patchRevive({ failText: e.target.value }, "qrft")}
						/>
					</HStack>
				</VStack>
			</Box>

			{/* ---- who is holding boxes ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Boxes owed</Text>
					<Text fontSize="sm" color="gray.600">
						{outstanding} unopened across {owners.length} {owners.length === 1 ? "person" : "people"}
					</Text>
				</Flex>

				{owners.length === 0 && (
					<Text fontSize="sm" color="gray.500" mb={2}>
						Nobody is holding a box yet. One is credited each time Fourthwall announces a giveaway, to
						whoever it names as the gifter.
					</Text>
				)}

				<VStack align="stretch" spacing={1} mb={3} maxH="220px" overflowY="auto">
					{owners.map((o) => (
						<Flex key={o.key} align="center" gap={2} fontSize="sm">
							<Text flex="1" minW="140px">{o.name}</Text>
							<Badge colorScheme={o.count > 0 ? "yellow" : "gray"}>{o.count}</Badge>
							<Button size="xs" variant="ghost" onClick={() => giveMysteryBox(ws, o.key, 1)}>+1</Button>
							<Button size="xs" variant="ghost" onClick={() => giveMysteryBox(ws, o.key, -1)}>−1</Button>
						</Flex>
					))}
				</VStack>

				<HStack spacing={2} mb={2} wrap="wrap">
					<Input
						size="sm"
						maxW="200px"
						placeholder="Twitch name"
						value={giveName}
						onChange={(e) => setGiveName(e.target.value)}
					/>
					<NumberField width="90px" min={1} max={99} value={giveCount} onCommit={setGiveCount} />
					<Button
						size="sm"
						isDisabled={!giveName.trim()}
						onClick={() => { giveMysteryBox(ws, giveName.trim(), giveCount); setGiveName(""); }}
					>
						Give
					</Button>
				</HStack>

				<Divider my={2} />
				<Text fontSize="xs" color="gray.500" mb={2}>
					A firesale box is credited to the name <b>Fourthwall</b> printed, which is a display name and
					isn't always the Twitch login that types <Code fontSize="xs">!{draft.command} open</Code>. When
					they differ, move the boxes across:
				</Text>
				<HStack spacing={2} wrap="wrap">
					<Input size="sm" maxW="180px" placeholder="From (the name above)" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} />
					<Text fontSize="sm" color="gray.500">→</Text>
					<Input size="sm" maxW="180px" placeholder="To (their Twitch login)" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} />
					<Button
						size="sm"
						isDisabled={!mergeFrom.trim() || !mergeTo.trim()}
						onClick={() => { renameMysteryBoxOwner(ws, mergeFrom.trim(), mergeTo.trim()); setMergeFrom(""); setMergeTo(""); }}
					>
						Move
					</Button>
				</HStack>
			</Box>

			{gunners.length > 0 && (
				<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Text fontWeight="bold">Ray gun shots</Text>
						<Text fontSize="sm" color="gray.600">
							unfired — each one times somebody out with{" "}
							<Code fontSize="xs">!{draft.raygunCommand} &lt;name&gt;</Code>
						</Text>
					</Flex>
					<VStack align="stretch" spacing={1} maxH="160px" overflowY="auto">
						{gunners.map((g) => (
							<Flex key={g.key} align="center" gap={2} fontSize="sm">
								<Text flex="1" minW="140px">{g.name}</Text>
								<Badge colorScheme="red">{g.count}</Badge>
								<Button size="xs" variant="ghost" onClick={() => giveRaygun(ws, g.key, 1)}>+1</Button>
								<Button size="xs" variant="ghost" onClick={() => giveRaygun(ws, g.key, -1)}>−1</Button>
							</Flex>
						))}
					</VStack>
				</Box>
			)}

			{/* ---- the prizes ---- */}
			<Flex align="center" gap={3} mb={2} wrap="wrap">
				<Text fontWeight="bold">Prizes</Text>
				<Text fontSize="sm" color="gray.600">
					Rarity is a weight, not a percentage — the odds beside each one are what it works out to.
				</Text>
				<Box flex="1" />
				<Button size="sm" onClick={addPrize} isDisabled={draft.prizes.length >= MAX_PRIZES}>Add prize</Button>
			</Flex>

			{/* which set is in play. a prize with no profile is always in, so this only ever ADDS to the pile
			    — switching can't leave the box with nothing to give. */}
			<Flex align="center" gap={2} mb={3} wrap="wrap">
				<Text fontSize="sm" color="gray.600">Playing</Text>
				<Select
					size="sm"
					maxW="220px"
					value={draft.activeProfile}
					onChange={(e) => patch({ activeProfile: e.target.value })}
				>
					<option value="">(no profile — just the always-on prizes)</option>
					{profiles.map((n) => (
						<option key={n} value={n}>{n}</option>
					))}
				</Select>
				<Badge colorScheme={inPlay.length ? "green" : "red"}>
					{inPlay.length} prize{inPlay.length === 1 ? "" : "s"} in play
				</Badge>
				{draft.prizes.length > inPlay.length && (
					<Text fontSize="xs" color="gray.500">
						{draft.prizes.length - inPlay.length} set aside for another profile
					</Text>
				)}
				{!inPlay.length && draft.prizes.length > 0 && (
					<Text fontSize="xs" color="red.300">
						Nothing can be won right now — every prize is disabled, zero-rarity, or in another profile.
					</Text>
				)}
			</Flex>

			{/* every profile that has been named on a prize, so the field below can autocomplete them */}
			<datalist id="mb-profiles">
				{profiles.map((n) => <option key={n} value={n} />)}
			</datalist>

			{draft.prizes.length === 0 && (
				<Text fontSize="sm" color="gray.500" mb={3}>
					No prizes yet. Add one, drop its art into <Code fontSize="xs">front/public/prizes</Code>, and pick
					what it does.
				</Text>
			)}

			<VStack align="stretch" spacing={3} mb={5}>
				{draft.prizes.map((p: any) => {
					const odds = prizeOdds(draft.prizes, p, draft.activeProfile);
					const live = inActiveProfile(draft.activeProfile, p);
					const img = prizeImageSrc(p.image);
					return (
						<Box key={p.id} borderWidth="1px" borderRadius="md" p={3} opacity={p.enabled && live ? 1 : 0.55}>
							<Flex gap={3} wrap="wrap">
								{/* the art, at the shape the reel draws it */}
								<Box
									w="86px"
									h="86px"
									flex="0 0 auto"
									borderWidth="1px"
									borderRadius="md"
									bg="gray.50"
									display="flex"
									alignItems="center"
									justifyContent="center"
									overflow="hidden"
								>
									{img
										? <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
										: <Text fontSize="xs" color="gray.400">no art</Text>}
								</Box>

								<VStack align="stretch" spacing={2} flex="1" minW="280px">
									<HStack spacing={2} wrap="wrap">
										<Input
											size="sm"
											maxW="200px"
											placeholder="Prize name"
											value={p.name}
											onChange={(e) => patchPrize(p.id, { name: e.target.value }, `n${p.id}`)}
										/>
										<Input
											size="sm"
											maxW="150px"
											list="mb-profiles"
											placeholder="always on"
											title="Leave blank and this prize is in play whatever profile is selected. Type a name to make it part of that profile only."
											value={p.profile}
											onChange={(e) => patchPrize(p.id, { profile: e.target.value }, `pr${p.id}`)}
										/>
										<HStack spacing={1}>
											<Text fontSize="sm" color="gray.600">Rarity</Text>
											<NumberField
												width="90px"
												min={0}
												max={1000}
												value={p.weight}
												onCommit={(n) => patchPrize(p.id, { weight: n }, `w${p.id}`)}
											/>
											{/* two decimals throughout: rounding to whole numbers hid the difference between
											    a 1-in-200 prize and a 1-in-2000 one, which is exactly the end of the range
											    the weights are being tuned at */}
											<Badge colorScheme={odds > 0 ? "blue" : "gray"}>
												{odds > 0 ? `${odds.toFixed(2)}%` : live ? "never" : "other profile"}
											</Badge>
										</HStack>
										<HStack spacing={1}>
											<Text fontSize="sm" color="gray.600">On</Text>
											<Switch
												size="sm"
												isChecked={p.enabled}
												onChange={(e) => patchPrize(p.id, { enabled: e.target.checked })}
											/>
										</HStack>
										<Box flex="1" />
										<Button size="xs" onClick={() => testMysteryBox(ws, p.id)}>Test</Button>
										<Button size="xs" variant="ghost" colorScheme="red" onClick={() => removePrize(p.id)}>Delete</Button>
									</HStack>

									<HStack spacing={2} wrap="wrap">
										<Select
											size="sm"
											maxW="200px"
											value={PRIZE_IMAGES.includes(p.image) ? p.image : ""}
											onChange={(e) => patchPrize(p.id, { image: e.target.value })}
										>
											<option value="">(art: none)</option>
											{PRIZE_IMAGES.map((f) => (
												<option key={f} value={f}>{f}</option>
											))}
										</Select>
										<Input
											size="sm"
											maxW="240px"
											placeholder="…or an image URL"
											value={PRIZE_IMAGES.includes(p.image) ? "" : p.image}
											onChange={(e) => patchPrize(p.id, { image: e.target.value }, `i${p.id}`)}
										/>
									</HStack>

									<HStack spacing={2} wrap="wrap">
										<Select
											size="sm"
											maxW="240px"
											value={p.sound}
											onChange={(e) => patchPrize(p.id, { sound: e.target.value })}
										>
											<option value="">(sound: none)</option>
											{SOUNDS.map((f) => (
												<option key={f} value={f}>{f}</option>
											))}
										</Select>
										<Text fontSize="sm" color="gray.600">Vol</Text>
										<input
											type="range"
											min={0}
											max={1}
											step={0.05}
											value={p.volume}
											onChange={(e) => patchPrize(p.id, { volume: Number(e.target.value) }, `v${p.id}`)}
										/>
										<Input
											size="sm"
											maxW="220px"
											placeholder="Line under the name on stream"
											value={p.blurb}
											onChange={(e) => patchPrize(p.id, { blurb: e.target.value }, `b${p.id}`)}
										/>
									</HStack>

									<Divider />

									<HStack spacing={2} wrap="wrap">
										<Text fontSize="sm" color="gray.600">Does</Text>
										<Select
											size="sm"
											maxW="220px"
											value={p.effect.kind}
											onChange={(e) => patchEffect(p.id, { kind: e.target.value })}
										>
											{EFFECT_KINDS.map((k) => (
												<option key={k.key} value={k.key}>{k.label}</option>
											))}
										</Select>
									</HStack>
									{effectFields(p)}
								</VStack>
							</Flex>
						</Box>
					);
				})}
			</VStack>

			{/* ---- how it behaves ---- */}
			<Text fontWeight="bold" mb={2}>Behaviour</Text>
			<VStack align="stretch" spacing={3} mb={5}>
				<HStack spacing={3} wrap="wrap">
					<HStack spacing={2}>
						<Switch isChecked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
						<Text fontSize="sm">Mystery boxes on</Text>
					</HStack>
					<HStack spacing={2}>
						<Switch
							isChecked={draft.allowOpening}
							isDisabled={!draft.enabled}
							onChange={(e) => patch({ allowOpening: e.target.checked })}
						/>
						<Text fontSize="sm">Chat can open them</Text>
					</HStack>
					<HStack spacing={2}>
						<Switch isChecked={draft.grantOnFiresale} onChange={(e) => patch({ grantOnFiresale: e.target.checked })} />
						<Text fontSize="sm">A firesale earns the gifter a box</Text>
					</HStack>
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">Command</Text>
						<Text fontSize="sm" color="gray.500">!</Text>
						<Input
							size="sm"
							maxW="110px"
							value={draft.command}
							onChange={(e) => patch({ command: e.target.value.replace(/^!/, "") }, "cmd")}
						/>
					</HStack>
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">Ray gun</Text>
						<Text fontSize="sm" color="gray.500">!</Text>
						<Input
							size="sm"
							maxW="110px"
							value={draft.raygunCommand}
							onChange={(e) => patch({ raygunCommand: e.target.value.replace(/^!/, "") }, "rcmd")}
						/>
					</HStack>
				</HStack>
				{draft.grantOnFiresale && (
					<Box borderWidth="1px" borderRadius="md" p={3}>
						<Text fontSize="sm" fontWeight="bold" mb={1}>Which giveaways earn one</Text>
						<Text fontSize="xs" color="gray.500" mb={2}>
							{draft.firesaleItems.length === 0
								? "Nothing ticked, so every Fourthwall giveaway earns the gifter a box. Tick some to narrow it down."
								: `Only giveaways of these earn a box — ${draft.firesaleItems.length} picked.`}
						</Text>
						{products === null && (
							<Text fontSize="xs" color="gray.500">Loading your Fourthwall products…</Text>
						)}
						{products !== null && products.length === 0 && (
							<Text fontSize="xs" color="gray.500">
								No products loaded — connect Fourthwall, or type an item name in the box below.
							</Text>
						)}
						<VStack align="stretch" spacing={0} maxH="200px" overflowY="auto" mb={2}>
							{(products || []).map((p: any) => (
								<Checkbox
									key={p.id}
									size="sm"
									isChecked={draft.firesaleItems.includes(p.name)}
									onChange={(e) => patch({
										firesaleItems: e.target.checked
											? [...draft.firesaleItems, p.name]
											: draft.firesaleItems.filter((n: string) => n !== p.name),
									})}
								>
									<Text fontSize="sm">{p.name}</Text>
								</Checkbox>
							))}
						</VStack>
						{/* anything ticked that ISN'T one of the loaded products — a name typed by hand, or a
						    product that has since been renamed or delisted. it would otherwise vanish from the
						    list while still silently deciding who gets a box. */}
						{draft.firesaleItems.filter((n: string) => !(products || []).some((p: any) => p.name === n)).map((n: string) => (
							<Flex key={n} align="center" gap={2} mb={1}>
								<Badge colorScheme="purple">match</Badge>
								<Text fontSize="sm" flex="1">{n}</Text>
								<Button size="xs" variant="ghost" onClick={() => patch({ firesaleItems: draft.firesaleItems.filter((x: string) => x !== n) })}>
									remove
								</Button>
							</Flex>
						))}
						<HStack spacing={2} mt={1}>
							<Input
								size="sm"
								maxW="280px"
								placeholder="…or part of an item name, e.g. box of 8"
								value={itemRule}
								onChange={(e) => setItemRule(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Enter") addItemRule(); }}
							/>
							<Button size="sm" isDisabled={!itemRule.trim()} onClick={addItemRule}>Add</Button>
						</HStack>
						<Text fontSize="xs" color="gray.500" mt={1}>
							Matched against what Fourthwall announces, ignoring case — a partial name is enough, so
							&quot;collector&quot; covers every collector&apos;s edition.
						</Text>
					</Box>
				)}

				<Text fontSize="xs" color="gray.500">
					Chat types <Code fontSize="xs">!{draft.command} open</Code> to open one and{" "}
					<Code fontSize="xs">!{draft.command} count</Code> to ask how many they have.
					{" "}Turning <b>Chat can open them</b> off holds the spins back without stopping anyone earning —
					boxes still bank up and you can still open and test them from here. Turning <b>Mystery boxes</b>{" "}
					off stops the earning too.
				</Text>

				<HStack spacing={3} wrap="wrap">
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">Spin for</Text>
						<NumberField width="90px" min={1} max={30} value={draft.spinSec} onCommit={(n) => patch({ spinSec: n }, "spin")} />
						<Text fontSize="sm" color="gray.500">sec</Text>
					</HStack>
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">flying past</Text>
						<NumberField
							width="100px"
							min={MIN_SPIN_TILES}
							max={MAX_SPIN_TILES}
							value={draft.spinTiles}
							onCommit={(n) => patch({ spinTiles: n }, "tiles")}
						/>
						<Text fontSize="sm" color="gray.500">prizes</Text>
					</HStack>
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">Hold the prize</Text>
						<NumberField width="90px" min={1} max={60} value={draft.revealHoldSec} onCommit={(n) => patch({ revealHoldSec: n }, "hold")} />
						<Text fontSize="sm" color="gray.500">sec</Text>
					</HStack>
				</HStack>

				<Text fontSize="xs" color="gray.500">
					That averages <b>{(draft.spinTiles / draft.spinSec).toFixed(1)} prizes a second</b> — nearer{" "}
					{((draft.spinTiles / draft.spinSec) * 3).toFixed(0)} off the line, easing down to a stop on the
					one that won. The spin always takes the seconds you set, so sending more past it makes the reel
					faster rather than the spin longer.
				</Text>

				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="gray.600">Spin music</Text>
					<Select size="sm" maxW="260px" value={draft.music} onChange={(e) => patch({ music: e.target.value })}>
						<option value="">(none)</option>
						{SOUNDS.map((f) => (
							<option key={f} value={f}>{f}</option>
						))}
					</Select>
					<Text fontSize="sm" color="gray.600">Vol</Text>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={draft.volume}
						onChange={(e) => patch({ volume: Number(e.target.value) }, "vol")}
					/>
				</HStack>

				<HStack spacing={4} wrap="wrap">
					<HStack spacing={2}>
						<Text fontSize="sm" color="gray.600">Fill</Text>
						<Select
							size="sm"
							maxW="150px"
							value={draft.bgColor === "transparent" ? "transparent" : "color"}
							onChange={(e) => patch({ bgColor: e.target.value === "transparent" ? "transparent" : "#000000" })}
						>
							<option value="transparent">Transparent</option>
							<option value="color">Solid colour</option>
						</Select>
						{draft.bgColor !== "transparent" && (
							<input type="color" value={draft.bgColor} onChange={(e) => patch({ bgColor: e.target.value }, "bg")} />
						)}
					</HStack>
					<HStack spacing={2}>
						<Text fontSize="sm" color="gray.600">Title</Text>
						<input type="color" value={draft.titleColor} onChange={(e) => patch({ titleColor: e.target.value }, "title")} />
					</HStack>
					<HStack spacing={2}>
						<Text fontSize="sm" color="gray.600">Names</Text>
						<input type="color" value={draft.nameColor} onChange={(e) => patch({ nameColor: e.target.value }, "name")} />
					</HStack>
				</HStack>
			</VStack>

			<Text fontSize="xs" color="gray.500">
				Prize art lives in <Code fontSize="xs">front/public/prizes</Code> and sounds in{" "}
				<Code fontSize="xs">front/public/media</Code>. Both lists are read when the site starts, so a file
				dropped in while it's running needs a restart before it shows up here.
			</Text>
		</Box>
	);
};

export default MysteryBox;
