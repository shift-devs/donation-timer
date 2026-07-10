import React, { useEffect, useRef, useState } from "react";
import * as consts from "../Consts";

// live fourthwall activity feed: one row per purchased product (plus donations/memberships), newest
// first, with the buyer and their checkout message — meant to sit open in a tab so the streamer can
// thank people. backlog loads on connect, live entries stream in over the ws (page=fwactivity).

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

interface Entry {
	t: number;
	product: string;
	user: string;
	message: string;
	image: string;
	unit: string;
}

// dark theme: this page stays open all stream, so no white rectangle burning on a second monitor
const CSS = `
html, body { background: #0f1115; }
@keyframes fwa-flash { 0% { background: #14532d; } 100% { background: #171a21; } }
.fwa-row { animation: fwa-flash 2s ease-out both; }
`;

function when(t: number): string {
	if (!t) return "";
	const d = new Date(t);
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const FwActivity: React.FC = () => {
	const token = new URLSearchParams(window.location.search).get("token");
	const [entries, setEntries] = useState<Entry[] | null>(null);
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
				// backlog arrives oldest-first; show newest on top
				setEntries([...(response.fwActivity || [])].reverse());
				return;
			}
			if ("fwActivityEntry" in response && response.fwActivityEntry) {
				setEntries((prev) => [response.fwActivityEntry, ...(prev || [])].slice(0, 300));
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

	return (
		<div style={page}>
			<style>{CSS}</style>
			<h2 style={{ fontWeight: 900, fontSize: "28px", margin: "0 0 18px 0", color: "#f9fafb" }}>Fourthwall activity</h2>
			{entries === null && <div style={{ color: "#9ca3af", fontSize: "18px" }}>Loading…</div>}
			{entries !== null && entries.length === 0 && (
				<div style={{ color: "#9ca3af", fontSize: "18px" }}>Nothing yet — purchases will appear here as they happen.</div>
			)}
			{(entries || []).map((e, i) => (
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
					{e.image ? (
						<img src={e.image} alt='' style={{ width: "96px", height: "96px", objectFit: "cover", border: "3px solid #374151", borderRadius: "4px", flexShrink: 0 }} />
					) : (
						<div style={{ width: "96px", height: "96px", background: "#252a34", border: "3px solid #374151", borderRadius: "4px", flexShrink: 0 }} />
					)}
					<div style={{ minWidth: 0, flex: 1 }}>
						{/* no product name — the image is the identifier; title attr keeps it hoverable */}
						<div title={e.product} style={{ fontWeight: 700, fontSize: "20px", color: "#86efac" }}>{e.user}</div>
						{e.message && (
							<div style={{ color: "#c4c9d4", fontSize: "20px", marginTop: "4px", overflowWrap: "anywhere" }}>{e.message}</div>
						)}
					</div>
					<div style={{ color: "#6b7280", fontSize: "14px", flexShrink: 0, alignSelf: "flex-start" }}>{when(e.t)}</div>
				</div>
			))}
		</div>
	);
};

export default FwActivity;
