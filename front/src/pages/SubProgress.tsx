import React, { useEffect, useState } from "react";
import * as consts from "../Consts";
import ProgressBar from "../ProgressBar";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// which tally this bar tracks. "all" sums the three services, same as /subcount.
type Platform = "twitch" | "youtube" | "kick" | "all";
const PLATFORMS: Platform[] = ["twitch", "youtube", "kick", "all"];

// sub-count progress bar browser source: a "title  [====bar====]  subs / goal" row for one service (or the
// combined total). the tally rides the normal sync (subCounts) so it moves the moment a sub lands.
// URL params (all built by the dashboard wizard):
//   platform=twitch|youtube|kick|all  max=<goal>  title=<text left of the bar>
//   offset=<subs already counted before this goal started, subtracted from the tally>
//   fill=<progress color>  track=<empty-bar color>  text=<title + number color>
const SubProgress: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	const raw = (params.get("platform") || "all").toLowerCase();
	const platform: Platform = (PLATFORMS as string[]).includes(raw) ? (raw as Platform) : "all";
	const max = Math.max(1, Math.trunc(Number(params.get("max")) || 100)); // avoid divide-by-zero
	const offset = Math.max(0, Math.trunc(Number(params.get("offset")) || 0));
	const title = params.get("title") || "";
	const textColor = params.get("text") || "#ffffff";
	const fillColor = params.get("fill") || "#22c55e";
	const trackColor = params.get("track") || "rgba(0,0,0,0.45)";

	const [counts, setCounts] = useState({ twitch: 0, youtube: 0, kick: 0 });
	const [fetched, setFetched] = useState(false);
	const [bgColor, setBgColor] = useState("#00FF00"); // chroma green until the sync says otherwise

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=subprogress`);

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

	const ready = fetched && !!token;
	const total = platform === "all" ? counts.twitch + counts.youtube + counts.kick : counts[platform];
	const count = Math.max(0, total - offset); // all-time tally minus what was already counted when the goal started

	// full-viewport chroma key fill — OBS keys it out so only the row shows
	const wrap: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		margin: 0,
		background: bgColor,
		overflow: "hidden",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: "0 40px",
	};

	return (
		<div style={wrap}>
			<ProgressBar
				title={title}
				value={ready ? `${count.toLocaleString()} / ${max.toLocaleString()}` : "—"}
				pct={ready ? (count / max) * 100 : 0}
				fill={fillColor}
				track={trackColor}
				textColor={textColor}
			/>
		</div>
	);
};

export default SubProgress;
