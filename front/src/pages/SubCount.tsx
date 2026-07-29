import React, { useEffect, useState } from "react";
import * as consts from "../Consts";
import { TEXT_EFFECTS, MAX_EFFECT_WIDTH, textEffectStyle, TRANSPARENT_BODY_CSS } from "../textEffect";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// which tally this browser source shows. ?platform=all sums the three services into one number.
// "activesubs"/"subpoints" are a different kind of number: a live snapshot of twitch subscribers right now,
// which falls as subs lapse, where the other four only ever count up from events we saw.
type Platform = "twitch" | "youtube" | "kick" | "all" | "activesubs" | "subpoints";
const PLATFORMS: Platform[] = ["twitch", "youtube", "kick", "all", "activesubs", "subpoints"];

// one page, six OBS URLs: /subcount?platform=twitch|youtube|kick|all|activesubs|subpoints. renders the live
// tally over a chroma-key fill (color shared with the timer widget) so it drops straight into a scene.
// optional ?label=... prints a caption above the number; ?color=... overrides the number color (white);
// ?bg=... overrides the fill (hex, or "transparent" so OBS needs no colour key at all); ?effect=stroke|shadow
// with ?effectColor= and ?effectWidth= outlines the text so it survives a busy scene.
const HEX = /^#[0-9a-fA-F]{6}$/;
const SubCount: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	const raw = (params.get("platform") || "all").toLowerCase();
	const platform: Platform = (PLATFORMS as string[]).includes(raw) ? (raw as Platform) : "all";
	const label = params.get("label") || "";
	const textColor = params.get("color") || "white";
	// the fill: a url value wins, otherwise the live-synced widget colour, so urls copied before this existed
	// keep following the Settings tab. "transparent" is url-only — the synced value is shared with the
	// progress sources, which don't clear the body background.
	const qpBg = (params.get("bg") || "").trim();
	const effect = TEXT_EFFECTS.includes((params.get("effect") || "").trim()) ? (params.get("effect") || "").trim() : "none";
	const effectColor = HEX.test((params.get("effectColor") || "").trim()) ? (params.get("effectColor") || "").trim() : "";
	const effectWidthRaw = Number(params.get("effectWidth"));
	const effectWidth = Number.isFinite(effectWidthRaw) ? Math.min(MAX_EFFECT_WIDTH, Math.max(0, effectWidthRaw)) : 0;

	const [counts, setCounts] = useState({ twitch: 0, youtube: 0, kick: 0 });
	// tracked apart from the all-time tallies: ok=false means the twitch read is failing, and a stale
	// "active" number on stream is worse than showing nothing
	const [active, setActive] = useState({ count: 0, points: 0, ok: false });
	const [fetched, setFetched] = useState(false);
	const [syncBg, setSyncBg] = useState("#00FF00"); // chroma green until the sync says otherwise

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
				if (response.activeSubs)
					setActive({
						count: Number(response.activeSubs.count) || 0,
						points: Number(response.activeSubs.points) || 0,
						ok: !!response.activeSubs.ok,
					});
				if (response.widgetSettings && typeof response.widgetSettings.bgColor === "string")
					setSyncBg(response.widgetSettings.bgColor);
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

	// the live tallies can be unavailable (twitch not connected / read failing) in a way the all-time ones
	// can't, so they carry their own "do we have a number at all" answer
	const live = platform === "activesubs" || platform === "subpoints";
	const value = platform === "activesubs"
		? active.count
		: platform === "subpoints"
			? active.points
			: platform === "all"
				? counts.twitch + counts.youtube + counts.kick
				: counts[platform as "twitch" | "youtube" | "kick"];
	const haveValue = fetched && !!token && (!live || active.ok);

	const bgColor = qpBg === "transparent" || HEX.test(qpBg) ? qpBg : syncBg;

	// full-viewport fill — OBS keys it out so only the number shows, or composites directly when transparent.
	// the effect goes on the wrapper because text-shadow and -webkit-text-stroke inherit, so the label and the
	// number are treated alike without repeating it.
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
		...textEffectStyle(effect, effectColor, effectWidth),
	};

	return (
		<div style={wrap}>
			<style>{TRANSPARENT_BODY_CSS}</style>
			{label && (
				<div style={{ fontSize: "48px", fontWeight: 400, lineHeight: 1, marginBottom: "8px" }}>
					{label}
				</div>
			)}
			<div style={{ fontSize: "128px", fontWeight: 400, lineHeight: 1 }}>
				{haveValue ? value.toLocaleString() : "—"}
			</div>
		</div>
	);
};

export default SubCount;
