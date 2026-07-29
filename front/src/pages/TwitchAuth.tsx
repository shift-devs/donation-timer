import React, { useEffect, useRef, useState } from "react";
import { Button, Code, Heading, Spinner, Text, VStack } from "@chakra-ui/react";
import * as consts from "../Consts";

// where twitch sends the broadcaster back after they approve the active-sub read. the one-shot code lands in
// the query string; we hand it to the backend over the normal socket, which swaps it for the refresh token it
// keeps (the client secret never reaches the browser). the redirect uri itself isn't sent from here — the
// backend reuses the exact string it built the authorize link with, which is what twitch compares against.
export const REDIRECT_PATH = "/twitchauth";

const WS_URL = consts.WS_URL;

const TwitchAuth: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const code = params.get("code") || "";
	const denied = params.get("error") || "";
	const deniedDetail = params.get("error_description") || "";
	const token = localStorage.getItem("identity");

	const [state, setState] = useState<"working" | "ok" | "failed">("working");
	const [message, setMessage] = useState("Finishing up with Twitch…");
	const sentRef = useRef(false); // the socket can reconnect; the code is single-use, so only ever send it once

	useEffect(() => {
		if (denied) {
			setState("failed");
			setMessage(deniedDetail || "You declined the Twitch authorization.");
			return;
		}
		if (!token) {
			setState("failed");
			setMessage("This browser isn't signed in to the dashboard — open the dashboard first, then try again.");
			return;
		}
		if (!code) {
			setState("failed");
			setMessage("Twitch didn't send a code back.");
			return;
		}

		const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}&page=settings`);

		ws.onopen = () => {
			if (sentRef.current) return;
			sentRef.current = true;
			ws.send(JSON.stringify({ event: "twitchSubsCode", code }));
		};
		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			if (response.twitchSubsAuth) {
				setState(response.twitchSubsAuth.ok ? "ok" : "failed");
				setMessage(response.twitchSubsAuth.message || (response.twitchSubsAuth.ok ? "Connected." : "Authorization failed."));
				try { ws.close(); } catch {}
			} else if (response.success === false && response.error) {
				setState("failed");
				setMessage(response.error);
				try { ws.close(); } catch {}
			}
		};
		ws.onerror = () => {
			setState("failed");
			setMessage("Couldn't reach the timer backend.");
		};

		return () => {
			ws.onopen = ws.onmessage = ws.onerror = null;
			try { ws.close(); } catch {}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<VStack minH="100vh" justify="center" spacing={4} px={6} textAlign="center">
			<Heading size="lg">Twitch — active subs</Heading>
			{state === "working" && <Spinner />}
			<Text color={state === "failed" ? "red.300" : state === "ok" ? "green.300" : undefined} maxW="520px">
				{message}
			</Text>
			{state === "failed" && (
				<Text fontSize="sm" color="gray.400" maxW="520px">
					Check that the redirect URL on your Twitch app matches the one shown on the Connections tab
					exactly, then start the authorization again from there.
				</Text>
			)}
			<Button colorScheme="purple" onClick={() => { window.location.href = "/"; }}>
				Back to the dashboard
			</Button>
		</VStack>
	);
};

export default TwitchAuth;
