import Timer from "../Timer";
import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let forceSync: any;
let forceUpdateTimer = 5;
let timer: string;

const TimePerSub: React.FC = () => {
	const [seconds, setSeconds] = useState(0);
	const [fetched, setFetched] = useState(false);

	const connectWs = () => {
		ws = new WebSocket(`${WS_URL}?token=${token}&page=hype`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			console.log(`received ${event.data}`);

			if ("subTime" in response) {
				setSeconds(response.subTime + response.bonusTime);
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

	if (seconds > 0)
		timer = `${Math.floor(seconds / 60) % 60}:${("0" + (seconds % 60)).slice(
			-2
		)}`;
	else timer = "0:00";

	const token = new URLSearchParams(window.location.search).get("token");
	if (token)
		return (
			<div
				className='Timer'
				style={{
					color: "white",
					fontFamily: "Roboto, sans-serif",
					fontSize: "128px",
					fontWeight: 400,
					textAlign: "left",
				}}
			>
				{timer}
			</div>
		);
	else return <div>Invalid URL</div>;
};

export default TimePerSub;
