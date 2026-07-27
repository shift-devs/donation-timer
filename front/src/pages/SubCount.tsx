import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// which tally this browser source shows. ?platform=all sums the three services into one number.
type Platform = "twitch" | "youtube" | "kick" | "all";
const PLATFORMS: Platform[] = ["twitch", "youtube", "kick", "all"];

// one page, four OBS URLs: /subcount?platform=twitch|youtube|kick|all. renders the live tally over a
// chroma-key fill (color shared with the timer widget) so it drops straight into a scene. optional
// ?label=... prints a caption above the number; ?color=... overrides the number color (default white).
const SubCount: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	const raw = (params.get("platform") || "all").toLowerCase();
	const platform: Platform = (PLATFORMS as string[]).includes(raw) ? (raw as Platform) : "all";
	const label = params.get("label") || "";
	const textColor = params.get("color") || "white";

	const [counts, setCounts] = useState({ twitch: 0, youtube: 0, kick: 0 });
	const [fetched, setFetched] = useState(false);
	const [bgColor, setBgColor] = useState("#00FF00"); // chroma green until the sync says otherwise

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=subcount`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			if ("subCounts" in response) {
				const c = response.subCounts || {};
				setCounts({
					twitch: Number(c.twitch) || 0,
					youtube: Number(c.youtube) || 0,
					kick: Number(c.kick) || 0,
				});
				if (response.widgetSettings && typeof response.widgetSettings.bgColor === "string")
					setBgColor(response.widgetSettings.bgColor);
				if (!fetched)
					setFetched(true);
			} else if ("error" in response) {
				console.log(`error: ${response.error}`);
			}
		};

		ws.onclose = (event) => {
			console.log(`socket closed, attempting reconnect in 5 seconds... (${event.reason})`);
			setFetched(false);
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

	const total = platform === "all" ? counts.twitch + counts.youtube + counts.kick : counts[platform];

	// full-viewport chroma key fill — OBS keys it out so only the number shows
	const wrap: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		margin: 0,
		background: bgColor,
		overflow: "hidden",
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		fontFamily: "'Staatliches', cursive",
		color: textColor,
	};

	return (
		<div style={wrap}>
			{label && (
				<div style={{ fontSize: "48px", fontWeight: 400, lineHeight: 1, marginBottom: "8px" }}>
					{label}
				</div>
			)}
			<div style={{ fontSize: "128px", fontWeight: 400, lineHeight: 1 }}>
				{(fetched && token) ? total.toLocaleString() : "—"}
			</div>
		</div>
	);
};

export default SubCount;
