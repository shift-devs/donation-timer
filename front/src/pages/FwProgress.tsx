import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// sales-progress browser source: a "X of N sold" bar for one fourthwall product. one page, one OBS URL
// per product: /fwprogress?product=<offerId>&max=1000. the units-sold count rides the normal sync
// (fwUnitsSold, keyed by offer id) and refreshes as the backend polls the report. optional ?label=...
// caption, ?color=... number/label color, ?bar=... fill color, ?track=... empty-track color.
const FwProgress: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	const product = params.get("product") || "";
	const max = Math.max(1, Math.trunc(Number(params.get("max")) || 100)); // avoid divide-by-zero
	const label = params.get("label") || "";
	const textColor = params.get("color") || "white";
	const barColor = params.get("bar") || "#22c55e";
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
	const pct = Math.min(100, Math.max(0, (sold / max) * 100));

	// full-viewport chroma key fill — OBS keys it out so only the bar shows
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
		padding: "0 40px",
	};

	return (
		<div style={wrap}>
			{label && (
				<div style={{ fontSize: "56px", fontWeight: 400, lineHeight: 1, marginBottom: "14px" }}>
					{label}
				</div>
			)}
			<div
				style={{
					width: "100%",
					maxWidth: "900px",
					height: "72px",
					background: trackColor,
					borderRadius: "36px",
					overflow: "hidden",
					border: "4px solid rgba(255,255,255,0.9)",
				}}
			>
				<div
					style={{
						width: `${ready ? pct : 0}%`,
						height: "100%",
						background: barColor,
						transition: "width 0.6s ease",
					}}
				/>
			</div>
			<div style={{ fontSize: "64px", fontWeight: 400, lineHeight: 1, marginTop: "16px" }}>
				{ready ? `${sold.toLocaleString()} / ${max.toLocaleString()}` : "—"}
			</div>
		</div>
	);
};

export default FwProgress;
