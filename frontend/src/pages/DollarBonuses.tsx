import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;

const CurrentDollarBonus: React.FC = () => {
	const [currentTimeTier, setCurrentTimeTier] = useState(0);
	const [fetched, setFetched] = useState(false);

	const connectWs = () => {
		ws = new WebSocket(`${WS_URL}?token=${token}&page=timebonus`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			console.log(`received ${event.data}`);

			if ("error" in response) {
				console.log(`error: ${response.error}`);
			}

			if ("currentTimeTier" in response) {
				setCurrentTimeTier(response.currentTimeTier);
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
	if (fetched) {
		switch (currentTimeTier) {
			case 0:
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
						$1.00 dono <span style={{ color: "white" }}>+14</span> secs
						<br />
						100 bits <span style={{ color: "white" }}>+14</span> secs
						<br />
						$1 in !merch <span style={{ color: "white" }}>+14</span> secs
					</div>
				);
			case 1:
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
						$1.00 dono <span style={{ color: "white" }}>+16</span> secs
						<br />
						100 bits <span style={{ color: "white" }}>+16</span> secs
						<br />
						$1 in !merch <span style={{ color: "white" }}>+16</span> secs
					</div>
				);
			case 2:
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
						$1.00 dono <span style={{ color: "white" }}>+18</span> secs
						<br />
						100 bits <span style={{ color: "white" }}>+18</span> secs
						<br />
						$1 in !merch <span style={{ color: "white" }}>+18</span> secs
					</div>
				);
		}
	}
	return <div>Loading</div>;
};

export default CurrentDollarBonus;
