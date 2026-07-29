import React, { useRef, useState } from "react";
import { Button, Code, Divider, HStack, Input, Select, Switch, Text, VStack, useToast } from "@chakra-ui/react";
import { setCapSeconds, setAnon, setStopAtZero, setWidgetSettings } from "../../Api";
import { copyText } from "../../copy";
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

	return (
		<VStack align="stretch" spacing={3} maxW="420px" mx="auto">
			<Text color="gray.500" fontSize="sm">
				These apply immediately — no Save.
			</Text>
			<Button
				colorScheme="purple"
				onClick={() => {
					copyText(`${BASE_URL}/widget?token=${token}`).then((ok) =>
						toast(ok
							? { title: "Widget URL copied", status: "success", duration: 1500 }
							: { title: "Couldn't copy — select the URL manually", status: "error", duration: 3000 }));
				}}
			>
				Copy widget URL
			</Button>
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
	);
};

export default Controls;
