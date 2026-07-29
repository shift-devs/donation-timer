import React, { useRef, useState } from "react";
import { Box, Button, Code, Divider, Flex, HStack, Input, NumberInput, NumberInputField, Select, Switch, Text, VStack, useToast } from "@chakra-ui/react";
import { setCapSeconds, setAnon, setStopAtZero, setWidgetSettings } from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import { timerTextStyle, renderTimerText, TIMER_FONTS } from "../../Timer";
import { parseSourceUrl, hexParam, oneOfParam, intParam } from "../../wizardUrl";
import { BASE_URL } from "../../Consts";

const Controls: React.FC<{ ws: any; token: string | null; settings: any }> = ({
	ws,
	token,
	settings,
}) => {
	const toast = useToast();
	const anon = !!settings.anon;
	const stopAtZero = !!settings.stopAtZero;

	// custom time cap, entered in hours (0 = no cap). local echo while editing, applied on blur/Enter —
	// the value follows the server otherwise (same idea as the bg picker below).
	const capSeconds = Math.max(0, Math.trunc(Number(settings.capSeconds) || 0));
	const [capInput, setCapInput] = useState<string | null>(null);
	const capValue = capInput ?? (capSeconds ? String(capSeconds / 3600) : "");
	const applyCap = () => {
		const hours = Number(capValue);
		setCapSeconds(ws, Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600) : 0);
		setCapInput(null); // follow the server value again
	};

	// widget background color: local echo while dragging the picker, debounced send (the color input
	// fires continuously and the ws rate-limits per connection). the backend merges what it receives, so
	// pushing one field on its own leaves the rest alone.
	const [bgLocal, setBgLocal] = useState<string | null>(null);
	const bgTimer = useRef<any>(null);
	const bgColor = bgLocal ?? ((settings.widgetSettings && settings.widgetSettings.bgColor) || "#00FF00");
	const align = (settings.widgetSettings && settings.widgetSettings.align) || "left";
	const changeBg = (v: string) => {
		setBgLocal(v);
		clearTimeout(bgTimer.current);
		bgTimer.current = setTimeout(() => setWidgetSettings(ws, { bgColor: v }), 300);
	};
	const changeAlign = (v: string) => setWidgetSettings(ws, { align: v });

	// widget browser-source builder: pick a look, check the preview, copy a /widget url that carries it.
	// everything lives in the url (no saved state) like the progress-bar wizards, so one shop can run
	// several timer sources with different looks. seeded from the live settings above so it opens showing
	// the current one.
	const [wizBg, setWizBg] = useState<string | null>(null);
	const [wizAlign, setWizAlign] = useState<string | null>(null);
	const [wizFont, setWizFont] = useState("display");
	const [wizEffect, setWizEffect] = useState("none");
	const [wizEffectColor, setWizEffectColor] = useState("#000000");
	const [wizEffectW, setWizEffectW] = useState(4);
	const builderBg = wizBg ?? bgColor;
	const builderAlign = wizAlign ?? align;
	const builderTransparent = builderBg === "transparent";
	// a colour input can't show "transparent", so it keeps displaying the last hex while transparency is on;
	// picking a colour from it is what turns transparency back off
	const [wizBgHex, setWizBgHex] = useState("#00FF00");
	const pickBg = (v: string) => {
		setWizBg(v);
		if (v !== "transparent")
			setWizBgHex(v);
	};
	// paste a /widget url back in to keep editing it
	const [wizPaste, setWizPaste] = useState("");
	const loadFromUrl = () => {
		const sp = parseSourceUrl(wizPaste, "/widget");
		if (!sp) {
			toast({ title: "That doesn't look like a widget URL", status: "error", duration: 3000 });
			return;
		}
		const bg = hexParam(sp, "bg", builderBg, "transparent");
		setWizBg(bg);
		if (bg !== "transparent")
			setWizBgHex(bg);
		setWizAlign(oneOfParam(sp, "align", ["left", "center", "right"], builderAlign));
		setWizFont(oneOfParam(sp, "font", Object.keys(TIMER_FONTS), wizFont));
		// no effect in the url means the source draws none, so read absence as "none" rather than keeping
		// whatever the wizard happened to be showing
		const effect = oneOfParam(sp, "effect", ["stroke", "shadow"], "none");
		setWizEffect(effect);
		if (effect !== "none") {
			setWizEffectColor(hexParam(sp, "effectColor", wizEffectColor));
			setWizEffectW(intParam(sp, "effectWidth", 0, 20, wizEffectW));
		}
		setWizPaste("");
		toast({ title: "Loaded — edit and copy the new URL", status: "success", duration: 2000 });
	};

	// so the preview reads as "nothing behind it" instead of looking like the dashboard's own background
	const checker: React.CSSProperties = {
		backgroundColor: "#2b2b2b",
		backgroundImage:
			"linear-gradient(45deg,#3d3d3d 25%,transparent 25%,transparent 75%,#3d3d3d 75%)," +
			"linear-gradient(45deg,#3d3d3d 25%,transparent 25%,transparent 75%,#3d3d3d 75%)",
		backgroundSize: "18px 18px",
		backgroundPosition: "0 0, 9px 9px",
	};

	const copyUrl = (url: string, what: string) => {
		copyText(url).then((ok) =>
			toast(ok
				? { title: `${what} URL copied`, status: "success", duration: 1500 }
				: { title: "Couldn't copy — select the URL manually", status: "error", duration: 3000 }));
	};

	return (
		<Box maxW="700px" mx="auto">
		<VStack align="stretch" spacing={3} maxW="420px" mx="auto">
			<Text color="gray.500" fontSize="sm">
				These apply immediately — no Save.
			</Text>
			<HStack justify="space-between">
				<Text>Time cap (hours)</Text>
				<HStack>
					<Input
						type="number"
						min={0}
						step={1}
						w="90px"
						value={capValue}
						placeholder="0"
						onChange={(e) => setCapInput(e.currentTarget.value)}
						onBlur={applyCap}
						onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
					/>
					<Text fontSize="sm" color="gray.500" w="70px">
						{capSeconds ? "hrs max" : "no cap"}
					</Text>
				</HStack>
			</HStack>
			<Text fontSize="xs" color="gray.400">
				Maximum timer length. New time is clamped to this, and changing it re-clamps the running timer
				immediately. Leave 0 (blank) for no cap.
			</Text>
			<HStack justify="space-between">
				<Text>Stop at zero</Text>
				<Switch isChecked={stopAtZero} onChange={(e) => setStopAtZero(ws, e.target.checked)} />
			</HStack>
			<Text fontSize="xs" color="gray.400">
				When the timer runs out it stays out — subs, donations and purchases after that add nothing, and
				the Terminal says so when one is ignored. Set a time by hand to start it again. Off means the next
				event revives the timer from 0.
			</Text>
			<Button colorScheme={anon ? "orange" : "purple"} onClick={() => setAnon(ws, !anon)}>
				{anon ? "Unignore Anonymous Giftsubs" : "Ignore Anonymous Giftsubs"}
			</Button>
			<Divider />
			<HStack justify="space-between">
				<Text>Widget background</Text>
				<HStack>
					<Input
						type="color"
						value={bgColor}
						onChange={(e) => changeBg(e.currentTarget.value)}
						w="52px"
						p={1}
						cursor="pointer"
					/>
					<Code>{bgColor}</Code>
					<Button size="xs" onClick={() => changeBg("#00FF00")} isDisabled={bgColor.toUpperCase() === "#00FF00"}>
						chroma green
					</Button>
				</HStack>
			</HStack>
			<Text fontSize="xs" color="gray.400">
				Fills the /widget page behind the timer — keep a color OBS can key out, or match your overlay.
				Open widgets update live.
			</Text>
			<HStack justify="space-between">
				<Text>Timer alignment</Text>
				<Select size="sm" w="120px" value={align} onChange={(e) => changeAlign(e.currentTarget.value)}>
					<option value="left">Left</option>
					<option value="center">Center</option>
					<option value="right">Right</option>
				</Select>
			</HStack>
			<Text fontSize="xs" color="gray.400">
				Justifies the digits on the /widget browser source. The timer at the top of this page stays
				centered. Open widgets update live.
			</Text>
			<Divider />
			<Text fontSize="xs" color="gray.400">
				These hit the server instantly — no Save.
			</Text>
		</VStack>

		<Box mt={6} p={4} borderRadius="md" bg="whiteAlpha.100" fontSize="sm" textAlign="left">
			<Text fontWeight="bold" mb={2}>Timer widget — OBS browser source</Text>
			<Text color="gray.400" mb={3}>
				Set the look below, check the preview, then copy the URL into an OBS browser source. The look is
				baked into the URL, so you can run several timer sources with different looks — and it overrides
				the live settings above for that source. A URL with no look in it (anything copied before this
				builder existed) keeps following those live settings.
			</Text>
			<Flex align="center" gap={2} mb={2} wrap="wrap">
				<Text w="76px" flexShrink={0}>Background</Text>
				<Input
					type="color"
					w="42px"
					p={1}
					cursor="pointer"
					value={builderTransparent ? wizBgHex : builderBg}
					opacity={builderTransparent ? 0.4 : 1}
					onChange={(e) => pickBg(e.currentTarget.value)}
				/>
				<Code>{builderBg}</Code>
				<Button size="xs" onClick={() => pickBg("transparent")} isDisabled={builderTransparent}>
					transparent
				</Button>
				<Button size="xs" onClick={() => pickBg("#00FF00")} isDisabled={builderBg.toUpperCase() === "#00FF00"}>
					chroma green
				</Button>
			</Flex>
			<Flex align="center" gap={2} mb={2} wrap="wrap">
				<Text w="76px" flexShrink={0}>Alignment</Text>
				<Select size="sm" w="120px" value={builderAlign} onChange={(e) => setWizAlign(e.currentTarget.value)}>
					<option value="left">Left</option>
					<option value="center">Center</option>
					<option value="right">Right</option>
				</Select>
			</Flex>
			<Flex align="center" gap={2} mb={2} wrap="wrap">
				<Text w="76px" flexShrink={0}>Font</Text>
				<Select size="sm" w="220px" value={wizFont} onChange={(e) => setWizFont(e.currentTarget.value)}>
					{Object.entries(TIMER_FONTS).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
				</Select>
			</Flex>
			<Flex align="center" gap={2} mb={2} wrap="wrap">
				<Text w="76px" flexShrink={0}>Effect</Text>
				<Select size="sm" w="130px" value={wizEffect} onChange={(e) => setWizEffect(e.currentTarget.value)}>
					<option value="none">None</option>
					<option value="stroke">Stroke</option>
					<option value="shadow">Drop shadow</option>
				</Select>
			</Flex>
			{wizEffect !== "none" && (
				<Flex align="center" gap={2} mb={3} wrap="wrap">
					<Text w="76px" flexShrink={0} />
					<Input type="color" w="42px" p={1} cursor="pointer" value={wizEffectColor} onChange={(e) => setWizEffectColor(e.currentTarget.value)} />
					<Code>{wizEffectColor}</Code>
					<NumberInput size="sm" maxW="90px" min={0} max={20} value={wizEffectW} onChange={(_, n) => setWizEffectW(Number.isFinite(n) ? Math.min(20, Math.max(0, Math.trunc(n))) : 0)}>
						<NumberInputField />
					</NumberInput>
					<Text color="gray.400">
						{wizEffectW <= 0 ? "px — off" : wizEffect === "stroke" ? "px outline" : "px blur"}
					</Text>
				</Flex>
			)}
			{(() => {
				const p = new URLSearchParams({ token: token || "", bg: builderBg, align: builderAlign, font: wizFont });
				if (wizEffect !== "none" && wizEffectW > 0) {
					p.set("effect", wizEffect);
					p.set("effectColor", wizEffectColor);
					p.set("effectWidth", String(wizEffectW));
				}
				const widgetUrl = `${BASE_URL}/widget?${p.toString()}`;
				return (
					<>
						<Text fontSize="xs" color="gray.500" mb={1}>Preview (a sample time, at a fraction of the real size):</Text>
						<Box borderRadius="md" mb={3} overflow="hidden" style={builderTransparent ? checker : undefined}>
							<div style={timerTextStyle({
								background: builderBg,
								textAlign: builderAlign,
								fontSize: "56px",
								font: wizFont,
								effect: wizEffect,
								effectColor: wizEffectColor,
								effectWidth: wizEffectW,
							})}>
								{renderTimerText("1:23:45", wizFont)}
							</div>
						</Box>
						<HStack spacing={2}>
							<MaskedUrl url={widgetUrl} p={2} fontSize="xs" flex="1" overflowX="auto" whiteSpace="nowrap" />
							<Button size="xs" onClick={() => copyUrl(widgetUrl, "Widget")}>Copy</Button>
						</HStack>
						<HStack spacing={2} mt={2}>
							<Input
								size="xs"
								placeholder="…or paste an existing widget URL to edit it"
								value={wizPaste}
								onChange={(e) => setWizPaste(e.currentTarget.value)}
								onKeyDown={(e) => { if (e.key === "Enter") loadFromUrl(); }}
							/>
							<Button size="xs" isDisabled={!wizPaste.trim()} onClick={loadFromUrl}>Load</Button>
						</HStack>
						<Text color="gray.400" mt={3}>
							A stroke outlines the digits — drawn behind them, so a wide one thickens the digits
							instead of eating into them. A drop shadow is centred on them, blurred out to
							the width. Either is off at width 0. The monospaced font keeps every digit the same width,
							so the timer doesn&apos;t jitter as the numbers tick down. A transparent background
							needs no Color Key filter — OBS composites the timer straight over your scene (the
							checkerboard above just marks where it&apos;s see-through).
						</Text>
					</>
				);
			})()}
		</Box>
		</Box>
	);
};

export default Controls;
