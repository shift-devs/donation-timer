import React, { useCallback, useMemo } from "react";
import { Badge, Box, Button, Checkbox, Code, Divider, Flex, HStack, Input, Select, Switch, Text, VStack } from "@chakra-ui/react";
import NumberField from "../../NumberField";
import { prizeImageSrc, prizeProfiles, inActiveProfile, EFFECT_KINDS, DEFAULT_PRIZE } from "../../mysterybox";
import EffectFields, { PRIZE_IMAGES, SOUNDS } from "./EffectFields";

// the prize list, shared by the Mystery Box and Wonder Box tabs.
//
// EACH CARD IS MEMOISED. a card is a dozen inputs and several dropdowns listing every sound file, and before
// this every keystroke anywhere on the tab — and the countdown tick, twice a second while anything was
// running — re-rendered every one of them. with a few dozen prizes that's thousands of <option>s per
// keystroke, which is the lag that grew with the list. now a card only re-renders when its own prize (or its
// odds) changes, so typing in one prize costs one card.

type PatchFn = (p: any, key?: string) => void;

type CardProps = {
	prize: any;
	odds: number;
	live: boolean;
	wonderOdds: number;
	wonderLive: boolean;
	events: any[];
	textBoxes: any[];
	listId: string;
	patchPrize: (id: string, p: any, key?: string) => void;
	patchEffect: (id: string, p: any, key?: string) => void;
	onTest: (id: string) => void;
	onRemove: (id: string) => void;
};

