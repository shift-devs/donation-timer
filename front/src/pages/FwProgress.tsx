import React, { useEffect, useState } from "react";
import * as consts from "../Consts";
import ProgressBar from "../ProgressBar";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// sales-progress browser source: a "title  [====bar====]  sold / max" row for one fourthwall product.
// one page, one OBS URL per product. the units-sold count rides the normal sync (fwUnitsSold, keyed by
// offer id) and refreshes as the backend polls the report. URL params (all built by the dashboard wizard):
//   product=<offerId>  max=<goal>  title=<text left of the bar>
//   offset=<units already sold before this goal started, subtracted from the count. negative adds instead,
//           which seeds the bar above the shop's real number — for a goal counting sales made elsewhere>
//   fill=<progress color>  track=<empty-bar color>  text=<title + number color>
const FwProgress: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	const product = params.get("product") || "";
	const max = Math.max(1, Math.trunc(Number(params.get("max")) || 100)); // avoid divide-by-zero
	const offset = Math.trunc(Number(params.get("offset")) || 0); // negative is allowed, and adds to the count
	const title = params.get("title") || "";
	const textColor = params.get("text") || "#ffffff";
	const fillColor = params.get("fill") || "#22c55e";
	const trackColor = params.get("track") || "rgba(0,0,0,0.45)";

	const [sold, setSold] = useState(0);
	const [fetched, setFetched] = useState(false);
	const [bgColor, setBgColor] = useState("#00FF00"); // chroma green until the sync says otherwise

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=fwprogress`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			if ("fwUnitsSold" in response) {
				const m = response.fwUnitsSold || {};
				setSold(Number(m[product]) || 0);
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

	const ready = fetched && token && product;
	// all-time units minus what was already sold when the goal started, or plus a hand-added baseline when
	// the offset is negative. still floored at 0 so an offset set above the real count can't show a minus.
	const count = Math.max(0, sold - offset);

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

export default FwProgress;
