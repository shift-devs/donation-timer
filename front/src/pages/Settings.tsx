import React, { useEffect, useState } from "react";
import ConnectivitySettings from "./Settings/Connectivity";
import Timer from "../Timer";
import * as consts from "../Consts";
import TimingSettings from "./Settings/TimingSettings";
import ChangeTime from "./Settings/ChangeTime";
import Merch from "./Settings/Merch";
import {
	Spinner,
	Tabs,
	TabList,
	TabPanels,
	Tab,
	TabPanel,
	Button,
	Center,
} from "@chakra-ui/react";
import { setCap, setAnon } from "../Api";

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
	const [capStatus, setCapStatus] = useState("Enable 30h cap");
	const [anonStatus, setAnonStatus] = useState("Ignore Anonymous Giftsubs");

	const toggleCap = () => {
		if (capStatus === "Enable 30h cap") {
			setCap(ws, true);
		} else {
			setCap(ws, false);
		}
	};

	const toggleAnon = () => {
		if (anonStatus === "Ignore Anonymous Giftsubs") {
			setAnon(ws, true);
		} else {
			setAnon(ws, false);
		}
	};
	
	const updateSeconds = (endTime: number) => {
		let tempSeconds = Math.round(endTime - new Date().getTime() / 1000);
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
				if (response.cap) setCapStatus("Disable 30h cap");
				else setCapStatus("Enable 30h cap");
				if (response.anon) setAnonStatus("Unignore Anonymous Giftsubs")
				else setAnonStatus("Ignore Anonymous Giftsubs");
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
					margin: "auto",
					textAlign: "center",
					width: "100%",
					marginTop: "0%",
				}}
			>
				<Timer input_seconds={seconds} textAlign='center' />
				<br />
				<Tabs>
					<TabList>
						<Tab>Timer Settings</Tab>
						<Tab>Connect Streamlabs</Tab>
						<Tab>Change Time</Tab>
						<Tab>Merch</Tab>
					</TabList>
					<br />
					<br />
					<TabPanels>
						<TabPanel>
							<TimingSettings ws={ws} input_settings={settings} />
						</TabPanel>
						<TabPanel>
							<ConnectivitySettings ws={ws} status={settings.slStatus} />
						</TabPanel>
						<TabPanel>
							<ChangeTime ws={ws} endTime={endTime} />
						</TabPanel>
						<TabPanel>
							<Merch ws={ws} endTime={endTime} settings={settings} />
						</TabPanel>
					</TabPanels>
				</Tabs>
				<Center>
					<Button
						colorScheme='purple'
						onClick={() => {
							navigator.clipboard.writeText(
								`${BASE_URL}/widget?token=${token}`
							);
						}}
					>
						Copy widget URL
					</Button>
					&nbsp;
					<Button
						colorScheme='purple'
						onClick={() => {
							navigator.clipboard.writeText(
								`${BASE_URL}/hypetimer?token=${token}`
							);
						}}
					>
						Copy hype URL
					</Button>
					&nbsp;
					<Button
						colorScheme='purple'
						onClick={() => {
							navigator.clipboard.writeText(
								`${BASE_URL}/timetiers?token=${token}`
							);
						}}
					>
						Copy timer tiers URL
					</Button>
					&nbsp;
					<Button
						colorScheme='purple'
						onClick={() => {
							navigator.clipboard.writeText(
								`${BASE_URL}/dollartime?token=${token}`
							);
						}}
					>
						Copy dollar time URL
					</Button>
					&nbsp;
					<Button
						colorScheme='purple'
						onClick={() => {
							toggleCap();
						}}
					>
						{capStatus}
					</Button>
					&nbsp;
					<Button
						colorScheme='purple'
						onClick={() => {
							toggleAnon();
						}}
					>
						{anonStatus}
					</Button>
				</Center>
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
