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
	Textarea,
	VStack,
	useToast,
} from "@chakra-ui/react";
import { setDropSettings, testDrop, forceDrop, stopDrop, clearDropQueue } from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import NumberField from "../../NumberField";
import { BASE_URL } from "../../Consts";
import { prizeImageSrc, countdown } from "../../mysterybox";
import { canonDrops, rewardOdds, rewardLive, gamePlayable, gameArmed, secretReady, chanceOfAny, GAME_KINDS, REWARD_KINDS, DEFAULT_GAME, DEFAULT_PRIZE, DEFAULT_POOL, MAX_REWARDS, MAX_GAMES, MAX_POOLS, MAX_SECRETS } from "../../drops";
import EffectFields, { PRIZE_IMAGES, SOUNDS } from "./EffectFields";

const SEND_DEBOUNCE = 300;

// a sound picker with its volume, the shape every one-shot on this tab takes
const SoundPick: React.FC<{ value: string; volume: number; onPick: (v: string) => void; onVolume: (v: number) => void; none?: string }> = ({ value, volume, onPick, onVolume, none }) => (
	<>
		<Select size="sm" maxW="240px" value={value} onChange={(e) => onPick(e.target.value)}>
			<option value="">{none || "(sound: none)"}</option>
			{SOUNDS.map((f) => (
				<option key={f} value={f}>{f}</option>
			))}
		</Select>
		<Text fontSize="sm" color="gray.600">Vol</Text>
		<input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => onVolume(Number(e.target.value))} />
	</>
);

// the chance box. NumberField's rules — text is local while typing, the value only moves once what's typed is
// legal, the clamp waits for blur — but for a percentage that wants decimals ("0.5"), which NumberField drops.
const ChanceField: React.FC<{ value: number; onCommit: (n: number) => void }> = ({ value, onCommit }) => {
	const [text, setText] = useState(String(value));
	const [editing, setEditing] = useState(false);
	useEffect(() => {
		if (!editing)
			setText(String(value));
	}, [value, editing]);
	const legal = (raw: string) => {
		const n = Number(raw);
		return raw.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
	};
	return (
		<Input
			size="sm"
			maxW="90px"
			inputMode="decimal"
			value={text}
			onFocus={() => setEditing(true)}
			onChange={(e) => {
				setText(e.target.value);
				const n = legal(e.target.value);
				if (n !== null)
					onCommit(n);
			}}
			onBlur={() => {
				setEditing(false);
				const n = legal(text);
				setText(String(n === null ? value : n));
			}}
		/>
	);
};

