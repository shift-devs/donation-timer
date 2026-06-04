import React, { useEffect, useRef, useState } from "react";
import {
	Accordion,
	AccordionItem,
	AccordionButton,
	AccordionPanel,
	AccordionIcon,
	Badge,
	Box,
	Button,
	Flex,
	HStack,
	NumberInput,
	NumberInputField,
	Spacer,
	Text,
} from "@chakra-ui/react";
import { setRates } from "../../Api";

const PLATFORMS = [
	{
		key: "twitch",
		name: "Twitch",
		real: true,
		gated: false,
		actions: [
			{ key: "sub_t1", label: "Sub — Tier 1", unit: "per sub", test: 5 },
			{ key: "sub_t2", label: "Sub — Tier 2", unit: "per sub", test: 5 },
			{ key: "sub_t3", label: "Sub — Tier 3", unit: "per sub", test: 5 },
			{ key: "bits", label: "Bits", unit: "per bit", test: 100 },
		],
	},
	{
		key: "streamlabs",
		name: "Streamlabs",
		real: true,
		gated: true,
		actions: [
			{ key: "donation", label: "Donation", unit: "per $", test: 5 },
			{ key: "merch", label: "Merch (item price)", unit: "per $", test: 25 },
		],
	},
	{ key: "youtube", name: "YouTube", real: false, gated: true, actions: [] },
	{ key: "kick", name: "Kick", real: false, gated: true, actions: [] },
];

function fmt(seconds: number): string {
	const totalMs = Math.round(seconds * 1000);
	if (totalMs <= 0) return "0s";
	const ms = totalMs % 1000;
	const whole = Math.floor(totalMs / 1000);
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = whole % 60;
	const parts: string[] = [];
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}m`);
	if (s) parts.push(`${s}s`);
	if (ms) parts.push(`${ms}ms`);
	if (parts.length === 0) parts.push("0s");
	return parts.join(" ");
}

const DEFAULTS: any = {
	twitch: { sub_t1: 70, sub_t2: 140, sub_t3: 350, bits: 0.14 },
	streamlabs: { donation: 14, merch: 14 },
};

function normalize(raw: any) {
	const num = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
	const t = (raw && raw.twitch) || {};
	const s = (raw && raw.streamlabs) || {};
	return {
		twitch: {
			sub_t1: num(t.sub_t1, DEFAULTS.twitch.sub_t1),
			sub_t2: num(t.sub_t2, DEFAULTS.twitch.sub_t2),
			sub_t3: num(t.sub_t3, DEFAULTS.twitch.sub_t3),
			bits: num(t.bits, DEFAULTS.twitch.bits),
		},
		streamlabs: {
			donation: num(s.donation, DEFAULTS.streamlabs.donation),
			merch: num(s.merch, DEFAULTS.streamlabs.merch),
		},
	};
}

function makeTests() {
	const out: any = {};
	PLATFORMS.forEach((p) => p.actions.forEach((a) => (out[`${p.key}.${a.key}`] = a.test)));
	return out;
}

const TimePerAction: React.FC<{ ws: any; settings: any }> = ({ ws, settings }) => {
	const saved = normalize(settings.rates);
	const savedStr = JSON.stringify(saved);
	const [draft, setDraft] = useState<any>(saved);
	const [testQty, setTestQty] = useState(makeTests);
	const prevSavedRef = useRef(savedStr);

	// follow the server's rates only when there are no unsaved local edits
	useEffect(() => {
		setDraft((prev: any) => (JSON.stringify(prev) === prevSavedRef.current ? saved : prev));
		prevSavedRef.current = savedStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedStr]);

	const dirty = JSON.stringify(draft) !== savedStr;
	const setRate = (pk: string, ak: string, v: number) =>
		setDraft((d: any) => ({ ...d, [pk]: { ...d[pk], [ak]: v } }));

	const connectedOf = (p: any) =>
		p.key === "twitch" ? !!settings.twitchStatus : p.key === "streamlabs" ? !!settings.slStatus : false;

	const actionRow = (p: any, a: any) => {
		const rate = draft[p.key][a.key];
		const tkey = `${p.key}.${a.key}`;
		const qty = testQty[tkey];
		return (
			<Flex key={a.key} align="center" gap={3} py={3} borderBottomWidth="1px" wrap="wrap">
				<Box minW="150px">
					<Text fontWeight={600}>{a.label}</Text>
				</Box>
				<NumberInput
					value={String(rate)}
					onChange={(_s, n) => setRate(p.key, a.key, Number.isFinite(n) ? n : 0)}
					width="100px"
					step={rate < 1 ? 0.01 : 1}
				>
					<NumberInputField />
				</NumberInput>
				<Text fontSize="sm" color="gray.600">
					seconds {a.unit}
				</Text>
				<Spacer />
				<HStack spacing={2}>
					<NumberInput
						value={String(qty)}
						onChange={(_s, n) => setTestQty((t: any) => ({ ...t, [tkey]: Number.isFinite(n) ? n : 0 }))}
						width="100px"
						min={0}
					>
						<NumberInputField />
					</NumberInput>
					<Text color="gray.400">→</Text>
					<Text fontWeight={700} fontFamily="mono" minW="90px" textAlign="right">
						{fmt(rate * qty)}
					</Text>
				</HStack>
			</Flex>
		);
	};

	return (
		<Box textAlign="left">
			<Accordion allowMultiple defaultIndex={[0]}>
				{PLATFORMS.map((p) => (
					<AccordionItem key={p.key} isDisabled={!p.real || !connectedOf(p)}>
						<AccordionButton>
							<HStack flex="1" textAlign="left">
								<Text fontWeight={600}>{p.name}</Text>
								{!p.real ? (
									<Badge>coming soon</Badge>
								) : (
									<Badge colorScheme={connectedOf(p) ? "green" : "gray"}>
										{connectedOf(p) ? "connected" : "connect in Connections"}
									</Badge>
								)}
							</HStack>
							<AccordionIcon />
						</AccordionButton>
						<AccordionPanel pb={4}>
							{p.actions.map((a) => actionRow(p, a))}
						</AccordionPanel>
					</AccordionItem>
				))}
			</Accordion>

			<Flex bg="white" borderTopWidth="1px" mt={4} py={3} align="center" gap={3}>
				<Text color={dirty ? "orange.500" : "gray.400"} fontWeight={600}>
					{dirty ? "unsaved changes" : "all changes saved"}
				</Text>
				<Spacer />
				<Button variant="outline" isDisabled={!dirty} onClick={() => setDraft(saved)}>
					Revert
				</Button>
				<Button colorScheme="purple" isDisabled={!dirty} onClick={() => setRates(ws, draft)}>
					Save
				</Button>
			</Flex>
		</Box>
	);
};

export default TimePerAction;
