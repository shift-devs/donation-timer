import React, { useCallback, useState } from "react";
import { Badge, Box, Button, Checkbox, Code, Flex, HStack, Input, Select, Switch, Text, VStack } from "@chakra-ui/react";
import { setWonderBoxSettings, giveMysteryBox, testMysteryBox, stopMysteryBox } from "../../Api";
import NumberField from "../../NumberField";
import { canonWonderBox, canonMysteryBox, prizeProfiles, inActiveProfile } from "../../mysterybox";
import { SOUNDS } from "./EffectFields";
import { useSyncedDraft } from "./useSyncedDraft";

// The wonder box: a mystery box with its own prizes and its own wallet, earned by FIRESALES (the mystery box
// keeps everything else). It spins on the same /mysterybox source with the mystery box's reel settings and
// colours, and only one box of either kind spins at a time. A mystery box prize can hand out wonder boxes
// ("Wonder boxes" effect). Everything here applies immediately — no Save.
const WonderBox: React.FC<{ ws: any; settings: any; run: any; products: any[] | null }> = ({ ws, settings, run, products }) => {
	const send = useCallback((next: any) => setWonderBoxSettings(ws, next), [ws]);
	const { draft, patch } = useSyncedDraft(settings.wonderBoxSettings, canonWonderBox, send);
	const [giveName, setGiveName] = useState("");
	const [giveCount, setGiveCount] = useState(1);
	const [openPrize, setOpenPrize] = useState("");
	const [itemRule, setItemRule] = useState("");

	const addItemRule = () => {
		const v = itemRule.trim();
		if (!v || draft.firesaleItems.includes(v))
			return;
		patch((d: any) => ({ firesaleItems: [...d.firesaleItems, v] }));
		setItemRule("");
	};

	const phase: string = (run && run.phase) || "idle";
	const mine = phase !== "idle" && run && run.kind === "wonder";
	const mbCommand = (settings.mysteryBoxSettings && settings.mysteryBoxSettings.command) || "mb";

	const boxes: { [key: string]: any } = settings.wonderBoxes || {};
	const owners = Object.keys(boxes)
		.map((k) => ({ key: k, name: boxes[k].name || k, count: boxes[k].count || 0 }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	const outstanding = owners.reduce((sum, o) => sum + o.count, 0);
	// the prizes live on the Mystery Box tab; this box reads them at their Wonder rarity
	const prizes: any[] = canonMysteryBox(settings.mysteryBoxSettings).prizes;
	const liveW = (p: any) => p.enabled && p.wonderWeight > 0 && inActiveProfile(draft.activeProfile, p);
	const inPlay = prizes.filter(liveW);
	const total = inPlay.reduce((sum, p) => sum + p.wonderWeight, 0);
	const profiles = prizeProfiles(prizes, draft.activeProfile);

	return (
		<Box maxW="960px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="muted" mb={3}>
				A second mystery box with its own wallet, drawing from the <b>same prizes</b> as the mystery box at
				their <b>Wonder rarity</b> (set on the Mystery Box tab). <b>Firesales earn wonder boxes</b> (bingo,
				gifted subs, channel points and raffles earn mystery boxes). Chat opens one with{" "}
				<Code fontSize="xs">!{draft.command} open</Code> and counts with <Code fontSize="xs">!{draft.command} count</Code>;
				mods get the same give / take / stop / test as <Code fontSize="xs">!{mbCommand}</Code>, and the Terminal
				takes <Code fontSize="xs">wb …</Code> the way it takes <Code fontSize="xs">mb …</Code>. It spins on the
				same <b>/mysterybox</b> source, with the Mystery Box tab&apos;s reel speed, hold and colours, and only one
				box of either kind spins at a time. A mystery box prize set to <b>Wonder boxes</b> hands these out.
			</Text>

			{/* ---- what's happening right now ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Live</Text>
					{mine
						? <Badge colorScheme={phase === "spinning" ? "purple" : "green"}>{phase === "spinning" ? "SPINNING" : "PRIZE UP"}</Badge>
						: phase !== "idle" ? <Badge colorScheme="gray">A MYSTERY BOX IS UP</Badge> : <Badge>IDLE</Badge>}
					{mine && (
						<Text fontSize="sm" color="muted">
							<b>{run.opener}</b>
							{phase === "reveal" && run.prize ? ` won ${run.prize.name || run.prize.id}` : ""}
						</Text>
					)}
					{mine && <Button size="xs" variant="ghost" onClick={() => stopMysteryBox(ws)}>Clear</Button>}
				</Flex>
				{!draft.allowOpening && draft.enabled && (
					<Text fontSize="sm" color="orange.300" mb={2}>
						Chat can&apos;t open wonder boxes at the moment — they&apos;re still earning them, and you can still
						test from here.
					</Text>
				)}
				{run && (run.blockedWonder ?? run.blocked) && (
					<Text fontSize="sm" color="orange.300" mb={2}>
						Chat can&apos;t open a box right now — {run.blockedWonder ?? run.blocked}.
					</Text>
				)}
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="subtle">Test spin</Text>
					<Select size="sm" maxW="220px" value={openPrize} onChange={(e) => setOpenPrize(e.target.value)}>
						<option value="">(a fair draw)</option>
						{prizes.map((p: any) => (
							<option key={p.id} value={p.id}>{p.name || p.id}</option>
						))}
					</Select>
					<Button size="sm" onClick={() => testMysteryBox(ws, openPrize, "wonder")} isDisabled={!prizes.length}>
						Spin
					</Button>
					<Text fontSize="xs" color="subtle">
						Spends nobody&apos;s box — but the prize&apos;s effect fires for real.
					</Text>
				</HStack>
			</Box>

			{/* ---- who is holding wonder boxes ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Wonder boxes owed</Text>
					<Text fontSize="sm" color="muted">
						{outstanding} unopened across {owners.length} {owners.length === 1 ? "person" : "people"}
					</Text>
				</Flex>
				{owners.length === 0 && (
					<Text fontSize="sm" color="subtle" mb={2}>
						Nobody is holding a wonder box yet. They&apos;re credited when Fourthwall announces a giveaway, to
						whoever it names as the gifter. A gifter whose Fourthwall name isn&apos;t their Twitch login can be
						moved across with the Move control on the Mystery Box tab.
					</Text>
				)}
				<VStack align="stretch" spacing={1} mb={3} maxH="220px" overflowY="auto">
					{owners.map((o) => (
						<Flex key={o.key} align="center" gap={2} fontSize="sm">
							<Text flex="1" minW="140px">{o.name}</Text>
							<Badge colorScheme={o.count > 0 ? "yellow" : "gray"}>{o.count}</Badge>
							<Button size="xs" variant="ghost" onClick={() => giveMysteryBox(ws, o.key, 1, "wonder")}>+1</Button>
							<Button size="xs" variant="ghost" onClick={() => giveMysteryBox(ws, o.key, -1, "wonder")}>−1</Button>
						</Flex>
					))}
				</VStack>
				<HStack spacing={2} wrap="wrap">
					<Input size="sm" maxW="200px" placeholder="Twitch name" value={giveName} onChange={(e) => setGiveName(e.target.value)} />
					<NumberField width="90px" min={1} max={99} value={giveCount} onCommit={setGiveCount} />
					<Button
						size="sm"
						isDisabled={!giveName.trim()}
						onClick={() => { giveMysteryBox(ws, giveName.trim(), giveCount, "wonder"); setGiveName(""); }}
					>
						Give
					</Button>
				</HStack>
			</Box>

			{/* ---- the prizes: the mystery box's list, at each prize's Wonder rarity ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Prizes</Text>
					<Text fontSize="sm" color="muted">
						Edited on the Mystery Box tab — give a prize a <b>Wonder rarity</b> above 0 to put it in here.
					</Text>
				</Flex>
				<Flex align="center" gap={2} mb={3} wrap="wrap">
					<Text fontSize="sm" color="muted">Playing</Text>
					<Select size="sm" maxW="220px" value={draft.activeProfile} onChange={(e) => patch({ activeProfile: e.target.value })}>
						<option value="">(no profile — just the always-on prizes)</option>
						{profiles.map((n) => (
							<option key={n} value={n}>{n}</option>
						))}
					</Select>
					<Badge colorScheme={inPlay.length ? "green" : "red"}>
						{inPlay.length} prize{inPlay.length === 1 ? "" : "s"} in play
					</Badge>
				</Flex>
				{!inPlay.length && (
					<Text fontSize="sm" color="red.300">
						Nothing can be won from a wonder box yet — no prize in play has a Wonder rarity above 0.
					</Text>
				)}
				<VStack align="stretch" spacing={1} maxH="260px" overflowY="auto">
					{inPlay
						.slice()
						.sort((a, b) => b.wonderWeight - a.wonderWeight || String(a.name).localeCompare(String(b.name)))
						.map((p) => (
							<Flex key={p.id} align="center" gap={2} fontSize="sm">
								<Text flex="1" minW="140px">{p.name || p.id}</Text>
								<Text color="subtle">rarity {p.wonderWeight}</Text>
								<Badge colorScheme="blue">{((p.wonderWeight / total) * 100).toFixed(2)}%</Badge>
								<Button size="xs" variant="ghost" onClick={() => testMysteryBox(ws, p.id, "wonder")}>Test</Button>
							</Flex>
						))}
				</VStack>
			</Box>

			{/* ---- how it behaves ---- */}
			<Text fontWeight="bold" mb={2}>Behaviour</Text>
			<VStack align="stretch" spacing={3} mb={5}>
				<HStack spacing={3} wrap="wrap">
					<HStack spacing={2}>
						<Switch isChecked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
						<Text fontSize="sm">Wonder boxes on</Text>
					</HStack>
					<HStack spacing={2}>
						<Switch isChecked={draft.allowOpening} isDisabled={!draft.enabled} onChange={(e) => patch({ allowOpening: e.target.checked })} />
						<Text fontSize="sm">Chat can open them</Text>
					</HStack>
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">Cooldown</Text>
						<NumberField width="80px" min={0} max={3600} value={draft.cooldownSec} onCommit={(n) => patch({ cooldownSec: n }, "cooldown")} />
						<Text fontSize="sm" color="muted">sec after a box finishes</Text>
					</HStack>
					<HStack spacing={1}>
						<Text fontSize="sm" color="muted">Command</Text>
						<Text fontSize="sm" color="subtle">!</Text>
						<Input size="sm" maxW="110px" value={draft.command} onChange={(e) => patch({ command: e.target.value.replace(/^!/, "") }, "cmd")} />
					</HStack>
				</HStack>
				{draft.command === mbCommand && (
					<Text fontSize="xs" color="red.300">
						That&apos;s the mystery box&apos;s command too — chat would only ever open mystery boxes. Pick another.
					</Text>
				)}
				<HStack spacing={2} wrap="wrap">
					<Text fontSize="sm" color="muted">Spin music</Text>
					<Select size="sm" maxW="260px" value={draft.music} onChange={(e) => patch({ music: e.target.value })}>
						<option value="">(same as the mystery box)</option>
						{SOUNDS.map((f) => (
							<option key={f} value={f}>{f}</option>
						))}
					</Select>
					{draft.music && (<>
						<Text fontSize="sm" color="muted">Vol</Text>
						<input type="range" min={0} max={1} step={0.05} value={draft.volume} onChange={(e) => patch({ volume: Number(e.target.value) }, "vol")} />
					</>)}
				</HStack>
				<HStack spacing={4} wrap="wrap">
					<HStack spacing={2}>
						<Text fontSize="sm" color="muted">Title colour</Text>
						<input type="color" value={draft.titleColor} onChange={(e) => patch({ titleColor: e.target.value }, "wbtitle")} />
					</HStack>
					<HStack spacing={2}>
						<Text fontSize="sm" color="muted">Pulse colour</Text>
						<input type="color" value={draft.pulseColor} onChange={(e) => patch({ pulseColor: e.target.value }, "wbpulse")} />
					</HStack>
					<Text fontSize="xs" color="subtle">
						while a wonder box spins, its title is drawn in this colour and it and the winning tile pulse
					</Text>
				</HStack>
				<Text fontSize="xs" color="subtle">
					People holding an unopened wonder box get the same chat reminder as mystery boxes, on the Mystery Box
					tab&apos;s schedule.
				</Text>
			</VStack>

			{/* ---- what earns one ---- */}
			<Text fontWeight="bold" mb={2}>What earns a wonder box</Text>
			<Box borderWidth="1px" borderRadius="md" p={3} mb={5} opacity={draft.enabled ? 1 : 0.6}>
				<HStack spacing={2} mb={draft.grantOnFiresale ? 2 : 0}>
					<Switch isChecked={draft.grantOnFiresale} onChange={(e) => patch({ grantOnFiresale: e.target.checked })} />
					<Text fontSize="sm" fontWeight="bold">Firesales</Text>
					{!draft.grantOnFiresale && <Badge>OFF</Badge>}
				</HStack>
				{draft.grantOnFiresale && (<>
					<HStack spacing={1} mb={2}>
						<Text fontSize="sm" color="muted">Each item put up earns the gifter</Text>
						<NumberField width="70px" min={1} max={99} value={draft.firesaleBoxes} onCommit={(n) => patch({ firesaleBoxes: n }, "fsb")} />
						<Text fontSize="sm" color="muted">wonder box{draft.firesaleBoxes === 1 ? "" : "es"}</Text>
					</HStack>
					<Text fontSize="xs" color="subtle" mb={2}>
						{draft.firesaleItems.length === 0
							? "Nothing ticked, so every Fourthwall giveaway earns the gifter a wonder box. Tick some to narrow it down."
							: `Only giveaways of these earn one — ${draft.firesaleItems.length} picked.`}
					</Text>
					{products === null && <Text fontSize="xs" color="subtle">Loading your Fourthwall products…</Text>}
					{products !== null && products.length === 0 && (
						<Text fontSize="xs" color="subtle">
							No products loaded — connect Fourthwall, or type an item name in the box below.
						</Text>
					)}
					<VStack align="stretch" spacing={0} maxH="200px" overflowY="auto" mb={2}>
						{(products || []).map((p: any) => (
							<Checkbox
								key={p.id}
								size="sm"
								isChecked={draft.firesaleItems.includes(p.name)}
								onChange={(e) => {
									const on = e.target.checked;
									patch((d: any) => ({
										firesaleItems: on ? [...d.firesaleItems, p.name] : d.firesaleItems.filter((n: string) => n !== p.name),
									}));
								}}
							>
								<Text fontSize="sm">{p.name}</Text>
							</Checkbox>
						))}
					</VStack>
					{/* anything ticked that ISN'T one of the loaded products — a name typed by hand, or a product
					    that has since been renamed or delisted. it would otherwise vanish from the list while
					    still silently deciding who gets a box. */}
					{draft.firesaleItems.filter((n: string) => !(products || []).some((p: any) => p.name === n)).map((n: string) => (
						<Flex key={n} align="center" gap={2} mb={1}>
							<Badge colorScheme="purple">match</Badge>
							<Text fontSize="sm" flex="1">{n}</Text>
							<Button size="xs" variant="ghost" onClick={() => patch((d: any) => ({ firesaleItems: d.firesaleItems.filter((x: string) => x !== n) }))}>
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
					<Text fontSize="xs" color="subtle" mt={1}>
						Matched against what Fourthwall announces, ignoring case — a partial name is enough, so
						&quot;collector&quot; covers every collector&apos;s edition.
					</Text>
				</>)}
			</Box>
		</Box>
	);
};

export default WonderBox;
