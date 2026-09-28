import React, { useEffect, useRef, useState } from "react";
import {
	Badge,
	Box,
	Button,
	Checkbox,
	Code,
	Divider,
	Flex,
	Input,
	Select,
	Switch,
	Text,
	VStack,
	useToast,
} from "@chakra-ui/react";
import { setBoxBoardSettings, resetBoxBoard, boxBoardCommand } from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import NumberField from "../../NumberField";
import { BASE_URL } from "../../Consts";
import { canonBoxBoard, MAX_BOARD_TOP } from "../../boxBoard";

const SEND_DEBOUNCE = 300;
const TOP_CHOICES = [3, 5, 10, 15, 20, 25];

// the box leaderboard: who has bought the most boxes off the shop, as an OBS source. buying one for yourself
// and putting one up for firesale both count, by quantity. everything applies immediately — no Save.
const BoxBoard: React.FC<{ ws: any; token: string | null; settings: any; products: any[] | null }> = ({ ws, token, settings, products }) => {
	const toast = useToast();

	const server = canonBoxBoard(settings.boxBoardSettings || {});
	const serverStr = JSON.stringify(server);
	const [draft, setDraft] = useState<any>(server);
	// between an edit and its sync the server's copy is older than the screen — same bargain as the other tabs
	const sentRef = useRef(serverStr);
	const pendingRef = useRef(0);
	const timers = useRef<{ [key: string]: any }>({});
	const [confirming, setConfirming] = useState(false);
	const [fixName, setFixName] = useState("");
	const [fixCount, setFixCount] = useState(1);

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

	// the reset button asks twice; the second press has to come within a few seconds
	useEffect(() => {
		if (!confirming)
			return;
		const id = setTimeout(() => setConfirming(false), 4000);
		return () => clearTimeout(id);
	}, [confirming]);

	const later = (key: string, fn: () => void, delay: number) => {
		clearTimeout(timers.current[key]);
		timers.current[key] = setTimeout(fn, delay);
	};

	const patch = (p: any, key?: string) => {
		const next = { ...draft, ...p };
		setDraft(next);
		sentRef.current = JSON.stringify(canonBoxBoard(next));
		pendingRef.current = Date.now();
		if (key)
			later(key, () => setBoxBoardSettings(ws, next), SEND_DEBOUNCE);
		else
			setBoxBoardSettings(ws, next);
	};

	const url = `${BASE_URL}/boxboard?token=${encodeURIComponent(token || "")}`;

	const copyUrl = () => {
		copyText(url).then((ok) =>
			toast(ok
				? { title: "Source URL copied", status: "success", duration: 1500 }
				: { title: "Couldn't copy — reveal the URL and copy it manually", status: "error", duration: 3000 }));
	};

	const picked = (id: string) => draft.products.some((p: any) => p.id === id);
	const toggleProduct = (p: any, on: boolean) =>
		patch({
			products: on
				? [...draft.products, { id: p.id, name: p.name }]
				: draft.products.filter((x: any) => x.id !== p.id),
		});

	// everybody with a box, ranked the way the source ranks them (a tie shares a place)
	const tally = settings.boxBoardTally && typeof settings.boxBoardTally === "object" ? settings.boxBoardTally : {};
	const rows = Object.keys(tally)
		.map((k) => ({ key: k, name: tally[k].name || k, count: Number(tally[k].count) || 0 }))
		.filter((r) => r.count > 0)
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	let place = 0;
	const ranked = rows.map((r, i) => {
		if (i === 0 || r.count !== rows[i - 1].count)
			place = i + 1;
		return { ...r, place };
	});
	const total = rows.reduce((n, r) => n + r.count, 0);

	const reset = () => {
		if (!confirming) {
			setConfirming(true);
			return;
		}
		setConfirming(false);
		resetBoxBoard(ws);
	};

	const fix = (action: "add" | "take" | "set") => {
		const name = fixName.trim().replace(/^@/, "");
		if (!name)
			return;
		boxBoardCommand(ws, action, name, fixCount);
		toast({ title: action === "set" ? `${name} set to ${fixCount}` : `${action === "add" ? "Added" : "Took"} ${fixCount} ${action === "add" ? "to" : "from"} ${name}`, status: "success", duration: 1500 });
	};

	// click a row to load it into the fix box below
	const pick = (r: any) => {
		setFixName(r.name);
		setFixCount(r.count);
	};

	const colorRow = (label: string, key: string) => (
		<Flex align="center" gap={2}>
			<Input type="color" w="42px" p={1} cursor="pointer" value={draft[key]} onChange={(e) => patch({ [key]: e.currentTarget.value }, key)} />
			<Text color="gray.500">{label}</Text>
		</Flex>
	);

	return (
		<Box maxW="900px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={2}>
				One OBS <b>Browser</b> source ranking who has bought the most boxes from your Fourthwall shop. Buying a box
				for yourself counts, and so does putting one up for firesale — both by how many were bought, so an order of
				4 is 4 boxes. Tick which products are boxes below. The standings carry on until you press <b>Reset</b>.
			</Text>
			<Text fontSize="sm" color="gray.600" mb={3}>
				Size the source to fit — around 500 wide and 60px a place is a good start at the default text size.
			</Text>

			<Flex align="center" gap={2} mb={4} wrap="wrap">
				<MaskedUrl url={url} p={2} fontSize="xs" flex="1" minW="140px" overflowX="auto" whiteSpace="nowrap" />
				<Button size="sm" onClick={copyUrl}>Copy</Button>
			</Flex>

			{/* ---- what counts ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Text fontWeight="bold" mb={2}>What counts</Text>
				<Flex align="center" gap={2} mb={1} fontSize="sm">
					<Switch isChecked={draft.countOrders} onChange={(e) => patch({ countOrders: e.target.checked })} />
					<Text>Boxes people buy for themselves</Text>
				</Flex>
				<Flex align="center" gap={2} fontSize="sm">
					<Switch isChecked={draft.countFiresales} onChange={(e) => patch({ countFiresales: e.target.checked })} />
					<Text>Boxes put up for firesale (credited to the gifter)</Text>
					{!draft.countFiresales && <Badge colorScheme="orange">off</Badge>}
				</Flex>
				<Text fontSize="xs" color="gray.500" mt={2}>
					A firesale is read off Fourthwall&apos;s giveaway announcement in chat, so it counts even with the Firesale
					overlay turned off. The winner claiming their box isn&apos;t counted — that one was bought by the gifter.
					If a firesale ever lands on the board twice for the same boxes, turn this off — the gifter&apos;s purchase
					is then counted from the order alone — and fix the extra with <b>Set to</b> below.
				</Text>
			</Box>

			{/* ---- the standings ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Standings</Text>
					<Badge>{rows.length} buyer{rows.length === 1 ? "" : "s"}</Badge>
					<Badge colorScheme="green">{total} box{total === 1 ? "" : "es"}</Badge>
					<Box flex="1" />
					<Button size="sm" colorScheme="red" variant={confirming ? "solid" : "outline"} isDisabled={!rows.length && !confirming} onClick={reset}>
						{confirming ? "Press again to reset" : "Reset leaderboard"}
					</Button>
				</Flex>
				{!rows.length && (
					<Text fontSize="sm" color="gray.500">Nobody yet — boxes bought from here on will show up as they happen.</Text>
				)}
				<VStack align="stretch" spacing={0} maxH="320px" overflowY="auto">
					{ranked.map((r, i) => (
						<Flex
							key={r.key}
							fontSize="sm"
							py={1}
							px={2}
							gap={3}
							borderRadius="sm"
							cursor="pointer"
							title="Click to change this count"
							_hover={{ bg: "blackAlpha.100" }}
							onClick={() => pick(r)}
							bg={i < draft.top ? "blackAlpha.50" : undefined}
							opacity={i < draft.top ? 1 : 0.6}
						>
							<Text w="36px" textAlign="right" fontWeight="bold" color={i < draft.top ? "gray.600" : "gray.400"}>
								#{r.place}
							</Text>
							<Text flex="1">{r.name}</Text>
							<Text fontWeight="bold">{r.count}</Text>
						</Flex>
					))}
				</VStack>
				{rows.length > draft.top && (
					<Text fontSize="xs" color="gray.500" mt={1}>Faded rows are below the top {draft.top}, so they aren&apos;t on the source.</Text>
				)}

				<Divider my={3} />
				<Text fontSize="sm" color="gray.600" mb={2}>
					Fix a count by hand — click someone above to load them, type the right number and hit <b>Set to</b>. Set
					0 to take them off the board. Add / Take away change it by that much instead, e.g. for a firesale that
					was missed. Same as <Code fontSize="xs">board set &lt;name&gt; &lt;n&gt;</Code> in the Terminal (quote a
					name with spaces).
				</Text>
				<Flex align="center" gap={2} wrap="wrap">
					<Input size="sm" w="200px" placeholder="name" value={fixName} onChange={(e) => setFixName(e.currentTarget.value)} />
					<NumberField value={fixCount} min={0} max={9999} onCommit={setFixCount} width="80px" />
					<Button size="sm" colorScheme="blue" isDisabled={!fixName.trim()} onClick={() => fix("set")}>Set to</Button>
					<Button size="sm" isDisabled={!fixName.trim() || !fixCount} onClick={() => fix("add")}>Add</Button>
					<Button size="sm" variant="outline" isDisabled={!fixName.trim() || !fixCount} onClick={() => fix("take")}>Take away</Button>
				</Flex>
			</Box>

			{/* ---- which products are boxes ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Flex align="center" gap={3} mb={2} wrap="wrap">
					<Text fontWeight="bold">Which products are boxes</Text>
					{draft.products.length === 0
						? <Badge colorScheme="orange">none picked — nothing counts yet</Badge>
						: <Badge colorScheme="green">{draft.products.length} picked</Badge>}
				</Flex>
				{products === null && <Text fontSize="xs" color="gray.500">Loading your Fourthwall products…</Text>}
				{products !== null && products.length === 0 && (
					<Text fontSize="xs" color="gray.500">No products loaded — connect Fourthwall on the Connections tab.</Text>
				)}
				<VStack align="stretch" spacing={1}>
					{(products || []).map((p: any) => (
						<Checkbox key={p.id} size="sm" isChecked={picked(p.id)} onChange={(e) => toggleProduct(p, e.target.checked)}>
							{p.name}
						</Checkbox>
					))}
					{/* picked earlier but no longer in the shop's list — kept, so a product coming back still counts */}
					{draft.products.filter((x: any) => !(products || []).some((p: any) => p.id === x.id)).map((x: any) => (
						<Checkbox key={x.id} size="sm" isChecked onChange={() => toggleProduct(x, false)}>
							{x.name || x.id} <Text as="span" color="gray.500">(not in the shop right now)</Text>
						</Checkbox>
					))}
				</VStack>

			</Box>

			{/* ---- the look ---- */}
			<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
				<Text fontWeight="bold" mb={2}>On stream</Text>
				<Flex align="center" gap={2} mb={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="90px">Show the top</Text>
					<Select size="sm" w="100px" value={draft.top} onChange={(e) => patch({ top: Number(e.currentTarget.value) })}>
						{TOP_CHOICES.filter((n) => n <= MAX_BOARD_TOP).map((n) => <option key={n} value={n}>{n}</option>)}
						{!TOP_CHOICES.includes(draft.top) && <option value={draft.top}>{draft.top}</option>}
					</Select>
				</Flex>
				<Flex align="center" gap={2} mb={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="90px">Title</Text>
					<Input size="sm" w="320px" maxLength={60} value={draft.title} placeholder="blank = no title" onChange={(e) => patch({ title: e.currentTarget.value }, "title")} />
				</Flex>
				<Flex align="center" gap={2} mb={2} wrap="wrap" fontSize="sm">
					<Text color="gray.500" w="90px">Text size</Text>
					<NumberField value={draft.fontSize} min={12} max={120} onCommit={(n) => patch({ fontSize: n }, "fontSize")} width="80px" />
					<Text color="gray.500">px</Text>
					<Box w={4} />
					<Switch isChecked={draft.showCounts} onChange={(e) => patch({ showCounts: e.target.checked })} />
					<Text>Show how many</Text>
				</Flex>
				<Flex align="center" gap={4} wrap="wrap" fontSize="sm">
					{colorRow("title", "titleColor")}
					{colorRow("names", "nameColor")}
					{colorRow("counts", "countColor")}
					<Flex align="center" gap={2}>
						<Input
							type="color"
							w="42px"
							p={1}
							cursor="pointer"
							opacity={draft.bgColor === "transparent" ? 0.4 : 1}
							value={draft.bgColor === "transparent" ? "#000000" : draft.bgColor}
							onChange={(e) => patch({ bgColor: e.currentTarget.value }, "bgColor")}
						/>
						<Text color="gray.500">fill</Text>
						<Button size="xs" isDisabled={draft.bgColor === "transparent"} onClick={() => patch({ bgColor: "transparent" })}>
							transparent
						</Button>
					</Flex>
				</Flex>
				<Text fontSize="xs" color="gray.500" mt={2}>
					The top three places are gold, silver and bronze. A tie shares a place.
				</Text>
			</Box>
		</Box>
	);
};

export default BoxBoard;
