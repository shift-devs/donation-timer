import Timer from "../Timer";
import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let timer;
const SubsUntil: React.FC = () => {
	const [currentHype, setCurrentHype] = useState(0);
	const [nextLevel, setNextLevel] = useState(0);
	const [subTime, setSubTime] = useState(0);
	const [fetched, setFetched] = useState(false);

	const connectWs = () => {
		ws = new WebSocket(`${WS_URL}?token=${token}&page=hype`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			console.log(`received ${event.data}`);

			if ("currentHype" in response) {
				if (response.nextLevel > 50) setNextLevel(0);
				else setNextLevel(response.nextLevel);

				setCurrentHype(response.currentHype);

				setSubTime(response.subTime + response.nextBonus);
				if (!fetched) {
					setFetched(true);
				}
			} else if ("error" in response) {
				console.log(`error: ${response.error}`);
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

	if (subTime > 0)
		timer = `${Math.floor(subTime / 60) % 60}:${("0" + (subTime % 60)).slice(
			-2
		)}`;
	else timer = "0:00";

	const token = new URLSearchParams(window.location.search).get("token");
	if (token)
		if (nextLevel > 0)
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
					{currentHype}/{nextLevel} subs until subs add {timer}
				</div>
			);
		else
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
					ALL SUBS ADD 2:00 UNTIL TIME RUNS OUT
				</div>
			);
	else return <div>Invalid URL</div>;
};

export default SubsUntil;