// Drops: power-ups that fall out of the timer. Every contribution has a small chance of dropping one, chat
// plays a minigame for it on the Mystery Box source, and if they make it the reward fires. Everything here
// applies immediately — no Save.
const Drops: React.FC<{ ws: any; token: string | null; settings: any; revive: any }> = ({ ws, token, settings, revive }) => {
	const toast = useToast();

	const server = canonDrops(settings.dropSettings || {});
	const serverStr = JSON.stringify(server);
	const [draft, setDraft] = useState<any>(server);
	// between an edit and its sync the server's copy is OLDER than the screen, so following it would undo
	// keystrokes; once it agrees again we go back to following it. mirrors the Mystery Box tab.
	const sentRef = useRef(serverStr);
	const pendingRef = useRef(0);
	const timers = useRef<{ [key: string]: any }>({});
	const [testReward, setTestReward] = useState("");
	const [testGame, setTestGame] = useState("");
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

	const later = (key: string, fn: () => void, delay: number) => {
		clearTimeout(timers.current[key]);
		timers.current[key] = setTimeout(fn, delay);
	};

	const patch = (p: any, key?: string) => {
		const next = { ...draft, ...p };
		setDraft(next);
		sentRef.current = JSON.stringify(canonDrops(next));
		pendingRef.current = Date.now();
		if (key)
			later(key, () => setDropSettings(ws, next), SEND_DEBOUNCE);
		else
			setDropSettings(ws, next);
	};

	const patchReward = (id: string, p: any, key?: string) =>
		patch({ rewards: draft.rewards.map((z: any) => (z.id === id ? { ...z, ...p } : z)) }, key);
	const patchEffect = (id: string, p: any, key?: string) =>
		patch({ rewards: draft.rewards.map((z: any) => (z.id === id ? { ...z, effect: { ...z.effect, ...p } } : z)) }, key);
	const patchGame = (id: string, p: any, key?: string) =>
		patch({ games: draft.games.map((g: any) => (g.id === id ? { ...g, ...p } : g)) }, key);
	const patchPool = (id: string, p: any, key?: string) =>
		patch({ pools: draft.pools.map((z: any) => (z.id === id ? { ...z, ...p } : z)) }, key);

	const addReward = (pool: string) => {
		if (draft.rewards.length >= MAX_REWARDS)
			return;
		const id = `r${Date.now().toString(36)}`;
		patch({ rewards: [...draft.rewards, { ...DEFAULT_PRIZE, id, pool, name: `Reward ${draft.rewards.length + 1}`, effect: { ...DEFAULT_PRIZE.effect } }] });
	};

	// a copy right under the original, so one reward can sit in two pools at different rarities
	const duplicateReward = (id: string) => {
		if (draft.rewards.length >= MAX_REWARDS)
			return;
		const at = draft.rewards.findIndex((p: any) => p.id === id);
		if (at < 0)
			return;
		const src = draft.rewards[at];
		const copy = { ...src, id: `r${Date.now().toString(36)}`, effect: { ...src.effect } };
		patch({ rewards: [...draft.rewards.slice(0, at + 1), copy, ...draft.rewards.slice(at + 1)] });
	};

	const addGame = () => {
		if (draft.games.length >= MAX_GAMES)
			return;
		const id = `g${Date.now().toString(36)}`;
		patch({ games: [...draft.games, { ...DEFAULT_GAME, id, pool: draft.pools[0].id, words: [], secrets: [] }] });
	};

	// the secret phrase game's list: one phrase, its hints
	const patchSecret = (gameId: string, at: number, p: any, key?: string) => {
		const g = draft.games.find((z: any) => z.id === gameId);
		if (!g)
			return;
		patchGame(gameId, { secrets: g.secrets.map((s: any, i: number) => (i === at ? { ...s, ...p } : s)) }, key);
	};
	const addSecret = (gameId: string) => {
		const g = draft.games.find((z: any) => z.id === gameId);
		if (!g || g.secrets.length >= MAX_SECRETS)
			return;
		patchGame(gameId, { secrets: [...g.secrets, { phrase: "", hints: [] }] });
	};
	const deleteSecret = (gameId: string, at: number) => {
		const g = draft.games.find((z: any) => z.id === gameId);
		if (!g)
			return;
		patchGame(gameId, { secrets: g.secrets.filter((_: any, i: number) => i !== at) });
	};

	const addPool = () => {
		if (draft.pools.length >= MAX_POOLS)
			return;
		const id = `pool${Date.now().toString(36)}`;
		patch({ pools: [...draft.pools, { id, name: draft.pools.length ? `Pool ${draft.pools.length + 1}` : DEFAULT_POOL.name }] });
	};

	// the last pool can't go. what was in a deleted pool moves to the first one left, so nothing is lost.
	const deletePool = (id: string) => {
		const pools = draft.pools.filter((z: any) => z.id !== id);
		if (!pools.length)
			return;
		const to = pools[0].id;
		patch({
			pools,
			rewards: draft.rewards.map((p: any) => (p.pool === id ? { ...p, pool: to } : p)),
			games: draft.games.map((g: any) => (g.pool === id ? { ...g, pool: to } : g)),
		});
	};

	const poolName = (id: string) => (draft.pools.find((z: any) => z.id === id) || {}).name || id;

	const url = `${BASE_URL}/mysterybox?token=${encodeURIComponent(token || "")}`;
	const copyUrl = () => {
		copyText(url).then((ok) =>
			toast(ok
				? { title: "Source URL copied", status: "success", duration: 1500 }
				: { title: "Couldn't copy — reveal the URL and copy it manually", status: "error", duration: 3000 }));
	};

	const hour = settings.drops || null;
	const events: any[] = Array.isArray(settings.timerEvents) ? settings.timerEvents : [];
	const textBoxes: any[] = Array.isArray(settings.textBoxes) ? settings.textBoxes : [];
	const liveRewards = draft.rewards.filter(rewardLive);
	// the games that can actually go up: ready, and paying from a pool with a live reward in it
	const liveGames = draft.games.filter((g: any) => gameArmed(g, draft.rewards));

	// the drop on screen, if the challenge on the source is one
	const phase: string = (revive && revive.phase) || "idle";
	const dropUp = !!(hour && hour.up) && phase !== "idle";

	useEffect(() => {
		if (!dropUp)
			return;
		const id = setInterval(() => setTick((n) => n + 1), 500);
		return () => clearInterval(id);
	}, [dropUp]);

	const badge = !draft.enabled
		? <Badge>OFF</Badge>
		: !liveGames.length
			? <Badge colorScheme="red">NOTHING TO DROP</Badge>
			: <Badge colorScheme="green">ON</Badge>;

	return (
		<Box maxW="960px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={2}>
				Power-ups that fall out of the timer. Every sub, cheer, donation and order that puts time on the clock
				has a small chance of <b>dropping</b> one. The drop goes up on the <b>Mystery Box</b> source with its
				reward named, and chat has to clear a minigame in time to grab it — say a word so many times, count
				from one number to another, put up sub points, unscramble a word, or guess a secret phrase from a
				hint. Make it and the reward fires,
				exactly like a mystery box prize. Miss it and it&apos;s gone.
			</Text>
			<Text fontSize="sm" color="gray.600" mb={2}>
				Rewards are sorted into <b>pools</b>, and each minigame pays from one pool. A drop picks a minigame
				first, then draws its reward from that minigame&apos;s pool — so a harder game can be the only way at
				the better rewards.
			</Text>
			<Text fontSize="sm" color="gray.600" mb={3}>
				Drops use the same browser source as mystery boxes, so there&apos;s nothing new to add to OBS. One thing
				happens on that source at a time: a drop that lands while a box is opening (or a firesale or raffle is
				up) waits and goes up as soon as it&apos;s free, and new boxes wait for it. Everything here applies
				immediately — no Save.
			</Text>

			<Flex align="center" gap={2} mb={4} wrap="wrap">
				<MaskedUrl url={url} p={2} fontSize="xs" flex="1" minW="140px" overflowX="auto" whiteSpace="nowrap" />
				<Button size="sm" onClick={copyUrl}>Copy</Button>
			</Flex>

			{/* ---- right now ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Live</Text>
					{badge}
					{hour && (
						<Text fontSize="sm" color="gray.600">
							{hour.hourLabel}: <b>{hour.drops} of {hour.maxPerHour}</b> dropped, <b>{hour.minutes}</b> minute{hour.minutes === 1 ? "" : "s"} added
						</Text>
					)}
				</Flex>

				{hour && draft.guaranteeEnabled && (
					<Text fontSize="sm" color="gray.600" mb={2}>
						This hour&apos;s floor is <b>{hour.threshold} minutes</b> —{" "}
						{hour.guaranteed ? "passed, and its drop has been had." : `${Math.max(0, hour.threshold - hour.minutes)} more to go before one is guaranteed.`}
						<Text as="span" fontSize="xs" color="gray.500"> (Only shown here — chat never sees it.)</Text>
					</Text>
				)}

				{dropUp && (
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Badge colorScheme={phase === "running" ? "purple" : phase === "won" ? "green" : "red"}>
							{phase === "running" ? "DROP UP" : phase === "won" ? "GRABBED" : "MISSED"}
						</Badge>
						<Text fontSize="sm" color="gray.600">
							<b>{revive.title}</b>
							{phase === "running" ? ` — ${revive.points}${revive.kind === "scramble" || revive.kind === "secret" ? "" : ` / ${revive.goal}`} — ${countdown(revive.endsAt - Date.now())} left` : ""}
						</Text>
						<Button size="xs" variant="ghost" onClick={() => stopDrop(ws)}>{phase === "running" ? "Call off" : "Clear"}</Button>
					</Flex>
				)}

				{hour && hour.queued > 0 && (
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Badge colorScheme="orange">{hour.queued} WAITING</Badge>
						<Text fontSize="sm" color="gray.600">for the Mystery Box source to come free</Text>
						<Button size="xs" variant="ghost" onClick={() => clearDropQueue(ws)}>Throw away</Button>
					</Flex>
				)}

				<HStack spacing={2} wrap="wrap" mb={2}>
					<Button size="sm" colorScheme="purple" isDisabled={!liveGames.length} onClick={() => forceDrop(ws, "")}>
						Drop one now
					</Button>
					<Text fontSize="xs" color="gray.500">
						For real: announced in chat and the reward pays out. Doesn&apos;t count toward the hour&apos;s {draft.maxPerHour}.
					</Text>
				</HStack>
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="gray.500">Test</Text>
					<Select size="sm" maxW="200px" value={testReward} onChange={(e) => setTestReward(e.target.value)}>
						<option value="">(a fair draw)</option>
						{draft.pools.map((pool: any) => (
							<optgroup key={pool.id} label={pool.name}>
								{draft.rewards.filter((p: any) => p.pool === pool.id).map((p: any) => (
									<option key={p.id} value={p.id}>{p.name || p.id}</option>
								))}
							</optgroup>
						))}
					</Select>
					<Select size="sm" maxW="200px" value={testGame} onChange={(e) => setTestGame(e.target.value)}>
						<option value="">(any minigame)</option>
						{draft.games.map((g: any) => (
							<option key={g.id} value={g.id}>{g.name || (GAME_KINDS.find((k) => k.key === g.kind) || GAME_KINDS[0]).label}{draft.pools.length > 1 ? ` — ${poolName(g.pool)}` : ""}</option>
						))}
					</Select>
					<Button size="sm" isDisabled={!draft.rewards.length || !draft.games.length} onClick={() => testDrop(ws, testReward, testGame)}>
						Test
					</Button>
					<Text fontSize="xs" color="gray.500">
						Plays on the source for real — say nothing in chat, and win it to see the reward fire — but credits nobody with shots or boxes.
						A reward on its own plays one of its pool&apos;s minigames; a minigame on its own draws from its pool.
					</Text>
				</HStack>
				<Text fontSize="xs" color="gray.500" mt={2}>
					From the Terminal: <Code fontSize="xs">drop</Code>, <Code fontSize="xs">drop test</Code>,{" "}
					<Code fontSize="xs">drop stop</Code>, <Code fontSize="xs">drop clear</Code>, <Code fontSize="xs">drop status</Code> —
					and mods can type the same in chat with a <Code fontSize="xs">!</Code>. <Code fontSize="xs">drop</Code> and{" "}
					<Code fontSize="xs">drop test</Code> take a reward&apos;s name, or a pool&apos;s to draw from that pool.
				</Text>
			</Box>

			{/* ---- how often ---- */}
			<Text fontWeight="bold" mb={2}>How often</Text>
			<VStack align="stretch" spacing={3} mb={5}>
				<HStack spacing={3} wrap="wrap">
					<HStack spacing={2}>
						<Switch isChecked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
						<Text fontSize="sm">Drops on</Text>
					</HStack>
					<HStack spacing={1}>
						<ChanceField value={draft.chance} onCommit={(n) => patch({ chance: n }, "chance")} />
						<Text fontSize="sm" color="gray.600">% chance on every contribution, at most</Text>
						<NumberField width="80px" min={1} max={60} value={draft.maxPerHour} onCommit={(n) => patch({ maxPerHour: n }, "max")} />
						<Text fontSize="sm" color="gray.600">an hour</Text>
					</HStack>
				</HStack>
				<Text fontSize="xs" color="gray.500">
					At {draft.chance}%, an hour with 50 contributions has about a{" "}
					<b>{chanceOfAny(draft.chance, 50).toFixed(0)}%</b> chance of rolling at least one drop, and an hour with
					200 about <b>{chanceOfAny(draft.chance, 200).toFixed(0)}%</b>. Hours run on the <b>Eastern</b> clock
					(2:00–3:00 ET, and so on), and no hour ever gets more than {draft.maxPerHour}, however they come.
					A gift bomb is one contribution. Typed <Code fontSize="xs">time</Code> commands don&apos;t roll.
				</Text>

				<Box borderWidth="1px" borderRadius="md" p={3}>
					<HStack spacing={2} mb={2} wrap="wrap">
						<Switch isChecked={draft.guaranteeEnabled} onChange={(e) => patch({ guaranteeEnabled: e.target.checked })} />
						<Text fontSize="sm" fontWeight="bold">Guaranteed drop</Text>
						{draft.guaranteeEnabled ? (<>
							<Text fontSize="sm" color="gray.600">once</Text>
							<NumberField width="80px" min={1} max={600} value={draft.guaranteeMin} onCommit={(n) => patch({ guaranteeMin: n, guaranteeMax: Math.max(n, draft.guaranteeMax) }, "gmin")} />
							<Text fontSize="sm" color="gray.600">to</Text>
							<NumberField width="80px" min={1} max={600} value={draft.guaranteeMax} onCommit={(n) => patch({ guaranteeMax: n, guaranteeMin: Math.min(n, draft.guaranteeMin) }, "gmax")} />
							<Text fontSize="sm" color="gray.600">minutes are added in an hour</Text>
						</>) : <Badge>OFF</Badge>}
					</HStack>
					<Text fontSize="xs" color="gray.500">
						At the top of each hour a secret number of minutes is picked somewhere in that range. The
						contribution that takes the hour&apos;s added time past it drops one, no roll needed — even if the hour
						has already had rolled drops (the hourly limit still applies). It looks exactly like any other drop,
						so chat never knows it&apos;s there.
					</Text>
				</Box>
			</VStack>

			{/* ---- look and sound ---- */}
			<Text fontWeight="bold" mb={2}>On stream</Text>
			<VStack align="stretch" spacing={2} mb={5}>
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="gray.600">Heading</Text>
					<Input size="sm" maxW="200px" value={draft.title} onChange={(e) => patch({ title: e.target.value }, "title")} />
					<Text fontSize="xs" color="gray.500">goes over the reward&apos;s art and name</Text>
					<Text fontSize="sm" color="gray.600" ml={2}>Result stays up</Text>
					<NumberField width="80px" min={1} max={60} value={draft.holdSec} onCommit={(n) => patch({ holdSec: n }, "hold")} />
					<Text fontSize="sm" color="gray.600">s</Text>
					<HStack spacing={1} ml={2}>
						<Switch size="sm" isChecked={draft.announce} onChange={(e) => patch({ announce: e.target.checked })} />
						<Text fontSize="sm" color="gray.600">Announce in chat</Text>
					</HStack>
				</HStack>
				<HStack spacing={2} wrap="wrap">
					<Badge colorScheme="purple">DROPS</Badge>
					<SoundPick value={draft.dropSound} volume={draft.dropVolume}
						onPick={(v) => patch({ dropSound: v })} onVolume={(v) => patch({ dropVolume: v }, "dv")} />
					<Text fontSize="xs" color="gray.500">plays once as it appears</Text>
				</HStack>
				<HStack spacing={2} wrap="wrap">
					<Badge colorScheme="blue">WHILE PLAYING</Badge>
					<SoundPick value={draft.music} volume={draft.musicVolume} none="(no music)"
						onPick={(v) => patch({ music: v })} onVolume={(v) => patch({ musicVolume: v }, "mv")} />
					<Text fontSize="xs" color="gray.500">loops until it&apos;s decided</Text>
				</HStack>
				<HStack spacing={2} wrap="wrap">
					<Badge colorScheme="green">GRABBED</Badge>
					<SoundPick value={draft.winSound} volume={draft.winVolume}
						onPick={(v) => patch({ winSound: v })} onVolume={(v) => patch({ winVolume: v }, "wv")} />
					<Input size="sm" maxW="220px" placeholder="What goes up on stream" value={draft.winText} onChange={(e) => patch({ winText: e.target.value }, "wt")} />
					<Text fontSize="xs" color="gray.500">a reward with its own sound plays that instead</Text>
				</HStack>
				<HStack spacing={2} wrap="wrap">
					<Badge colorScheme="red">MISSED</Badge>
					<SoundPick value={draft.failSound} volume={draft.failVolume}
						onPick={(v) => patch({ failSound: v })} onVolume={(v) => patch({ failVolume: v }, "fv")} />
					<Input size="sm" maxW="220px" placeholder="What goes up on stream" value={draft.failText} onChange={(e) => patch({ failText: e.target.value }, "ft")} />
				</HStack>
				<Text fontSize="xs" color="gray.500">
					Colours and the fill come from the Mystery Box tab, since it&apos;s the same source.
				</Text>
			</VStack>

			{/* ---- the pools ---- */}
			<Flex align="center" gap={3} mb={2} wrap="wrap">
				<Text fontWeight="bold">Drop pools</Text>
				<Text fontSize="sm" color="gray.600">Groups of rewards. A minigame pays from one of them.</Text>
				<Box flex="1" />
				<Button size="sm" onClick={addPool} isDisabled={draft.pools.length >= MAX_POOLS}>Add pool</Button>
			</Flex>
			<VStack align="stretch" spacing={2} mb={5}>
				{draft.pools.map((pool: any) => {
					const inPool = draft.rewards.filter((p: any) => p.pool === pool.id);
					const live = inPool.filter(rewardLive).length;
					const games = draft.games.filter((g: any) => g.pool === pool.id);
					const armed = games.filter((g: any) => gameArmed(g, draft.rewards)).length;
					return (
						<HStack key={pool.id} spacing={2} wrap="wrap" borderWidth="1px" borderRadius="md" p={2}>
							<Input size="sm" maxW="220px" placeholder="Pool name" value={pool.name} onChange={(e) => patchPool(pool.id, { name: e.target.value }, `pn${pool.id}`)} />
							<Badge colorScheme={live ? "blue" : "gray"}>{live} of {inPool.length} reward{inPool.length === 1 ? "" : "s"} can drop</Badge>
							<Badge colorScheme={armed ? "green" : games.length ? "red" : "gray"}>{armed} of {games.length} minigame{games.length === 1 ? "" : "s"} ready</Badge>
							{!games.length && <Text fontSize="xs" color="gray.500">no minigame pays from it, so nothing in it can drop</Text>}
							<Box flex="1" />
							<Button size="xs" variant="ghost" colorScheme="red" isDisabled={draft.pools.length <= 1} onClick={() => deletePool(pool.id)}>Delete</Button>
						</HStack>
					);
				})}
			</VStack>
			<Text fontSize="xs" color="gray.500" mt={-3} mb={5}>
				Deleting a pool moves its rewards and minigames to the first one. There&apos;s always at least one pool.
			</Text>

			{/* ---- the minigames ---- */}
			<Flex align="center" gap={3} mb={2} wrap="wrap">
				<Text fontWeight="bold">Minigames</Text>
				<Text fontSize="sm" color="gray.600">Each drop picks one of the ones that are on, at random, then draws from its pool.</Text>
				<Badge colorScheme={liveGames.length ? "green" : "red"}>{liveGames.length} ready</Badge>
				<Box flex="1" />
				<Button size="sm" onClick={addGame} isDisabled={draft.games.length >= MAX_GAMES}>Add minigame</Button>
			</Flex>
			{draft.games.length === 0 && (
				<Text fontSize="sm" color="gray.500" mb={3}>No minigames yet — a drop needs at least one to play.</Text>
			)}
			<VStack align="stretch" spacing={3} mb={5}>
				{draft.games.map((g: any) => {
					const kind = GAME_KINDS.find((k) => k.key === g.kind) || GAME_KINDS[0];
					const ready = gamePlayable(g);
					const stocked = draft.rewards.some((p: any) => rewardLive(p) && p.pool === g.pool);
					return (
						<Box key={g.id} borderWidth="1px" borderRadius="md" p={3} opacity={g.enabled ? 1 : 0.55}>
							<HStack spacing={2} wrap="wrap" mb={2}>
								<Select size="sm" maxW="200px" value={g.kind} onChange={(e) => patchGame(g.id, { kind: e.target.value })}>
									{GAME_KINDS.map((k) => (
										<option key={k.key} value={k.key}>{k.label}</option>
									))}
								</Select>
								<Input size="sm" maxW="180px" placeholder="Name (just for this tab)" value={g.name} onChange={(e) => patchGame(g.id, { name: e.target.value }, `gn${g.id}`)} />
								<Text fontSize="sm" color="gray.600">in</Text>
								<NumberField width="90px" min={5} max={3600} value={g.seconds} onCommit={(n) => patchGame(g.id, { seconds: n }, `gs${g.id}`)} />
								<Text fontSize="sm" color="gray.600">sec</Text>
								<HStack spacing={1}>
									<Text fontSize="sm" color="gray.600">On</Text>
									<Switch size="sm" isChecked={g.enabled} onChange={(e) => patchGame(g.id, { enabled: e.target.checked })} />
								</HStack>
								{g.enabled && !ready && <Badge colorScheme="red">needs {g.kind === "count" ? "a range" : g.kind === "secret" ? "a phrase with a hint" : "words"}</Badge>}
								<Box flex="1" />
								<Button size="xs" isDisabled={!ready || !draft.rewards.length} onClick={() => testDrop(ws, testReward, g.id)}>Test</Button>
								<Button size="xs" variant="ghost" colorScheme="red" onClick={() => patch({ games: draft.games.filter((z: any) => z.id !== g.id) })}>Delete</Button>
							</HStack>
							<HStack spacing={2} wrap="wrap" mb={2}>
								<Text fontSize="sm" color="gray.600">Pays from</Text>
								<Select size="sm" maxW="220px" value={g.pool} onChange={(e) => patchGame(g.id, { pool: e.target.value })}>
									{draft.pools.map((pool: any) => (
										<option key={pool.id} value={pool.id}>{pool.name}</option>
									))}
								</Select>
								{g.enabled && ready && !stocked && <Badge colorScheme="red">nothing in that pool can drop</Badge>}
							</HStack>
							<Text fontSize="xs" color="gray.500" mb={2}>{kind.hint}</Text>
							{g.kind === "chant" && (
								<HStack spacing={2} wrap="wrap" mb={2}>
									<Text fontSize="sm" color="gray.600">Say it</Text>
									<NumberField width="90px" min={1} max={10000} value={g.times} onCommit={(n) => patchGame(g.id, { times: n }, `gt${g.id}`)} />
									<Text fontSize="sm" color="gray.600">times</Text>
									<HStack spacing={1}>
										<Switch size="sm" isChecked={g.streak} onChange={(e) => patchGame(g.id, { streak: e.target.checked })} />
										<Text fontSize="sm" color="gray.600">in a row</Text>
									</HStack>
								</HStack>
							)}
							{g.kind === "count" && (
								<HStack spacing={2} wrap="wrap" mb={2}>
									<Text fontSize="sm" color="gray.600">From</Text>
									<NumberField width="100px" min={-100000} max={100000} value={g.from} onCommit={(n) => patchGame(g.id, { from: n }, `gf${g.id}`)} />
									<Text fontSize="sm" color="gray.600">to</Text>
									<NumberField width="100px" min={-100000} max={100000} value={g.to} onCommit={(n) => patchGame(g.id, { to: n }, `gto${g.id}`)} />
									<HStack spacing={1}>
										<Switch size="sm" isChecked={g.resetOnMistake} onChange={(e) => patchGame(g.id, { resetOnMistake: e.target.checked })} />
										<Text fontSize="sm" color="gray.600">a wrong number starts it over</Text>
									</HStack>
								</HStack>
							)}
							{g.kind === "subpoints" && (
								<HStack spacing={2} wrap="wrap" mb={2}>
									<Text fontSize="sm" color="gray.600">Reach</Text>
									<NumberField width="100px" min={1} max={100000} value={g.points} onCommit={(n) => patchGame(g.id, { points: n }, `gp${g.id}`)} />
									<Text fontSize="sm" color="gray.600">sub points</Text>
								</HStack>
							)}
							{g.kind === "secret" && (
								<Box>
									<Flex align="center" gap={2} mb={2} wrap="wrap">
										<Text fontSize="sm" color="gray.600">
											Phrases — one is drawn for each drop, then one of its hints goes up
										</Text>
										<Box flex="1" />
										<Button size="xs" onClick={() => addSecret(g.id)} isDisabled={g.secrets.length >= MAX_SECRETS}>Add phrase</Button>
									</Flex>
									{g.secrets.length === 0 && (
										<Text fontSize="xs" color="gray.500" mb={2}>No phrases yet — add one and give it a hint or two.</Text>
									)}
									<VStack align="stretch" spacing={2}>
										{g.secrets.map((s: any, i: number) => (
											<Flex key={i} gap={2} wrap="wrap" borderWidth="1px" borderRadius="md" p={2} align="flex-start">
												<VStack align="stretch" spacing={1} minW="200px" flex="0 0 auto">
													<Text fontSize="xs" color="gray.500">The phrase to guess</Text>
													<Input size="sm" placeholder="perk a cola" value={s.phrase}
														onChange={(e) => patchSecret(g.id, i, { phrase: e.target.value }, `sp${g.id}${i}`)} />
													{!secretReady(s) && <Badge colorScheme="red" alignSelf="flex-start">needs {s.phrase ? "a hint" : "a phrase"}</Badge>}
												</VStack>
												<VStack align="stretch" spacing={1} flex="1" minW="240px">
													<Text fontSize="xs" color="gray.500">Hints — one per line, one is picked</Text>
													<Textarea
														size="sm"
														rows={2}
														placeholder={"a drink that makes you better\nquick revive is one"}
														value={s.hints.join("\n")}
														onChange={(e) => patchSecret(g.id, i, { hints: e.target.value.split("\n") }, `sh${g.id}${i}`)}
													/>
												</VStack>
												<Button size="xs" variant="ghost" colorScheme="red" alignSelf="center" onClick={() => deleteSecret(g.id, i)}>Delete</Button>
											</Flex>
										))}
									</VStack>
								</Box>
							)}
							{(g.kind === "chant" || g.kind === "scramble") && (
								<Box>
									<Text fontSize="sm" color="gray.600" mb={1}>
										{g.kind === "chant" ? "Phrases" : "Words"} — one per line, one is picked for each drop
									</Text>
									<Textarea
										size="sm"
										rows={3}
										placeholder={g.kind === "chant" ? "movies\nbrains" : "zombies\nperk a cola"}
										value={g.words.join("\n")}
										onChange={(e) => patchGame(g.id, { words: e.target.value.split("\n") }, `gw${g.id}`)}
									/>
								</Box>
							)}
						</Box>
					);
				})}
			</VStack>

			{/* ---- the rewards ---- */}
			<Flex align="center" gap={3} mb={2} wrap="wrap">
				<Text fontWeight="bold">Rewards</Text>
				<Text fontSize="sm" color="gray.600">
					What can drop, by pool. Rarity is a weight against the rest of its pool, like the mystery box prizes.
				</Text>
				<Badge colorScheme={liveRewards.length ? "green" : "red"}>{liveRewards.length} can drop</Badge>
			</Flex>
			<Text fontSize="xs" color="gray.500" mb={3}>
				A reward that goes to one person (ray gun shots, more boxes, <Code fontSize="xs">{"{user}"}</Code> in a
				command) goes to whoever finished the minigame: the last number counted, the last line of the chant, the
				unscrambler, or the gifter of the last sub points. If nobody in chat finished it, that part is skipped.
			</Text>
			{draft.rewards.length === 0 && (
				<Text fontSize="sm" color="gray.500" mb={3}>
					No rewards yet. Add one to a pool, drop its art into <Code fontSize="xs">front/public/prizes</Code>, and pick what it does.
				</Text>
			)}
			{draft.pools.map((pool: any) => (
				<Box key={pool.id} mb={5}>
					<Flex align="center" gap={3} mb={2} wrap="wrap">
						<Badge colorScheme="purple" fontSize="sm">{pool.name}</Badge>
						<Text fontSize="sm" color="gray.600">
							{draft.rewards.filter((p: any) => p.pool === pool.id).length === 0
								? "Nothing in this pool yet."
								: `Paid out by ${draft.games.filter((g: any) => g.pool === pool.id).map((g: any) => g.name || (GAME_KINDS.find((k) => k.key === g.kind) || GAME_KINDS[0]).label).join(", ") || "no minigame yet"}.`}
						</Text>
						<Box flex="1" />
						<Button size="sm" onClick={() => addReward(pool.id)} isDisabled={draft.rewards.length >= MAX_REWARDS}>Add reward</Button>
					</Flex>
					<VStack align="stretch" spacing={3}>
						{draft.rewards.filter((p: any) => p.pool === pool.id).map((p: any) => {
							const odds = rewardOdds(draft.rewards, p);
							const img = prizeImageSrc(p.image);
							const inPool = draft.games.filter((g: any) => g.pool === p.pool && gamePlayable(g));
							return (
								<Box key={p.id} borderWidth="1px" borderRadius="md" p={3} opacity={p.enabled ? 1 : 0.55}>
									<Flex gap={3} wrap="wrap">
										<Box w="86px" h="86px" flex="0 0 auto" borderWidth="1px" borderRadius="md" bg="gray.50"
											display="flex" alignItems="center" justifyContent="center" overflow="hidden">
											{img
												? <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
												: <Text fontSize="xs" color="gray.400">no art</Text>}
										</Box>
										<VStack align="stretch" spacing={2} flex="1" minW="280px">
											<HStack spacing={2} wrap="wrap">
												<Input size="sm" maxW="200px" placeholder="Reward name" value={p.name}
													onChange={(e) => patchReward(p.id, { name: e.target.value }, `n${p.id}`)} />
												<HStack spacing={1}>
													<Text fontSize="sm" color="gray.600">Rarity</Text>
													<NumberField width="90px" min={0} max={1000} value={p.weight} onCommit={(n) => patchReward(p.id, { weight: n }, `w${p.id}`)} />
													<Badge colorScheme={odds > 0 ? "blue" : "gray"}>{odds > 0 ? `${odds.toFixed(2)}%` : "never"}</Badge>
												</HStack>
												<HStack spacing={1}>
													<Text fontSize="sm" color="gray.600">On</Text>
													<Switch size="sm" isChecked={p.enabled} onChange={(e) => patchReward(p.id, { enabled: e.target.checked })} />
												</HStack>
												<HStack spacing={1}>
													<Text fontSize="sm" color="gray.600">Pool</Text>
													<Select size="sm" maxW="160px" value={p.pool} onChange={(e) => patchReward(p.id, { pool: e.target.value })}>
														{draft.pools.map((z: any) => (
															<option key={z.id} value={z.id}>{z.name}</option>
														))}
													</Select>
												</HStack>
												<Box flex="1" />
												<Button size="xs" isDisabled={!inPool.length && !testGame} onClick={() => testDrop(ws, p.id, testGame)}>Test</Button>
												<Button size="xs" variant="ghost" isDisabled={draft.rewards.length >= MAX_REWARDS} onClick={() => duplicateReward(p.id)}>Duplicate</Button>
												<Button size="xs" variant="ghost" colorScheme="red" onClick={() => patch({ rewards: draft.rewards.filter((z: any) => z.id !== p.id) })}>Delete</Button>
											</HStack>
											<HStack spacing={2} wrap="wrap">
												<Select size="sm" maxW="200px" value={PRIZE_IMAGES.includes(p.image) ? p.image : ""} onChange={(e) => patchReward(p.id, { image: e.target.value })}>
													<option value="">(art: none)</option>
													{PRIZE_IMAGES.map((f) => (
														<option key={f} value={f}>{f}</option>
													))}
												</Select>
												<Input size="sm" maxW="240px" placeholder="…or an image URL" value={PRIZE_IMAGES.includes(p.image) ? "" : p.image}
													onChange={(e) => patchReward(p.id, { image: e.target.value }, `i${p.id}`)} />
											</HStack>
											<HStack spacing={2} wrap="wrap">
												<SoundPick value={p.sound} volume={p.volume} none="(grabbed sound: the default)"
													onPick={(v) => patchReward(p.id, { sound: v })} onVolume={(v) => patchReward(p.id, { volume: v }, `v${p.id}`)} />
											</HStack>
											<Divider />
											<HStack spacing={2} wrap="wrap">
												<Text fontSize="sm" color="gray.600">Does</Text>
												<Select size="sm" maxW="220px" value={p.effect.kind} onChange={(e) => patchEffect(p.id, { kind: e.target.value })}>
													{REWARD_KINDS.map((k) => (
														<option key={k.key} value={k.key}>{k.label}</option>
													))}
												</Select>
											</HStack>
											<EffectFields prize={p} patchEffect={patchEffect} events={events} textBoxes={textBoxes} />
										</VStack>
									</Flex>
								</Box>
							);
						})}
					</VStack>
				</Box>
			))}

			<Text fontSize="xs" color="gray.500">
				Reward art lives in <Code fontSize="xs">front/public/prizes</Code> and sounds in{" "}
				<Code fontSize="xs">front/public/media</Code>, the same folders the mystery box uses. Both lists are read
				when the site starts, so a file dropped in while it&apos;s running needs a restart before it shows up here.
			</Text>
		</Box>
	);
};

export default Drops;
