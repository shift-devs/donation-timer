import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// sales-progress browser source: a "title  [====bar====]  sold / max" row for one fourthwall product.
// one page, one OBS URL per product. the units-sold count rides the normal sync (fwUnitsSold, keyed by
// offer id) and refreshes as the backend polls the report. URL params (all built by the dashboard wizard):
//   product=<offerId>  max=<goal>  title=<text left of the bar>
//   fill=<progress color>  track=<empty-bar color>  text=<title + number color>
const FwProgress: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	const product = params.get("product") || "";
	const max = Math.max(1, Math.trunc(Number(params.get("max")) || 100)); // avoid divide-by-zero
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
	const pct = Math.min(100, Math.max(0, (sold / max) * 100));

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
		fontFamily: "'Staatliches', cursive",
		padding: "0 40px",
	};
	// title + count sit inside the bar (name left, progress right); shadow keeps them legible over the fill
	const barText: React.CSSProperties = {
		position: "relative",
		zIndex: 1,
		fontSize: "56px",
		fontWeight: 400,
		lineHeight: 1,
		color: textColor,
		whiteSpace: "nowrap",
		textShadow: "0 2px 6px rgba(0,0,0,0.6)",
	};

	return (
		<div style={wrap}>
			<div
				style={{
					position: "relative",
					boxSizing: "border-box",
					width: "100%",
					maxWidth: "1600px",
					height: "96px",
					background: trackColor,
					borderRadius: "48px",
					overflow: "hidden",
					border: `4px solid ${textColor}`,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "0 44px",
				}}
			>
				{/* fill sits behind the text */}
				<div
					style={{
						position: "absolute",
						left: 0,
						top: 0,
						height: "100%",
						width: `${ready ? pct : 0}%`,
						background: fillColor,
						transition: "width 0.6s ease",
						zIndex: 0,
					}}
				/>
				<div style={barText}>{title}</div>
				<div style={barText}>{ready ? `${sold.toLocaleString()} / ${max.toLocaleString()}` : "—"}</div>
			</div>
		</div>
	);
};

export default FwProgress;
