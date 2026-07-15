import React, { useRef, useState } from "react";
import { Button, Code, Divider, HStack, Input, Text, VStack, useToast } from "@chakra-ui/react";
import { setCap, setAnon, setWidgetSettings } from "../../Api";

const Controls: React.FC<{ ws: any; token: string | null; settings: any }> = ({
	ws,
	token,
	settings,
}) => {
	const toast = useToast();
	const cap = !!settings.cap;
	const anon = !!settings.anon;

	// widget background color: local echo while dragging the picker, debounced send (the color input
	// fires continuously and the ws rate-limits per connection)
	const [bgLocal, setBgLocal] = useState<string | null>(null);
	const bgTimer = useRef<any>(null);
	const bgColor = bgLocal ?? ((settings.widgetSettings && settings.widgetSettings.bgColor) || "#00FF00");
	const changeBg = (v: string) => {
		setBgLocal(v);
		clearTimeout(bgTimer.current);
		bgTimer.current = setTimeout(() => setWidgetSettings(ws, { bgColor: v }), 300);
	};

	return (
		<VStack align="stretch" spacing={3} maxW="420px" mx="auto">
			<Text color="gray.500" fontSize="sm">
				These apply immediately — no Save.
			</Text>
			<Button
				colorScheme="purple"
				onClick={() => {
					navigator.clipboard.writeText(`${window.location.origin}/widget?token=${token}`);
					toast({ title: "Widget URL copied", status: "success", duration: 1500 });
				}}
			>
				Copy widget URL
			</Button>
			<Button colorScheme={cap ? "orange" : "purple"} onClick={() => setCap(ws, !cap)}>
				{cap ? "Disable 30h cap" : "Enable 30h cap"}
			</Button>
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
			<Divider />
			<Text fontSize="xs" color="gray.400">
				cap / anon hit the server instantly; the 30h cap even re-clamps the timer on toggle.
			</Text>
		</VStack>
	);
};

export default Controls;
