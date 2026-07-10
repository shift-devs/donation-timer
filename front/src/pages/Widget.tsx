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

	if (!fetched || !token)
		return (
			<div style={{
				background:"#000000",
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
		<div>
			<Timer input_seconds={seconds} textAlign='start' color={timer_color} />
		</div>
	);
};

export default Widget;