const PrizeCard: React.FC<CardProps> = React.memo(({ prize: p, odds, live, wonderOdds, wonderLive, events, textBoxes, listId, patchPrize, patchEffect, onTest, onRemove }) => {
	const img = prizeImageSrc(p.image);
	// a prize is greyed out only when neither box can land on it
	const inEither = live || wonderLive;
	const badge = (o: number, w: number, isLive: boolean) => (
		<Badge colorScheme={o > 0 ? "blue" : w <= 0 && p.gag && isLive ? "purple" : "gray"}>
			{o > 0 ? `${o.toFixed(2)}%` : !isLive ? "other profile" : w <= 0 && p.gag ? "0% — on the reel" : "never"}
		</Badge>
	);
	return (
		<Box borderWidth="1px" borderRadius="md" p={3} opacity={p.enabled && inEither ? 1 : 0.55}>
			<Flex gap={3} wrap="wrap">
				{/* the art, at the shape the reel draws it */}
				<Box
					w="86px"
					h="86px"
					flex="0 0 auto"
					borderWidth="1px"
					borderRadius="md"
					bg="panel"
					display="flex"
					alignItems="center"
					justifyContent="center"
					overflow="hidden"
				>
					{img
						? <img src={img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
						: <Text fontSize="xs" color="faint">no art</Text>}
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
							list={listId}
							placeholder="always on"
							title="Leave blank and this prize is in play whatever profile is selected. Type a name to make it part of that profile only."
							value={p.profile}
							onChange={(e) => patchPrize(p.id, { profile: e.target.value }, `pr${p.id}`)}
						/>
						<HStack spacing={1}>
							<Text fontSize="sm" color="muted">Mystery rarity</Text>
							<NumberField
								width="90px"
								min={0}
								max={1000}
								value={p.weight}
								onCommit={(n) => patchPrize(p.id, { weight: n }, `w${p.id}`)}
							/>
							{/* two decimals throughout: rounding to whole numbers hid the difference between a
							    1-in-200 prize and a 1-in-2000 one, which is exactly the end of the range the weights
							    are being tuned at */}
							{badge(odds, p.weight, live)}
						</HStack>
						{/* the same prize's rarity in the wonder box — 0 keeps it out of the wonder box */}
						<HStack spacing={1}>
							<Text fontSize="sm" color="muted">Wonder rarity</Text>
							<NumberField
								width="90px"
								min={0}
								max={1000}
								value={p.wonderWeight}
								onCommit={(n) => patchPrize(p.id, { wonderWeight: n }, `ww${p.id}`)}
							/>
							{badge(wonderOdds, p.wonderWeight, wonderLive)}
						</HStack>
						{/* rarity 0 can never be won; this keeps it scrolling past anyway, as a gag (in whichever box
						    it's at 0 in) */}
						{(p.weight <= 0 || p.wonderWeight <= 0) && (
							<Checkbox
								size="sm"
								isChecked={!!p.gag}
								onChange={(e) => patchPrize(p.id, { gag: e.target.checked })}
								title="It can never be won at rarity 0, but it still flies past on the reel."
							>
								<Text fontSize="sm" color="muted">Show on reel anyway</Text>
							</Checkbox>
						)}
						<HStack spacing={1}>
							<Text fontSize="sm" color="muted">On</Text>
							<Switch
								size="sm"
								isChecked={p.enabled}
								onChange={(e) => patchPrize(p.id, { enabled: e.target.checked })}
							/>
						</HStack>
						<Box flex="1" />
						<Button size="xs" onClick={() => onTest(p.id)}>Test</Button>
						<Button size="xs" variant="ghost" colorScheme="red" onClick={() => onRemove(p.id)}>Delete</Button>
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
						<Text fontSize="sm" color="muted">Vol</Text>
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
						<Text fontSize="sm" color="muted">Does</Text>
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
					<EffectFields prize={p} patchEffect={patchEffect} events={events} textBoxes={textBoxes} />
				</VStack>
			</Flex>
		</Box>
	);
});
PrizeCard.displayName = "PrizeCard";

// keep an array's identity while its contents are unchanged. the sync hands over freshly parsed objects every
// time, and a new-but-equal events list would otherwise defeat every card's memo on every sync.
export function useStable<T>(value: T): T {
	const key = JSON.stringify(value);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	return useMemo(() => value, [key]);
}

const PrizeList: React.FC<{
	prizes: any[];
	activeProfile: string;
	patch: PatchFn;
	onTest: (id: string) => void;
	events: any[];
	textBoxes: any[];
	listId: string;
	what: string; // "box" / "wonder box", for the help text
	// the wonder box's profile, which picks which prizes are in play there. its own picker is on its tab.
	wonderProfile: string;
}> = ({ prizes, activeProfile, patch, onTest, events, textBoxes, listId, what, wonderProfile }) => {
	const stableEvents = useStable(events);
	const stableTextBoxes = useStable(textBoxes);

	// the whole list goes back every time, which is what keeps the server's copy and this one the same shape —
	// the normalizer there rebuilds it from scratch either way. read off the draft at the moment of the edit,
	// so these never change identity.
	const patchPrize = useCallback((id: string, p: any, key?: string) =>
		patch((d: any) => ({ prizes: d.prizes.map((z: any) => (z.id === id ? { ...z, ...p } : z)) }), key), [patch]);
	const patchEffect = useCallback((id: string, p: any, key?: string) =>
		patch((d: any) => ({ prizes: d.prizes.map((z: any) => (z.id === id ? { ...z, effect: { ...z.effect, ...p } } : z)) }), key), [patch]);
	const removePrize = useCallback((id: string) =>
		patch((d: any) => ({ prizes: d.prizes.filter((z: any) => z.id !== id) })), [patch]);
	const addPrize = () => {
		// ids only have to be unique within the list, and a timestamp is the cheapest way to be sure of that
		const id = `p${Date.now().toString(36)}`;
		patch((d: any) => ({ prizes: [...d.prizes, { ...DEFAULT_PRIZE, id, name: `Prize ${d.prizes.length + 1}`, effect: { ...DEFAULT_PRIZE.effect } }] }));
	};

	// the profiles that exist, and what the current one leaves in play. odds are worked out once for the whole
	// list rather than once per card (which summed the list again for every prize).
	const profiles = prizeProfiles(prizes, activeProfile);
	const live = (p: any) => p.enabled && p.weight > 0 && inActiveProfile(activeProfile, p);
	const inPlay = prizes.filter(live);
	const total = inPlay.reduce((sum, p) => sum + p.weight, 0);
	const liveW = (p: any) => p.enabled && p.wonderWeight > 0 && inActiveProfile(wonderProfile, p);
	const inPlayW = prizes.filter(liveW);
	const totalW = inPlayW.reduce((sum, p) => sum + p.wonderWeight, 0);

	return (
		<>
			<Flex align="center" gap={3} mb={2} wrap="wrap">
				<Text fontWeight="bold">Prizes</Text>
				<Text fontSize="sm" color="muted">
					One list for both boxes: each prize has a <b>Mystery rarity</b> and a <b>Wonder rarity</b>. Rarity is
					a weight, not a percentage — the odds beside each one are what it works out to in that box. Rarity 0
					keeps it out of that box; tick <b>Show on reel anyway</b> to keep it flying past as a gag.
				</Text>
				<Box flex="1" />
				<Button size="sm" onClick={addPrize}>Add prize</Button>
			</Flex>

			{/* which set is in play. a prize with no profile is always in, so this only ever ADDS to the pile —
			    switching can't leave the box with nothing to give. */}
			<Flex align="center" gap={2} mb={3} wrap="wrap">
				<Text fontSize="sm" color="muted">Playing</Text>
				<Select
					size="sm"
					maxW="220px"
					value={activeProfile}
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
				<Badge colorScheme={inPlayW.length ? "purple" : "gray"}>
					{inPlayW.length} in the wonder box
				</Badge>
				{prizes.length > inPlay.length && (
					<Text fontSize="xs" color="subtle">
						{prizes.length - inPlay.length} disabled, at rarity 0, or set aside for another profile
					</Text>
				)}
				{!inPlay.length && prizes.length > 0 && (
					<Text fontSize="xs" color="red.300">
						Nothing can be won right now — every prize is disabled, zero-rarity, or in another profile.
					</Text>
				)}
			</Flex>

			{/* every profile that has been named on a prize, so the field below can autocomplete them */}
			<datalist id={listId}>
				{profiles.map((n) => <option key={n} value={n} />)}
			</datalist>

			{prizes.length === 0 && (
				<Text fontSize="sm" color="subtle" mb={3}>
					No prizes yet. Add one, drop its art into <Code fontSize="xs">front/public/prizes</Code>, and pick
					what it does. Nobody can open a {what} until something can be won.
				</Text>
			)}

			<VStack align="stretch" spacing={3} mb={5}>
				{prizes.map((p: any) => (
					<PrizeCard
						key={p.id}
						prize={p}
						odds={total && live(p) ? (p.weight / total) * 100 : 0}
						live={inActiveProfile(activeProfile, p)}
						wonderOdds={totalW && liveW(p) ? (p.wonderWeight / totalW) * 100 : 0}
						wonderLive={inActiveProfile(wonderProfile, p)}
						events={stableEvents}
						textBoxes={stableTextBoxes}
						listId={listId}
						patchPrize={patchPrize}
						patchEffect={patchEffect}
						onTest={onTest}
						onRemove={removePrize}
					/>
				))}
			</VStack>
		</>
	);
};

export default PrizeList;
