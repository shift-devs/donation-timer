import Timer from "../Timer";
import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let timer_color: string = "white";

const Widget: React.FC = () => {
	const [seconds, setSeconds] = useState(0);
	const [fetched, setFetched] = useState(false);

	const updateSeconds = (endTime: number) => {
		console.log(
			`Syncing endtime to ${endTime} and seconds to ${
				endTime - new Date().getTime() / 1000
			} `
		);

		setSeconds(Math.round(endTime - new Date().getTime() / 1000));
	};

	const connectWs = () => {
		ws = new WebSocket(`${WS_URL}?token=${token}&page=widget`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			console.log(`received ${event.data}`);

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
			setTimeout(connectWs, 5000);
		};

		ws.onerror = (event) => {
			console.error(`socket encountered error: ${event} - closing socket`);
			ws.close();
		};
	};

	useEffect(() => {
		connectWs();
		return () => ws.close();
	}, []);

	useEffect(() => {
		const interval = setInterval(() => {
			if (seconds > 0) {
				setSeconds((prev) => prev - 1);
			}
		}, 1000);
		return () => {
			clearInterval(interval);
		};
	}, [seconds]);

	const token = new URLSearchParams(window.location.search).get("token");
	
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
