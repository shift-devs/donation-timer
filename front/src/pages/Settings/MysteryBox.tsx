import React, { useCallback, useEffect, useState } from "react";
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
	useToast,
} from "@chakra-ui/react";
import {
	setMysteryBoxSettings,
	giveMysteryBox,
	giveRaygun,
	giveDoubleTime,
	giveShield,
	renameMysteryBoxOwner,
	clearGiftSubProgress,
	testMysteryBox,
	stopMysteryBox,
	stopJukebox,
	stopSchizo,
	startQuickRevive,
	stopQuickRevive,
	resumeTimer,
	endTimeBoost,
} from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import NumberField from "../../NumberField";
import { BASE_URL } from "../../Consts";
import { canonMysteryBox, countdown, MIN_SPIN_TILES, MAX_SPIN_TILES } from "../../mysterybox";
import { SOUNDS } from "./EffectFields";
import PrizeList from "./PrizeList";
import { useSyncedDraft } from "./useSyncedDraft";

// The mystery box is earned from bingo, gifted subs, channel points and raffles (firesales earn the wonder box
// now — see WonderBox.tsx). The holder spends it with "!mb open" in chat, which takes over the /mysterybox
// browser source and lands on a prize whose effect then fires for real. Everything here applies immediately —
// no Save.
const MysteryBox: React.FC<{ ws: any; token: string | null; settings: any; run: any; revive: any }> = ({ ws, token, settings, run, revive }) => {
	const toast = useToast();

	const send = useCallback((next: any) => setMysteryBoxSettings(ws, next), [ws]);
	const { draft, patch } = useSyncedDraft(settings.mysteryBoxSettings, canonMysteryBox, send);
	const onTest = useCallback((id: string) => testMysteryBox(ws, id, "mystery"), [ws]);
	const [giveName, setGiveName] = useState("");
	const [giveCount, setGiveCount] = useState(1);
	const [mergeFrom, setMergeFrom] = useState("");
	const [mergeTo, setMergeTo] = useState("");
	const [openPrize, setOpenPrize] = useState<string>("");
	// the live open and the pause both carry deadlines, so the countdowns here tick on their own
	const [, setTick] = useState(0);

	const phase: string = (run && run.phase) || "idle";
	const pause = settings.timerPause || null;
	const boost = settings.timeBoost || null;
	// the quick revive challenge: running, decided (won/lost, result still up), or idle
	const revivePhase: string = (revive && revive.phase) || "idle";
	// the jukebox prize's background track, while the source is playing one
	const juke = (run && run.jukebox) || null;
	// the schizo prize, while the source is reading chat aloud
	const schizo = (run && run.schizo) || null;
	const ticking = phase !== "idle" || !!pause || !!boost || revivePhase !== "idle" || !!juke || !!schizo;

	useEffect(() => {
		if (!ticking)
			return;
		const id = setInterval(() => setTick((n) => n + 1), 500);
		return () => clearInterval(id);
	}, [ticking]);

	// the quick revive's settings ride inside the same blob, so they go up the same way
	const patchRevive = (p: any, key?: string) => patch((d: any) => ({ quickRevive: { ...d.quickRevive, ...p } }), key);

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
	// banked double time prizes, waiting on the holder's next contribution
	const dbl: { [key: string]: any } = settings.doubleTime || {};
	const doublers = Object.keys(dbl)
		.map((k) => ({ key: k, name: dbl[k].name || k, count: dbl[k].count || 0 }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	// banked timeout shields, spent on the holder's next timeout from the bot
	const shieldRows: { [key: string]: any } = settings.shields || {};
	const shielded = Object.keys(shieldRows)
		.map((k) => ({ key: k, name: shieldRows[k].name || k, count: shieldRows[k].count || 0 }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	const shPrize = draft.prizes.find((p: any) => p.effect.kind === "shield" && p.name);
	const shName = shPrize ? shPrize.name : "Timeout shields";
	// cumulative gift sub tallies, closest to their next box first
	const tallies: { [key: string]: any } = settings.giftSubProgress || {};
	const gifters = Object.keys(tallies)
		.map((k) => ({ key: k, name: tallies[k].name || k, count: tallies[k].count || 0 }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

	// what the /events and /text effects can point at
	const events: any[] = Array.isArray(settings.timerEvents) ? settings.timerEvents : [];
	// the broadcaster authorization the channel points listener rides on
	const pts: any = (settings.connections && settings.connections.twitchSubs) || {};
	// what chat calls the double time prize ("Pack-a-Punch"), for the reminder's label
	const dtPrize = draft.prizes.find((p: any) => p.effect.kind === "doubleTime" && p.name);
	const dtName = dtPrize ? dtPrize.name : "double time";
	const textBoxes: any[] = Array.isArray(settings.textBoxes) ? settings.textBoxes : [];

	// both kinds of box spin on the one source; say which one this is
	const runKind = run && run.kind === "wonder" ? "wonder box" : "mystery box";
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

	return (
		<Box maxW="960px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={2}>
				One OBS <b>Browser</b> source for mystery boxes (and wonder boxes — see the Wonder Box tab). Boxes are
				earned from bingo, gifted subs, channel points and raffles; firesales earn wonder boxes instead. A
				holder spends one by typing <Code fontSize="xs">!{draft.command} open</Code> in chat, and the source
				spins through the prize art and stops on what they won. The prize's effect then fires for real —
				time, a pause, a clip, whatever it's set to.
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
							<b>{run.opener}</b> ({runKind})
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

				{juke && (
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Badge colorScheme="blue">JUKEBOX</Badge>
						<Text fontSize="sm" color="gray.600">
							{juke.track} — {countdown(Date.now() - juke.startedAt)} in ({juke.name}); boxes still open over it
						</Text>
						<Button size="xs" onClick={() => stopJukebox(ws)}>Stop</Button>
					</Flex>
				)}

				{schizo && (
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Badge colorScheme="pink">SCHIZO</Badge>
						<Text fontSize="sm" color="gray.600">
							{countdown(schizo.until - Date.now())} left — the source is reading chat aloud ({schizo.name}); boxes still open over it
						</Text>
						<Button size="xs" onClick={() => stopSchizo(ws)}>Stop</Button>
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
							{revive.kind !== "subpoints" ? <><b>{revive.title}</b> — </> : null}
							{revive.kind === "weenie" ? <>nobody may say <b>&ldquo;{revive.phrase}&rdquo;</b></> : <><b>{revive.points}{["infection", "rollcall", "potato", "cup", "vote"].includes(revive.kind) ? "" : ` / ${revive.goal}`}</b> {String(revive.unit || "sub points").toLowerCase()}</>}{revive.kind === "rollcall" && revive.called ? <> — calling <b>@{revive.called}</b></> : null}{(revive.kind === "potato" || revive.kind === "cup") && revive.holder ? <> — <b>@{revive.holder}</b> {revive.kind === "potato" ? "has it" : "is it"}</> : null}{revive.kind === "vote" && Array.isArray(revive.board) && revive.board.length ? <> — leading: <b>{revive.board.slice(0, revive.topCount || 1).map((v: any) => `@${v.name} (${v.votes})`).join(", ")}</b></> : null} — {countdown(revive.endsAt - Date.now())} left
						</Text>
					)}
					{(revivePhase === "won" || revivePhase === "lost") && (
						<Text fontSize="sm" color="gray.600">
							{revivePhase === "won" ? revive.winText : revive.failText} — {revive.kind === "infection" ? <><b>{revive.points}</b> infected</> : revive.kind === "rollcall" ? <><b>{revive.points}</b> answered</>
								: revive.kind === "potato" ? <><b>@{revive.holder}</b> was holding it after <b>{revive.points}</b> passes</>
								: revive.kind === "cup" ? <><b>@{revive.holder}</b> wins</>
								: revive.kind === "vote" ? <>voted out: <b>{(revive.board || []).slice(0, revive.topCount || 1).map((v: any) => `@${v.name}`).join(", ") || "nobody"}</b></>
								: revive.kind === "weenie" ? (revive.saidBy ? <><b>@{revive.saidBy}</b> said it</> : <>nobody said it</>) : <>chat got <b>{revive.points} / {revive.goal}</b> {String(revive.unit || "sub points").toLowerCase()}</>}
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
						Nobody is holding a box yet. They come from bingo, gifted subs, channel points and raffles —
						or hand one out below.
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
					A box can be credited to a display name (a bingo winner, a gifter) that isn't the Twitch login
					that types <Code fontSize="xs">!{draft.command} open</Code>. When they differ, move the boxes
					across — mystery boxes, wonder boxes and everything else they hold go together:
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

			{doublers.length > 0 && (
				<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Text fontWeight="bold">Double time</Text>
						<Text fontSize="sm" color="gray.600">
							banked — each one doubles that person's next contribution
						</Text>
					</Flex>
					<VStack align="stretch" spacing={1} maxH="160px" overflowY="auto">
						{doublers.map((g) => (
							<Flex key={g.key} align="center" gap={2} fontSize="sm">
								<Text flex="1" minW="140px">{g.name}</Text>
								<Badge colorScheme="green">{g.count}</Badge>
								<Button size="xs" variant="ghost" onClick={() => giveDoubleTime(ws, g.key, 1)}>+1</Button>
								<Button size="xs" variant="ghost" onClick={() => giveDoubleTime(ws, g.key, -1)}>−1</Button>
							</Flex>
						))}
					</VStack>
				</Box>
			)}

			{shielded.length > 0 && (
				<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Text fontWeight="bold">{shName}</Text>
						<Text fontSize="sm" color="gray.600">
							banked — each one blocks that person's next timeout from the bot
						</Text>
					</Flex>
					<VStack align="stretch" spacing={1} maxH="160px" overflowY="auto">
						{shielded.map((g) => (
							<Flex key={g.key} align="center" gap={2} fontSize="sm">
								<Text flex="1" minW="140px">{g.name}</Text>
								<Badge colorScheme="blue">{g.count}</Badge>
								<Button size="xs" variant="ghost" onClick={() => giveShield(ws, g.key, 1)}>+1</Button>
								<Button size="xs" variant="ghost" onClick={() => giveShield(ws, g.key, -1)}>−1</Button>
							</Flex>
						))}
					</VStack>
				</Box>
			)}

			{/* ---- the prizes ---- */}
			<PrizeList
				prizes={draft.prizes}
				activeProfile={draft.activeProfile}
				patch={patch}
				onTest={onTest}
				events={events}
				textBoxes={textBoxes}
				listId="mb-profiles"
				what="box"
			/>

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
				<Text fontSize="xs" color="gray.500">
					Chat types <Code fontSize="xs">!{draft.command} open</Code> to open one and{" "}
					<Code fontSize="xs">!{draft.command} count</Code> to ask how many they have.
					{" "}Turning <b>Chat can open them</b> off holds the spins back without stopping anyone earning —
					boxes still bank up and you can still open and test them from here. Turning <b>Mystery boxes</b>{" "}
					off stops the earning too.
				</Text>
				<HStack spacing={3} wrap="wrap">
					<HStack spacing={2}>
						<Switch
							isChecked={draft.remindUnopened}
							isDisabled={!draft.enabled}
							onChange={(e) => patch({ remindUnopened: e.target.checked })}
						/>
						<Text fontSize="sm">Remind people with unopened boxes or an unspent {dtName} when they chat</Text>
					</HStack>
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">at most once every</Text>
						<NumberField width="80px" min={5} max={1440} value={draft.remindEveryMin} onCommit={(n) => patch({ remindEveryMin: n }, "remind")} />
						<Text fontSize="sm" color="gray.600">min per person</Text>
					</HStack>
				</HStack>

				{/* channel points: a redemption banks boxes, it never opens one — only one box runs at a time */}
				<HStack spacing={3} wrap="wrap">
					<HStack spacing={2}>
						<Switch
							isChecked={draft.pointsEnabled}
							isDisabled={!draft.enabled}
							onChange={(e) => patch({ pointsEnabled: e.target.checked })}
						/>
						<Text fontSize="sm">Channel points reward</Text>
					</HStack>
					<Input
						size="sm"
						maxW="240px"
						placeholder="Reward title, exactly as on Twitch"
						value={draft.pointsReward}
						onChange={(e) => patch({ pointsReward: e.target.value }, "ptsr")}
					/>
					<HStack spacing={1}>
						<Text fontSize="sm" color="gray.600">gives</Text>
						<NumberField width="70px" min={1} max={99} value={draft.pointsBoxes} onCommit={(n) => patch({ pointsBoxes: n }, "ptsb")} />
						<Text fontSize="sm" color="gray.600">box{draft.pointsBoxes === 1 ? "" : "es"}</Text>
					</HStack>
					{draft.pointsEnabled && (
						!pts.authorized
							? <Badge colorScheme="red">authorize Twitch active subs first</Badge>
							: pts.pointsOk
								? <Badge colorScheme="green">listening</Badge>
								: <Badge colorScheme="red">not listening</Badge>
					)}
				</HStack>
				{draft.pointsEnabled && pts.authorized && !pts.pointsOk && pts.pointsError && (
					<Text fontSize="xs" color="red.300">{pts.pointsError}</Text>
				)}
				<Text fontSize="xs" color="gray.500">
					Make the reward on Twitch (Creator Dashboard → Viewer Rewards → Channel Points) and type its title here.
					Redeeming it puts boxes in the viewer&apos;s wallet. It doesn&apos;t open one, so it never clashes with a box
					that&apos;s already running; they open it with <Code fontSize="xs">!{draft.command} open</Code> when they like.
					This uses the broadcaster authorization from <b>Twitch active subs</b> on the Connections tab. If you
					authorized that before channel points were added, authorize it again.
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

			{/* ---- what earns a box ---- */}
			<Text fontWeight="bold" mb={2}>What earns a box</Text>
			<VStack align="stretch" spacing={3} mb={5} opacity={draft.enabled ? 1 : 0.6}>
				<Text fontSize="xs" color="gray.500">
					Firesales earn <b>wonder boxes</b> now — their settings are on the Wonder Box tab. Bingo winners
					earn mystery boxes (3 / 2 / 1 for the first three), and so do raffles and the channel points
					reward above.
				</Text>
				<Box borderWidth="1px" borderRadius="md" p={3}>
					<HStack spacing={2} mb={draft.giftSubsEnabled ? 2 : 0}>
						<Switch isChecked={draft.giftSubsEnabled} onChange={(e) => patch({ giftSubsEnabled: e.target.checked })} />
						<Text fontSize="sm" fontWeight="bold">Gifted subs</Text>
						{!draft.giftSubsEnabled && <Badge>OFF</Badge>}
					</HStack>
					{draft.giftSubsEnabled && (<>
						<HStack spacing={2} wrap="wrap" mb={2}>
							<Text fontSize="sm" color="gray.600">One box per</Text>
							<NumberField width="80px" min={1} max={1000} value={draft.giftSubsPerBox} onCommit={(n) => patch({ giftSubsPerBox: n }, "gift")} />
							<Text fontSize="sm" color="gray.600">gifted subs,</Text>
							<Select size="sm" maxW="160px" value={draft.giftSubsMode} onChange={(e) => patch({ giftSubsMode: e.target.value })}>
								<option value="batch">All at once</option>
								<option value="cumulative">Cumulative</option>
							</Select>
						</HStack>
						<Text fontSize="xs" color="gray.500">
							{draft.giftSubsMode === "cumulative"
								? <>Every <b>{draft.giftSubsPerBox}</b> subs someone gifts earns them a box, however many gifts it takes — the leftover carries over to their next gift.</>
								: <>Someone has to gift <b>{draft.giftSubsPerBox}</b> subs in one go to earn a box (twice that in one go earns two). Smaller gifts don&apos;t add up.</>}
							{" "}Counts subs on Twitch, YouTube and Kick, whatever the tier. Anonymous gifts earn nothing.
						</Text>
						{draft.giftSubsMode === "cumulative" && (
							<Box mt={2}>
								<Flex align="center" gap={2} mb={1}>
									<Text fontSize="sm" fontWeight="bold" flex="1">Toward their next box</Text>
									<Button size="xs" variant="ghost" isDisabled={gifters.length === 0} onClick={() => clearGiftSubProgress(ws)}>
										reset all
									</Button>
								</Flex>
								{gifters.length === 0 && (
									<Text fontSize="xs" color="gray.500">Nobody is part of the way there yet.</Text>
								)}
								<VStack align="stretch" spacing={0} maxH="160px" overflowY="auto">
									{gifters.map((g) => (
										<Flex key={g.key} align="center" gap={2}>
											<Text fontSize="sm" flex="1">{g.name}</Text>
											<Text fontSize="sm" color="gray.600">{g.count} / {draft.giftSubsPerBox}</Text>
										</Flex>
									))}
								</VStack>
							</Box>
						)}
					</>)}
				</Box>
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
