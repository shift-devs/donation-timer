import React, { useEffect, useState } from "react";
import Timer from "../Timer";
import * as consts from "../Consts";
import ChangeTime from "./Settings/ChangeTime";
import Merch from "./Settings/Merch";
import TimePerAction from "./Settings/TimePerAction";
import Controls from "./Settings/Controls";
import {
	Spinner,
	Tabs,
	TabList,
	TabPanels,
	Tab,
	TabPanel,
} from "@chakra-ui/react";

const WS_URL = consts.WS_URL;
const BASE_URL = consts.BASE_URL;
const token = new URLSearchParams(window.location.search).get("token");

let ws: WebSocket;
let forceSync: any;

const Settings: React.FC = () => {
	const [settings, setSettings] = useState({ slStatus: false });
	const [seconds, setSeconds] = useState(0);
	const [endTime, setEndTime] = useState(0);
	const [fetched, setFetched] = useState(false);

	const updateSeconds = (endTime: number) => {
		let tempSeconds = Math.round((endTime - Date.now()) / 1000);
		tempSeconds = tempSeconds >= 0 ? tempSeconds : 0;
		console.log(
			`Force syncing endtime to ${endTime} and seconds to ${
				tempSeconds
			} `
		);
		setEndTime(endTime);
		setSeconds(tempSeconds);
	};

	const connectWs = () => {
		ws = new WebSocket(`${WS_URL}?token=${token}&page=settings`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			console.log(`received ${event.data}`);
			setSettings(response);

			if ("endTime" in response) {
				updateSeconds(response.endTime);
				if (!fetched) {
					setFetched(true);
				}
				if (!forceSync)
					forceSync = setInterval(
						() => updateSeconds(response.endTime),
						10 * 1000
					);
				else {
					clearInterval(forceSync);
					forceSync = setInterval(
						() => updateSeconds(response.endTime),
						10 * 1000
					);
				}
			} else if ("error" in response) {
				alert(`error: ${response.error}`);
			}
		};

		ws.onclose = (event) => {
			setFetched(false);
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
		const interval = setTimeout(() => {
			if (seconds > 0) {
				setSeconds((prev) => prev - 1);
			}
		}, 1000);
		return () => {
			clearTimeout(interval);
		}
	},[seconds]);

	if (fetched)
		return (
			<div
				style={{
					height: "100vh",
					display: "flex",
					flexDirection: "column",
					textAlign: "center",
					width: "100%",
					overflow: "hidden",
				}}
			>
				<Timer input_seconds={seconds} textAlign='center' />
				<br />
				<Tabs
					display='flex'
					flexDirection='column'
					flex='1'
					minH={0}
					overflow='hidden'
				>
					<TabList>
						<Tab>Time Per Action</Tab>
						<Tab>Controls</Tab>
						<Tab>Change Time</Tab>
						<Tab>Merch</Tab>
					</TabList>
					<TabPanels flex='1' overflowY='auto' minH={0}>
						<TabPanel>
							<TimePerAction ws={ws} settings={settings} />
						</TabPanel>
						<TabPanel>
							<Controls ws={ws} token={token} baseUrl={BASE_URL} settings={settings} />
						</TabPanel>
						<TabPanel>
							<ChangeTime ws={ws} endTime={endTime} settings={settings} />
						</TabPanel>
						<TabPanel>
							<Merch ws={ws} endTime={endTime} settings={settings} />
						</TabPanel>
					</TabPanels>
				</Tabs>
			</div>
		);

	return (
		<div
			style={{
				margin: "auto",
				textAlign: "center",
				width: "50%",
				marginTop: "3%",
			}}
		>
			<Spinner
				thickness='4px'
				speed='0.65s'
				emptyColor='gray.200'
				color='blue.500'
				size='xl'
			></Spinner>
			<br />
			Loading
		</div>
	);
};

export default Settings;
