import React, { useEffect, useRef, useState } from "react";
import * as consts from "../Consts";

// live fourthwall activity feed: one row per purchased product (plus donations/memberships), newest
// first, with the buyer and their checkout message — meant to sit open in a tab so the streamer can
// thank people. backlog loads on connect, live entries stream in over the ws (page=fwactivity).

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// the page opens on the newest handful and reveals more only when asked. every row on screen pulls its product
// photo, so rendering the whole backlog up front meant hundreds of image fetches nobody had asked for — this way
// the cost of looking further back is paid by whoever chooses to look.
const ROW_STEP = 10;
// the backlog is held in full so "show 10 more" is instant and costs no request; this mirrors the server's own
// FW_ACTIVITY_CAP, and exists so a long-running tab can't grow the array without bound.
const MAX_STORED = 300;

interface Entry {
	t: number;
	product: string;
	user: string;
	message: string;
	image: string;
	unit: string;
	// units of the product in that order. absent on donations/memberships and on rows written before the
	// feed carried it, so it always reads through qtyOf().
	qty?: number;
}

const qtyOf = (e: Entry) => Math.max(1, Math.trunc(Number(e.qty)) || 1);

// dark theme: this page stays open all stream, so no white rectangle burning on a second monitor
const CSS = `
html, body { background: #0f1115; }
@keyframes fwa-flash { 0% { background: #14532d; } 100% { background: #171a21; } }
.fwa-row { animation: fwa-flash 2s ease-out both; }
.fwa-more {
	width: 100%; padding: 12px; margin-bottom: 14px; cursor: pointer;
	background: #171a21; color: #86efac; border: 2px solid #22c55e; border-radius: 8px;
	font-family: inherit; font-size: 18px; font-weight: 700;
}
.fwa-more:hover { background: #1d2230; }
`;

function when(t: number): string {
	if (!t) return "";
	const d = new Date(t);
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const FwActivity: React.FC = () => {
	const token = new URLSearchParams(window.location.search).get("token");
	const [entries, setEntries] = useState<Entry[] | null>(null);
	// how many of the held entries are on screen. only ever changes when the button is pressed — a purchase
	// landing while you're reading further back must not reflow the list under you.
	const [visible, setVisible] = useState(ROW_STEP);
	const requestedRef = useRef(false);

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=fwactivity`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			if ("fwActivity" in response) {
				// backlog arrives oldest-first; hold it all, newest on top, and render down to `visible`
				setEntries([...(response.fwActivity || [])].reverse().slice(0, MAX_STORED));
				return;
			}
			if ("fwActivityEntry" in response && response.fwActivityEntry) {
				setEntries((prev) => [response.fwActivityEntry, ...(prev || [])].slice(0, MAX_STORED));
				return;
			}
			// first sync after login = the socket is ready; fetch the backlog once per connection
			if ("endTime" in response && !requestedRef.current) {
				requestedRef.current = true;
				ws.send(JSON.stringify({ event: "getFwActivity" }));
			}
		};

		ws.onclose = (event) => {
			console.log(`socket closed, attempting reconnect in 5 seconds... (${event.reason})`);
			requestedRef.current = false;
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

	const page: React.CSSProperties = {
		maxWidth: "860px",
		margin: "0 auto",
		padding: "20px",
		fontFamily: "Arial, sans-serif",
		background: "#0f1115",
		color: "#e5e7eb",
		minHeight: "100vh",
	};

	if (!token)
		return <div style={page}>Missing token — open this page via the URL on the dashboard&apos;s Fourthwall tab.</div>;

	const hidden = Math.max(0, (entries || []).length - visible);

	return (
		<div style={page}>
			<style>{CSS}</style>
			<h2 style={{ fontWeight: 900, fontSize: "28px", margin: "0 0 18px 0", color: "#f9fafb" }}>Fourthwall activity</h2>
			{entries === null && <div style={{ color: "#9ca3af", fontSize: "18px" }}>Loading…</div>}
			{entries !== null && entries.length === 0 && (
				<div style={{ color: "#9ca3af", fontSize: "18px" }}>Nothing yet — purchases will appear here as they happen.</div>
			)}
			{(entries || []).slice(0, visible).map((e, i) => (
				<div
					key={`${e.t}-${i}`}
					className={i === 0 ? "fwa-row" : undefined}
					style={{
						display: "flex",
						gap: "16px",
						alignItems: "center",
						border: "2px solid #22c55e",
						borderRadius: "8px",
						padding: "14px",
						marginBottom: "14px",
						background: "#171a21",
					}}
				>
					{/* quantity rides the thumbnail, on every row, so how many were bought is never in question */}
					<div style={{ position: "relative", flexShrink: 0 }}>
						{e.image ? (
							<img src={e.image} alt='' style={{ width: "96px", height: "96px", objectFit: "cover", border: "3px solid #374151", borderRadius: "4px", display: "block" }} />
						) : (
							<div style={{ width: "96px", height: "96px", background: "#252a34", border: "3px solid #374151", borderRadius: "4px" }} />
						)}
						<div
							style={{
								position: "absolute",
								right: "-8px",
								bottom: "-8px",
								background: "#22c55e",
								color: "#0f1115",
								border: "3px solid #171a21",
								borderRadius: "999px",
								padding: "1px 10px",
								fontWeight: 900,
								fontSize: "20px",
								lineHeight: 1.3,
							}}
						>
							&times;{qtyOf(e)}
						</div>
					</div>
					<div style={{ minWidth: 0, flex: 1 }}>
						{/* no product name — the image is the identifier; title attr keeps it hoverable */}
						<div title={`${e.product} ×${qtyOf(e)}`} style={{ fontWeight: 700, fontSize: "20px", color: "#86efac" }}>{e.user}</div>
						{e.message && (
							<div style={{ color: "#c4c9d4", fontSize: "20px", marginTop: "4px", overflowWrap: "anywhere" }}>{e.message}</div>
						)}
					</div>
					<div style={{ color: "#6b7280", fontSize: "14px", flexShrink: 0, alignSelf: "flex-start" }}>{when(e.t)}</div>
				</div>
			))}
			{/* the rest of the backlog is already here — revealing it costs no request, just the photos of the rows
			    that come into view */}
			{hidden > 0 && (
				<button className='fwa-more' onClick={() => setVisible((v) => v + ROW_STEP)}>
					Show {Math.min(ROW_STEP, hidden)} more ({hidden} older)
				</button>
			)}
		</div>
	);
};

export default FwActivity;
