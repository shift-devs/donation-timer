import React, { useEffect, useState } from "react";
import * as consts from "../Consts";
import { TRANSPARENT_BODY_CSS } from "../textEffect";
import { canonTextBox, textBoxStyle } from "../textBox";

// one OBS browser source showing one text box: /text?token=…&box=<id>. Mods change what it says from chat with
// "!changetext <box name> <text>" and the words arrive on the next sync (which the server pushes the moment the
// command lands, so it's live). The box's look comes from the dashboard too, so an operator can restyle a source
// that's already in a scene without touching OBS.
//
// The server resolves ?box= and sends back only that one box, so an unknown id (or a deleted box) simply draws
// nothing — a blank source is the right failure on stream, where an error message would be worse than silence.
// Mirrors SubCount.tsx's connect/reconnect lifecycle.

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

const TextBox: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	const boxId = params.get("box") || "";

	const [box, setBox] = useState<any | null>(null);

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=text&box=${encodeURIComponent(boxId)}`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			if ("textBox" in response) {
				setBox(response.textBox ? canonTextBox(response.textBox) : null);
			} else if ("error" in response) {
				console.log(`error: ${response.error}`);
			}
		};

		ws.onclose = (event) => {
			console.log(`socket closed, attempting reconnect in 5 seconds... (${event.reason})`);
			clearTimeout(reconnectTimer);
			reconnectTimer = setTimeout(connectWs, 5000);
		};

		ws.onerror = (event) => {
			console.error(`socket encountered error: ${event} - closing socket`);
			ws.close();
		};
	};

	useEffect(() => {
		connectWs();
		return () => {
			clearTimeout(reconnectTimer);
			if (ws) {
				ws.onclose = ws.onmessage = ws.onerror = null;
				ws.close();
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// nothing to show yet (still connecting, or the box is gone): paint nothing at all rather than an empty
	// coloured rectangle, so a source that lost its box doesn't leave a slab sitting in the scene
	if (!box)
		return <style>{TRANSPARENT_BODY_CSS}</style>;

	return (
		<div style={{ position: "fixed", inset: 0, margin: 0, ...textBoxStyle(box) }}>
			<style>{TRANSPARENT_BODY_CSS}</style>
			<div>{box.text}</div>
		</div>
	);
};

export default TextBox;
