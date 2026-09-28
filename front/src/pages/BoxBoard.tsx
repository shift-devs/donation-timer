import React, { useEffect, useRef, useState } from "react";
import * as consts from "../Consts";
import { TRANSPARENT_BODY_CSS } from "../textEffect";
import { PLACE_COLORS } from "../boxBoard";

// the OBS browser source for the box leaderboard: /boxboard?token=… . the server sends the top N already
// ranked, with the look, on every sync — and syncs the moment a box is bought, so it's live.

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

const CSS = `
@keyframes bb-bump { 0% { transform: scale(1.12); filter: brightness(1.6); } 100% { transform: scale(1); filter: none; } }
.bb-bump { animation: bb-bump 1.2s ease-out both; }
`;

// the same text either way, so a name over a busy scene stays readable without a panel behind it
const HALO = "0 0 6px rgba(0,0,0,0.9), 0 2px 3px rgba(0,0,0,0.9)";

const BoxBoard: React.FC = () => {
	const token = new URLSearchParams(window.location.search).get("token");
	const [board, setBoard] = useState<any | null>(null);
	// last count seen per name, so a row that just went up can flash
	const prev = useRef<{ [name: string]: number }>({});
	const [bumped, setBumped] = useState<{ [name: string]: number }>({});

	const connectWs = () => {
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=boxboard`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			if ("boxBoard" in response) {
				setBoard(response.boxBoard || null);
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

	// the first board after connecting just records the counts — nothing flashes on a reconnect
	const rowsKey = board ? JSON.stringify(board.rows) : "";
	useEffect(() => {
		if (!board)
			return;
		const first = !Object.keys(prev.current).length;
		const next: { [name: string]: number } = {};
		const up: { [name: string]: number } = {};
		for (const r of board.rows) {
			next[r.name] = r.count;
			if (!first && r.count > (prev.current[r.name] || 0))
				up[r.name] = Date.now();
		}
		prev.current = next;
		if (Object.keys(up).length)
			setBumped((b) => ({ ...b, ...up }));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rowsKey]);

	if (!board)
		return <style>{TRANSPARENT_BODY_CSS}</style>;

	const fs = board.fontSize || 36;
	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				padding: `${Math.round(fs * 0.5)}px`,
				background: board.bgColor === "transparent" ? "transparent" : board.bgColor,
				fontFamily: "'Staatliches', cursive",
				textShadow: HALO,
				overflow: "hidden",
			}}
		>
			<style>{TRANSPARENT_BODY_CSS + CSS}</style>
			{board.title && (
				<div style={{ color: board.titleColor, fontSize: `${Math.round(fs * 1.3)}px`, lineHeight: 1.1, marginBottom: `${Math.round(fs * 0.35)}px`, textAlign: "center" }}>
					{board.title}
				</div>
			)}
			{board.rows.length === 0 && (
				<div style={{ color: board.nameColor, opacity: 0.7, fontSize: `${Math.round(fs * 0.8)}px`, textAlign: "center" }}>
					No boxes yet
				</div>
			)}
			{board.rows.map((r: any) => (
				<div
					key={`${r.name}:${bumped[r.name] || 0}`}
					className={bumped[r.name] ? "bb-bump" : undefined}
					style={{ display: "flex", alignItems: "baseline", gap: `${Math.round(fs * 0.4)}px`, fontSize: `${fs}px`, lineHeight: 1.25 }}
				>
					<span style={{ color: PLACE_COLORS[r.place - 1] || board.nameColor, minWidth: `${Math.round(fs * 1.4)}px`, textAlign: "right" }}>
						#{r.place}
					</span>
					<span style={{ color: board.nameColor, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
						{r.name}
					</span>
					{board.showCounts && (
						<span style={{ color: board.countColor }}>{r.count}</span>
					)}
				</div>
			))}
		</div>
	);
};

export default BoxBoard;
