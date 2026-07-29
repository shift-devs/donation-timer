import Timer, { timerTextStyle, renderTimerText, TIMER_FONTS } from "../Timer";
import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;
let timer_color: string = "white";

const HEX = /^#[0-9a-fA-F]{6}$/;
const ALIGNS = ["left", "center", "right"];
const EFFECTS = ["stroke", "shadow"];
const MAX_EFFECT = 20; // px; past this the outline swallows the digits

const Widget: React.FC = () => {
	// look built by the dashboard's widget wizard, baked into the url so one shop can run several sources
	// with different looks. anything absent falls back to the live-synced settings, so urls copied before
	// the wizard existed keep rendering exactly as they did.
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");
	const qpBg = params.get("bg") || "";
	const qpAlign = params.get("align") || "";
	const qpFont = params.get("font") || "";
	const qpEffect = params.get("effect") || "";
	const qpEffectColor = params.get("effectColor") || "";
	const qpEffectW = Number(params.get("effectWidth"));

	const [endTime, setEndTime] = useState(0);
	const [fetched, setFetched] = useState(false);
	const [syncBg, setSyncBg] = useState("#00FF00"); // chroma green until the sync says otherwise
	const [syncAlign, setSyncAlign] = useState("left"); // timer justification, same default as the backend

	const bgColor = HEX.test(qpBg) ? qpBg : syncBg;
	const align = ALIGNS.includes(qpAlign) ? qpAlign : syncAlign;
	const font = TIMER_FONTS[qpFont] ? qpFont : "display";
	const effect = EFFECTS.includes(qpEffect) ? qpEffect : "none";
	const effectColor = HEX.test(qpEffectColor) ? qpEffectColor : "";
	const effectWidth = Number.isFinite(qpEffectW) ? Math.min(MAX_EFFECT, Math.max(0, qpEffectW)) : 0;

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=widget`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);

			if ("endTime" in response) {
				setEndTime(response.endTime);
				if (response.widgetSettings && typeof response.widgetSettings.bgColor === "string")
					setSyncBg(response.widgetSettings.bgColor);
				if (response.widgetSettings && typeof response.widgetSettings.align === "string")
					setSyncAlign(response.widgetSettings.align);
				if (!fetched) {
					setFetched(true);
				}
			} else if ("error" in response) {
				console.log(`error: ${response.data}`);
			}
		};

		ws.onclose = (event) => {
			console.log(
				`socket closed, attempting reconnect in 5 seconds... (${event.reason})`
			);
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
	}, []);

	// full-viewport chroma key fill (color set in the dashboard's Settings tab; #00FF00 default) —
	// OBS keys it out so only the timer shows
	const wrap: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		margin: 0,
		background: bgColor,
		overflow: "hidden",
	};

	if (!fetched || !token)
		return (
			<div style={{ ...wrap, ...timerTextStyle({ background: bgColor, textAlign: align, font, effect, effectColor, effectWidth }) }}>
				{renderTimerText("?:??", font)}
			</div>
		);

	return (
		<div style={wrap}>
			<Timer
				endTime={endTime}
				textAlign={align}
				color={timer_color}
				background={bgColor}
				font={font}
				effect={effect}
				effectColor={effectColor}
				effectWidth={effectWidth}
			/>
		</div>
	);
};

export default Widget;
