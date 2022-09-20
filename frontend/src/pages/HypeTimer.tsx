import React, { useEffect, useState } from "react";
import * as consts from "../Consts";

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let ReadableTimePerSub: string;
let hypeTimer: string;
let nextLevelReadable: string;
const HypeTimer: React.FC = () => {
	const [hypeSeconds, setHypeSeconds] = useState(0);
	const [secondsPerSub, setSecondsPerSub] = useState(0);
	const [currentHype, setCurrentHype] = useState(0);
	const [hypeLevel, setHypeLevel] = useState(0);
	const [nextLevel, setNextLevel] = useState(0);
	const [nextSubTime, setNextSubTime] = useState(0);
	const [fetched, setFetched] = useState(false);

	const connectWs = () => {
		ws = new WebSocket(`${WS_URL}?token=${token}&page=hype`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			console.log(`received ${event.data}`);

			if ("error" in response) {
				console.log(`error: ${response.error}`);
			}
			if ("currentHype" in response) {
				setHypeSeconds(parseInt(response.hypeTimer));

				setSecondsPerSub(response.subTime + response.bonusTime);

				setNextLevel(response.nextLevel);
				setHypeLevel(response.hypeLevel);
				setNextSubTime(response.subTime + response.nextBonus);

				setCurrentHype(response.currentHype);
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

	useEffect(() => {
		const interval = setInterval(() => {
			if (hypeSeconds > 0) {
				setHypeSeconds((prev) => prev - 1);
			}
		}, 1000);
		return () => {
			clearInterval(interval);
		};
	}, [hypeSeconds]);

	if (nextSubTime > 0)
		nextLevelReadable = `${Math.floor(nextSubTime / 60) % 60}:${(
			"0" +
			(nextSubTime % 60)
		).slice(-2)}`;
	else nextLevelReadable = "0:00";

	if (secondsPerSub > 0)
		ReadableTimePerSub = `${Math.floor(secondsPerSub / 60) % 60}:${(
			"0" +
			(secondsPerSub % 60)
		).slice(-2)}`;
	else ReadableTimePerSub = "0:00";

	if (hypeSeconds > 0)
		hypeTimer = `${Math.floor(hypeSeconds / 60) % 60}:${(
			"0" +
			(hypeSeconds % 60)
		).slice(-2)}`;
	else hypeTimer = "0:00";

	const token = new URLSearchParams(window.location.search).get("token");
	if (token && fetched && hypeLevel < 3)
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
				1 SUB ={" "}
				<b style={{ color: "white", WebkitTextStroke: "0px #000000" }}>
					+{ReadableTimePerSub}
				</b>{" "}
				&nbsp;&nbsp;&nbsp;&nbsp; !Combo ends in:{" "}
				<b style={{ color: "white", WebkitTextStroke: "0px #000000" }}>
					{hypeTimer}
				</b>
				<br />
				<b style={{ color: "white", WebkitTextStroke: "0px #000000" }}>
					{currentHype}/{nextLevel}
				</b>{" "}
				subs to make subs worth{" "}
				<b style={{ color: "white", WebkitTextStroke: "0px #000000" }}>
					{nextLevelReadable}
				</b>
			</div>
		);
	else if (token && fetched && hypeLevel > 2)
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
				1 SUB ={" "}
				<b style={{ color: "white", WebkitTextStroke: "0px #000000" }}>
					+{ReadableTimePerSub}
				</b>{" "}
				&nbsp;&nbsp;&nbsp;&nbsp; !Combo ends in:{" "}
				<b style={{ color: "white", WebkitTextStroke: "0px #000000" }}>
					{hypeTimer}
				</b>
				<br />
				<b style={{ color: "white", WebkitTextStroke: "0px #000000" }}>
					{currentHype}/{nextLevel}
				</b>{" "}
				SUBS TO ADD 1 MINUTE TO COMBO!!
			</div>
		);
	else return <div>Loading</div>;
};

export default HypeTimer;
