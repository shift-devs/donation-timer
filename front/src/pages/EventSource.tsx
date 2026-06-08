import React, { useEffect, useRef, useState } from "react";
import * as consts from "../Consts";

// the OBS browser source for timer events. add this page as a Browser Source; the backend pushes {playEvent} messages
// (scheduled or via the dashboard Test button) and we play the clip here. transparent background so video overlays
// the scene. mirrors Widget.tsx's connect/reconnect lifecycle.

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

interface PlayItem {
	id: string;
	name: string;
	kind: "audio" | "video";
	src: string;
	volume: number;
	// monotonically increasing so the same clip fired twice still remounts and replays
	nonce: number;
}

const EventSource: React.FC = () => {
	const token = new URLSearchParams(window.location.search).get("token");
	const [item, setItem] = useState<PlayItem | null>(null);
	const nonceRef = useRef(0);

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=events`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			// this page only cares about play commands; the settings sync payload is ignored
			if ("playEvent" in response && response.playEvent && response.playEvent.src) {
				const p = response.playEvent;
				nonceRef.current += 1;
				setItem({
					id: p.id,
					name: p.name,
					kind: p.kind === "video" ? "video" : "audio",
					src: p.src,
					volume: typeof p.volume === "number" ? p.volume : 1,
					nonce: nonceRef.current,
				});
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

	// transparent, full-viewport, no scrollbars — OBS composites this over the scene
	const wrap: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		margin: 0,
		background: "transparent",
		overflow: "hidden",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	};

	if (!token)
		return <div style={wrap} />;

	const clear = () => setItem(null);

	return (
		<div style={wrap}>
			{item && item.kind === "video" && (
				<video
					key={item.nonce}
					src={item.src}
					autoPlay
					playsInline
					style={{ width: "100%", height: "100%", objectFit: "contain" }}
					ref={(el) => { if (el) el.volume = item.volume; }}
					onEnded={clear}
					onError={clear}
				/>
			)}
			{item && item.kind === "audio" && (
				<audio
					key={item.nonce}
					src={item.src}
					autoPlay
					ref={(el) => { if (el) el.volume = item.volume; }}
					onEnded={clear}
					onError={clear}
				/>
			)}
		</div>
	);
};

export default EventSource;
