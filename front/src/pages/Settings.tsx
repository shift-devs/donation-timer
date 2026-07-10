import React, { useEffect, useRef, useState } from "react";
import Timer from "../Timer";
import * as consts from "../Consts";
import ChangeTime from "./Settings/ChangeTime";
import Merch from "./Settings/Merch";
import TimePerAction from "./Settings/TimePerAction";
import Controls from "./Settings/Controls";
import Terminal from "./Settings/Terminal";
import Connections from "./Settings/Connections";
import TimerEvents from "./Settings/TimerEvents";
import { runCommand } from "../Api";
import { useCountdownSeconds } from "../useCountdown";
import { Navigate } from "react-router-dom";
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

let ws: WebSocket;
let reconnectTimer: any;
const LOG_CAP = 2000; // keep the live feed bounded — a dashboard tab can stay open for weeks

const Settings: React.FC = () => {
	const token = localStorage.getItem("identity");
	const [settings, setSettings] = useState({ slStatus: false });
	const [endTime, setEndTime] = useState(0);
	const seconds = useCountdownSeconds(endTime);
	const [fetched, setFetched] = useState(false);
	const [log, setLog] = useState<any[]>([]);
	const [logHasMore, setLogHasMore] = useState(false);
	const [tabIndex, setTabIndex] = useState(0);
	const logLoadingRef = useRef(false);
	const logRequestedRef = useRef(false);

	const updateSeconds = (endTime: number) => {
		console.log(`Force syncing endtime to ${endTime}`);
		setEndTime(endTime);
	};

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack (the old CPU-spin failure mode)
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=settings`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			console.log(`received ${event.data}`);

			if ("logPage" in response) {
				logLoadingRef.current = false;
				if (response.before == null) {
					setLog(response.logPage);
				} else {
					setLog((prev) => [...response.logPage, ...prev]);
				}
				setLogHasMore(response.hasMore);
				return;
			}
			if ("logEntry" in response) {
				setLog((prev) => [...prev, response.logEntry].slice(-LOG_CAP));
				return;
			}
			if ("commandResult" in response) {
				const cr = response.commandResult;
				setLog((prev) => [...prev, { t: Date.now(), line: cr.message, kind: cr.ok ? "ok" : "err" }].slice(-LOG_CAP));
				return;
			}

			setSettings(response);

			if ("endTime" in response) {
				updateSeconds(response.endTime);
				if (!fetched) {
					setFetched(true);
				}
				if (!logRequestedRef.current) {
					logRequestedRef.current = true;
					ws.send(JSON.stringify({ event: "getLogPage" }));
				}
				// no separate force-sync interval needed: the 1s countdown derives from endTime each tick (below)
			} else if ("error" in response) {
				localStorage.removeItem("identity");
				window.location.href = "/login";
			}
		};

		ws.onclose = (event) => {
			setFetched(false);
			logRequestedRef.current = false;
			console.log(
				`socket closed, attempting reconnect in 5 seconds... (${event.reason})`
			);
			clearTimeout(reconnectTimer); // never let reconnects stack
			reconnectTimer = setTimeout(connectWs, 5000);
		};

		ws.onerror = (event) => {
			console.error(`socket encountered error: ${event} - closing socket`);
			ws.close();
		};
	};

	useEffect(() => {
		if (!token) return;
		connectWs();
		return () => {
			clearTimeout(reconnectTimer);
			if (ws) {
				ws.onclose = ws.onmessage = ws.onerror = null; // don't reconnect after unmount
				ws.close();
			}
		};
	}, []);

	const loadOlder = () => {
		if (!logHasMore || logLoadingRef.current) return;
		// command-feed lines have no id; page from the oldest real log entry
		const firstWithId = log.find((e) => e.id != null);
		const cursor = firstWithId ? firstWithId.id : null;
		if (cursor == null) return;
		if (!ws || ws.readyState !== WebSocket.OPEN) return; // mid-reconnect; don't send/wedge the loading flag
		logLoadingRef.current = true;
		ws.send(JSON.stringify({ event: "getLogPage", before: cursor }));
	};

	const runTerminalCommand = (cmd: string) => {
		setLog((prev) => [...prev, { t: Date.now(), line: "> " + cmd, kind: "input" }].slice(-LOG_CAP));
		runCommand(ws, cmd);
	};

	if (!token) return <Navigate to="/login" replace />;

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
					index={tabIndex}
					onChange={setTabIndex}
					display='flex'
					flexDirection='column'
					flex='1'
					minH={0}
					overflow='hidden'
				>
					<TabList>
						<Tab>Time Per Action</Tab>
						<Tab>Timer Events</Tab>
						<Tab>Connections</Tab>
						<Tab>Merch</Tab>
						<Tab>Change Time</Tab>
						<Tab>Terminal</Tab>
						<Tab>Settings</Tab>
					</TabList>
					<TabPanels flex='1' overflowY='auto' minH={0}>
						<TabPanel>
							<TimePerAction ws={ws} settings={settings} />
						</TabPanel>
						<TabPanel>
							<TimerEvents ws={ws} settings={settings} />
						</TabPanel>
						<TabPanel>
							<Connections ws={ws} settings={settings} />
						</TabPanel>
						<TabPanel>
							<Merch ws={ws} endTime={endTime} settings={settings} />
						</TabPanel>
						<TabPanel>
							<ChangeTime ws={ws} endTime={endTime} settings={settings} />
						</TabPanel>
						<TabPanel>
							<Terminal
								entries={log}
								hasMore={logHasMore}
								active={tabIndex === 5}
								onLoadOlder={loadOlder}
								onCommand={runTerminalCommand}
							/>
						</TabPanel>
						<TabPanel>
							<Controls ws={ws} token={token} baseUrl={BASE_URL} settings={settings} />
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
