import Timer from "../Timer";
import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;
let timer_color: string = "white";

const Widget: React.FC = () => {
	const token = new URLSearchParams(window.location.search).get("token");
	const [seconds, setSeconds] = useState(0);
	const [endTime, setEndTime] = useState(0);
	const [fetched, setFetched] = useState(false);

	const updateSeconds = (et: number) => {
		setEndTime(et);
		setSeconds(Math.round((et - Date.now()) / 1000));
	};

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
				updateSeconds(response.endTime);
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

	// single interval deriving seconds from endTime each tick — no per-tick re-arm, no drift over a weeks-long overlay
	useEffect(() => {
		const id = setInterval(() => {
			const s = Math.round((endTime - Date.now()) / 1000);
			setSeconds(s > 0 ? s : 0);
		}, 1000);
		return () => clearInterval(id);
	}, [endTime]);

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
