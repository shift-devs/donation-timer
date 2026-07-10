import Timer from "../Timer";
import React, { useEffect, useState } from "react";
import * as consts from "../Consts";
import { useCountdownSeconds } from "../useCountdown";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;
let timer_color: string = "white";

const Widget: React.FC = () => {
	const token = new URLSearchParams(window.location.search).get("token");
	const [endTime, setEndTime] = useState(0);
	const [fetched, setFetched] = useState(false);
	const [bgColor, setBgColor] = useState("#00FF00"); // chroma green until the sync says otherwise
	const seconds = useCountdownSeconds(endTime);

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
					setBgColor(response.widgetSettings.bgColor);
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
			<div style={{
				...wrap,
				color: "white",
				fontFamily: "'Staatliches', cursive",
				fontSize: "128px",
				fontWeight: 400,
				textAlign: "start",
			}}>
				?:??
			</div>
		);

	return (
		<div style={wrap}>
			<Timer input_seconds={seconds} textAlign='start' color={timer_color} background={bgColor} />
		</div>
	);
};

export default Widget;
