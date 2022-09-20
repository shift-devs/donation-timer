import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;

const CurrentTimeBonus: React.FC = () => {
	const [nextTimeTier, setNextTimeTier] = useState(3600);
	const [fetched, setFetched] = useState(false);

	const connectWs = () => {
		ws = new WebSocket(`${WS_URL}?token=${token}&page=timebonus`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			console.log(`received ${event.data}`);

			if ("error" in response) {
				console.log(`error: ${response.error}`);
			}

			if ("hypeEndTime" in response) {
				setNextTimeTier(response.nextTimeTier);
				if (!fetched) {
					setFetched(true);
				}
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

	const token = new URLSearchParams(window.location.search).get("token");
	if (fetched && nextTimeTier < 21)
		return (
			<div
				className='Timer'
				style={{
					color: "#00ffff",
					fontFamily: "Roboto, sans-serif",
					fontSize: "128px",
					fontWeight: 600,
					textAlign: "left",
				}}
			>
				Reach <span style={{ color: "white" }}>{nextTimeTier}:00:00</span> for
				sub !value increase!
			</div>
		);
	else if (fetched && nextTimeTier > 20)
		return (
			<div
				className='Timer'
				style={{
					color: "#00ffff",
					fontFamily: "Roboto, sans-serif",
					fontSize: "128px",
					fontWeight: 600,
					textAlign: "left",
				}}
			>
				HOLD THE LINE!
			</div>
		);
	else return <div>Loading</div>;
};

export default CurrentTimeBonus;
