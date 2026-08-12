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
	Textarea,
	VStack,
	useToast,
} from "@chakra-ui/react";
import { setTextBoxes, setTextBoxText } from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import { BASE_URL } from "../../Consts";
import { canonTextBox, textBoxStyle, TEXT_FONTS, MAX_TEXT, MAX_FONT_SIZE, MAX_EFFECT_WIDTH } from "../../textBox";

const uid = () =>
	(typeof crypto !== "undefined" && (crypto as any).randomUUID)
		? (crypto as any).randomUUID()
		: `b${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const SEND_DEBOUNCE = 300; // colour pickers and typing fire continuously; the socket rate-limits per connection
const PREVIEW_FONT = 30;   // the preview is a fraction of the real size, so it fits in the row

// A text box is one OBS browser source whose words mods can change from chat. Everything here applies
// immediately — no Save — because the point of the feature is that a change reaches the stream at once.
//
// The words and the look travel separately: the look is this tab's config (setTextBoxes), the words are live
// state (setTextBoxText, the same path !changetext takes). That split is what stops an operator restyling a box
// from putting back the text a mod replaced a moment ago.
const TextBoxes: React.FC<{ ws: any; token: string | null; settings: any }> = ({ ws, token, settings }) => {
	const toast = useToast();

	const server = Array.isArray(settings.textBoxes) ? settings.textBoxes.map(canonTextBox) : [];
	const serverStr = JSON.stringify(server);
	const [draft, setDraft] = useState<any[]>(server);
	// what we last pushed, and when. between an edit and its sync the server's copy is OLDER than the screen, so
	// following it would undo keystrokes; after it lands the two agree again and we go back to following it (a
	// mod's !changetext, or a second dashboard, has to be able to move things under us). the timeout is the
	// escape hatch for a push that never landed — better to snap back to the truth than sit on a lie.
	const sentRef = useRef(serverStr);
	const pendingRef = useRef(0);
	const timers = useRef<{ [key: string]: any }>({});

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

	// mark the screen as ahead of the server, then push (now, or coalesced for the controls that fire per pixel)
	const push = (next: any[], key?: string) => {
		setDraft(next);
		sentRef.current = JSON.stringify(next);
		pendingRef.current = Date.now();
		if (key)
			later(key, () => setTextBoxes(ws, next), SEND_DEBOUNCE);
		else
			setTextBoxes(ws, next);
	};

	const patch = (id: string, p: any, key?: string) =>
		push(draft.map((b) => (b.id === id ? { ...b, ...p } : b)), key ? `${id}:${key}` : undefined);

	// the words go their own way — the array push above deliberately doesn't carry them
	const changeText = (id: string, text: string) => {
		const next = draft.map((b) => (b.id === id ? { ...b, text } : b));
		setDraft(next);
		sentRef.current = JSON.stringify(next);
		pendingRef.current = Date.now();
		later(`${id}:text`, () => setTextBoxText(ws, id, text), SEND_DEBOUNCE);
	};

	const addBox = () => push([...draft, canonTextBox({ id: uid(), name: `Text ${draft.length + 1}` })]);
	const removeBox = (id: string) => push(draft.filter((b) => b.id !== id));

	// the id is what a source url carries, so renaming a box never invalidates the URL already in OBS
	const boxUrl = (id: string) =>
		`${BASE_URL}/text?token=${encodeURIComponent(token || "")}&box=${encodeURIComponent(id)}`;

	const copyUrl = (id: string) => {
		copyText(boxUrl(id)).then((ok) =>
			toast(ok
				? { title: "Source URL copied", status: "success", duration: 1500 }
				: { title: "Couldn't copy — reveal the URL and copy it manually", status: "error", duration: 3000 }));
	};

	// a mod's !changetext matches on name and takes the first one, so a repeated name leaves a box unreachable
	const dupeNames = new Set(
		draft
			.map((b) => b.name.trim().toLowerCase())
			.filter((n, i, all) => n && all.indexOf(n) !== i)
	);

	// so a transparent fill reads as "nothing behind it" rather than as the dashboard's own background
	const checker: React.CSSProperties = {
		backgroundColor: "#2b2b2b",
		backgroundImage:
			"linear-gradient(45deg,#3d3d3d 25%,transparent 25%,transparent 75%,#3d3d3d 75%)," +
			"linear-gradient(45deg,#3d3d3d 25%,transparent 25%,transparent 75%,#3d3d3d 75%)",
		backgroundSize: "18px 18px",
		backgroundPosition: "0 0, 9px 9px",
	};

	return (
		<Box maxW="900px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={2}>
				Each text box is its own OBS <b>Browser</b> source showing one line (or several) of text. Mods change
				what it says from chat:
			</Text>
			<Code display="block" p={2} mb={2} fontSize="sm">
				!changetext {draft.length ? draft[0].name || "boxname" : "boxname"} "TEXT HERE"
			</Code>
			<Text fontSize="sm" color="gray.600" mb={4}>
				Only mods and the broadcaster are obeyed, the quotes are optional (everything after the name is the
				text), and <Code fontSize="xs">!changetext {draft.length ? draft[0].name || "boxname" : "boxname"}</Code>{" "}
				with nothing after it clears the box. The same command works in the Terminal tab, and every change a
				mod makes shows up there. Everything on this tab applies immediately — no Save.
			</Text>

			{draft.length === 0 && (
				<Text fontSize="sm" color="gray.500" mb={3}>
					No text boxes yet. Add one, name it something short and easy to type in chat, then put its URL in
					OBS as a browser source.
				</Text>
			)}

			<VStack align="stretch" spacing={4}>
				{draft.map((b) => (
					<Box key={b.id} borderWidth="1px" borderRadius="md" p={3}>
						<Flex align="center" gap={2} mb={2} wrap="wrap">
							<Text fontSize="sm" color="gray.500" flexShrink={0}>Name</Text>
							<Input
								size="sm"
								w="170px"
								value={b.name}
								placeholder="box name"
								onChange={(e) => patch(b.id, { name: e.currentTarget.value }, "name")}
							/>
							{dupeNames.has(b.name.trim().toLowerCase()) && (
								<Badge colorScheme="orange">duplicate name</Badge>
							)}
							<MaskedUrl url={boxUrl(b.id)} p={2} fontSize="xs" flex="1" minW="140px" overflowX="auto" whiteSpace="nowrap" />
							<Button size="sm" onClick={() => copyUrl(b.id)}>Copy</Button>
							<Button size="sm" variant="ghost" colorScheme="red" onClick={() => removeBox(b.id)}>Delete</Button>
						</Flex>

						<Flex align="flex-start" gap={2} mb={2}>
							<Textarea
								size="sm"
								rows={2}
								maxLength={MAX_TEXT}
								value={b.text}
								placeholder="what this box says on stream — type here, or let a mod set it from chat"
								onChange={(e) => changeText(b.id, e.currentTarget.value)}
							/>
							<Button size="sm" isDisabled={!b.text} onClick={() => changeText(b.id, "")}>Clear</Button>
						</Flex>

						<Flex align="center" gap={2} mb={2} wrap="wrap" fontSize="sm">
							<Select size="sm" w="200px" value={b.font} onChange={(e) => patch(b.id, { font: e.currentTarget.value })}>
								{Object.entries(TEXT_FONTS).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
							</Select>
							<NumberInput
								size="sm"
								maxW="90px"
								min={8}
								max={MAX_FONT_SIZE}
								value={b.fontSize}
								onChange={(_, n) => patch(b.id, { fontSize: Number.isFinite(n) ? Math.min(MAX_FONT_SIZE, Math.max(8, Math.trunc(n))) : 64 }, "fontSize")}
							>
								<NumberInputField />
							</NumberInput>
							<Text color="gray.500">px</Text>
							<Input type="color" w="42px" p={1} cursor="pointer" value={b.color} onChange={(e) => patch(b.id, { color: e.currentTarget.value }, "color")} />
							<Text color="gray.500">text</Text>
							<Input
								type="color"
								w="42px"
								p={1}
								cursor="pointer"
								opacity={b.bgColor === "transparent" ? 0.4 : 1}
								value={b.bgColor === "transparent" ? "#00ff00" : b.bgColor}
								onChange={(e) => patch(b.id, { bgColor: e.currentTarget.value }, "bgColor")}
							/>
							<Text color="gray.500">fill</Text>
							<Button size="xs" isDisabled={b.bgColor === "transparent"} onClick={() => patch(b.id, { bgColor: "transparent" })}>
								transparent
							</Button>
						</Flex>

						<Flex align="center" gap={2} mb={2} wrap="wrap" fontSize="sm">
							<Select size="sm" w="110px" value={b.align} onChange={(e) => patch(b.id, { align: e.currentTarget.value })}>
								<option value="left">Left</option>
								<option value="center">Center</option>
								<option value="right">Right</option>
							</Select>
							<Select size="sm" w="110px" value={b.valign} onChange={(e) => patch(b.id, { valign: e.currentTarget.value })}>
								<option value="top">Top</option>
								<option value="middle">Middle</option>
								<option value="bottom">Bottom</option>
							</Select>
							<Text color="gray.500">Bold</Text>
							<Switch isChecked={b.bold} onChange={(e) => patch(b.id, { bold: e.target.checked })} />
							<Select size="sm" w="130px" value={b.effect} onChange={(e) => patch(b.id, { effect: e.currentTarget.value })}>
								<option value="none">No effect</option>
								<option value="stroke">Stroke</option>
								<option value="shadow">Drop shadow</option>
							</Select>
							{b.effect !== "none" && (
								<>
									<Input type="color" w="42px" p={1} cursor="pointer" value={b.effectColor} onChange={(e) => patch(b.id, { effectColor: e.currentTarget.value }, "effectColor")} />
									<NumberInput
										size="sm"
										maxW="90px"
										min={0}
										max={MAX_EFFECT_WIDTH}
										value={b.effectWidth}
										onChange={(_, n) => patch(b.id, { effectWidth: Number.isFinite(n) ? Math.min(MAX_EFFECT_WIDTH, Math.max(0, Math.trunc(n))) : 0 }, "effectWidth")}
									>
										<NumberInputField />
									</NumberInput>
									<Text color="gray.500">
										{b.effectWidth <= 0 ? "px — off" : b.effect === "stroke" ? "px outline" : "px blur"}
									</Text>
								</>
							)}
						</Flex>

						<Text fontSize="xs" color="gray.500" mb={1}>Preview (at a fraction of the real size):</Text>
						<Box borderRadius="md" overflow="hidden" style={b.bgColor === "transparent" ? checker : undefined}>
							<Box height="90px" style={textBoxStyle(b, PREVIEW_FONT)}>
								<div>{b.text || " "}</div>
							</Box>
						</Box>
					</Box>
				))}
			</VStack>

			<HStack mt={4} mb={2}>
				<Button size="sm" onClick={addBox}>+ Add text box</Button>
				<Text fontSize="xs" color="gray.500">
					Each one needs its own browser source in OBS.
				</Text>
			</HStack>

			<Divider my={4} />

			<Text fontSize="xs" color="gray.500">
				Size the OBS source to the area the text should sit in — the page fills it, and the alignment
				dropdowns place the words inside it. A <b>transparent</b> fill needs no Color Key filter: OBS
				composites the text straight over your scene (the checkerboard above just marks where it&apos;s
				see-through). Pick a colour instead if you want a solid panel behind the words, or something to key
				out. Long text wraps rather than running off the source.
				<br />
				Renaming a box changes what mods type; the URL keeps working, so nothing needs re-doing in OBS.
				Deleting one blanks its source. The words survive a restart — whatever a box last said is what it
				says when the timer comes back up.
			</Text>
		</Box>
	);
};

export default TextBoxes;
