import React from "react";
import { Button, Divider, Text, VStack, useToast } from "@chakra-ui/react";
import { setCap, setAnon } from "../../Api";

const Controls: React.FC<{ ws: any; token: string | null; baseUrl: string; settings: any }> = ({
	ws,
	token,
	baseUrl,
	settings,
}) => {
	const toast = useToast();
	const cap = !!settings.cap;
	const anon = !!settings.anon;
	return (
		<VStack align="stretch" spacing={3} maxW="420px" mx="auto">
			<Text color="gray.500" fontSize="sm">
				These apply immediately — no Save.
			</Text>
			<Button
				colorScheme="purple"
				onClick={() => {
					navigator.clipboard.writeText(`${baseUrl}/widget?token=${token}`);
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
			<Text fontSize="xs" color="gray.400">
				cap / anon hit the server instantly; the 30h cap even re-clamps the timer on toggle.
			</Text>
		</VStack>
	);
};

export default Controls;
