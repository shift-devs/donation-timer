import React, { useEffect, useRef, useState } from "react";
import Timer from "../Timer";
import * as consts from "../Consts";
import ChangeTime from "./Settings/ChangeTime";
import Merch from "./Settings/Merch";
import TimePerAction from "./Settings/TimePerAction";
import Controls from "./Settings/Controls";
import Terminal from "./Settings/Terminal";
import Connections from "./Settings/Connections";
import Events from "./Settings/Events";
import FourthwallProducts from "./Settings/FourthwallProducts";
import SubCounts from "./Settings/SubCounts";
import TextBoxes from "./Settings/TextBoxes";
import Firesale from "./Settings/Firesale";
import Raffle from "./Settings/Raffle";
import Drops from "./Settings/Drops";
import MysteryBox from "./Settings/MysteryBox";
import WonderBox from "./Settings/WonderBox";
import BoxBoard from "./Settings/BoxBoard";
import Permissions from "./Settings/Permissions";
import { runCommand } from "../Api";
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

let ws: WebSocket;
let reconnectTimer: any;
const LOG_CAP = 2000; // keep the live feed bounded — a dashboard tab can stay open for weeks

// a tab panel that only re-renders while it's the one on screen. the panels stay mounted (keepMounted — an
// unmounted tab would drop its half-typed drafts), but without this every hidden tab re-rendered on every
// sync, every log line and every countdown tick, so the cost of one tab grew with how many had been opened.
// when a tab comes back into view it re-renders once with whatever is current. it also renders once on the way
// OUT, so a tab that reacts to being hidden (the Terminal's scroll-to-bottom on open) sees that change.
const ActivePanel = React.memo(
	({ children }: { active: boolean; children: React.ReactNode }) => <>{children}</>,
	(prev, next) => !prev.active && !next.active,
);
ActivePanel.displayName = "ActivePanel";

const Settings: React.FC = () => {
	const token = localStorage.getItem("identity");
	const [settings, setSettings] = useState({ slStatus: false });
	const [endTime, setEndTime] = useState(0);
	const [fetched, setFetched] = useState(false);
	const [log, setLog] = useState<any[]>([]);
	const [logHasMore, setLogHasMore] = useState(false);
	const [tabIndex, setTabIndex] = useState(0);
	const [firesale, setFiresale] = useState<any>(null);
	const [raffle, setRaffle] = useState<any>(null);
	const [mysterybox, setMysterybox] = useState<any>(null);
	const [quickRevive, setQuickRevive] = useState<any>(null);
	const [fwProducts, setFwProducts] = useState<any[] | null>(null);
	const [fwProductsError, setFwProductsError] = useState("");
	const logLoadingRef = useRef(false);
	const logRequestedRef = useRef(false);
	const fwProductsRequestedRef = useRef(false);
	// the server sends the whole settings blob every 5s and after every change, as freshly parsed objects. the
	// last JSON seen for each field lets an unchanged field keep its old object, so the memos below it hold —
	// and a sync where nothing changed at all doesn't re-render anything.
	const lastJson = useRef<{ [key: string]: string }>({});
	const settingsRef = useRef<any>(settings);
	const changed = (name: string, value: any) => {
		const json = JSON.stringify(value === undefined ? null : value);
		if (lastJson.current[name] === json)
			return false;
		lastJson.current[name] = json;
		return true;
	};
	const applySync = (response: any) => {
		const prev = settingsRef.current;
		const next: any = {};
		let same = Object.keys(prev).length === Object.keys(response).length;
		for (const key of Object.keys(response)) {
			if (!changed("s." + key, response[key]) && key in prev) {
				next[key] = prev[key];
			} else {
				next[key] = response[key];
				same = false;
			}
		}
		if (same)
			return;
		settingsRef.current = next;
		setSettings(next);
	};

	const updateSeconds = (endTime: number) => {
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
			if ("fwProducts" in response) {
				setFwProducts(Array.isArray(response.fwProducts) ? response.fwProducts : []);
				setFwProductsError(response.fwProductsError || "");
				return;
			}

			// the live giveaway. it arrives two ways: on the sync (alongside everything else) and as a targeted
			// push the moment it changes, which carries ONLY this field — so that one has to be taken out here
			// before setSettings below would replace the whole settings object with it.
			if ("firesale" in response) {
				if (changed("firesale", response.firesale))
					setFiresale(response.firesale);
				if (!("endTime" in response))
					return;
			}

			// the raffle, same two routes as the firesale
			if ("raffle" in response) {
				if (changed("raffle", response.raffle))
					setRaffle(response.raffle);
				if (!("endTime" in response))
					return;
			}

			// the box being opened right now, same two arrival routes as the firesale above — and taken out
			// here for the same reason, so a targeted push can't replace the whole settings object with it
			if ("mysterybox" in response) {
				if (changed("mysterybox", response.mysterybox))
					setMysterybox(response.mysterybox);
				if (!("endTime" in response))
					return;
			}

			// the quick revive challenge, same two routes again
			if ("quickRevive" in response) {
				if (changed("quickRevive", response.quickRevive))
					setQuickRevive(response.quickRevive);
				if (!("endTime" in response))
					return;
			}

			if ("endTime" in response) {
				applySync(response);
			} else {
				lastJson.current = {};
				settingsRef.current = response;
				setSettings(response);
			}

			if ("endTime" in response) {
				updateSeconds(response.endTime);
				if (!fetched) {
					setFetched(true);
				}
				if (!logRequestedRef.current) {
					logRequestedRef.current = true;
					ws.send(JSON.stringify({ event: "getLogPage" }));
				}
				// load the product list once per connection, and only when fourthwall creds exist
				if (!fwProductsRequestedRef.current && response.connections && response.connections.fourthwall && response.connections.fourthwall.configured) {
					fwProductsRequestedRef.current = true;
					ws.send(JSON.stringify({ event: "getFwProducts" }));
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
			fwProductsRequestedRef.current = false;
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
				<Timer
					endTime={endTime}
					pausedMs={(settings as any).timerPause ? (settings as any).timerPause.remainingMs : null}
					pausedColor={((settings as any).timerPause && (settings as any).timerPause.color) || ""}
					pausedPulse={!!((settings as any).timerPause && (settings as any).timerPause.pulse)}
					peakHour={Number((settings as any).widgetSettings && (settings as any).widgetSettings.peakHour) || 0}
					peakColor={(settings as any).widgetSettings && (settings as any).widgetSettings.peakEnabled ? String((settings as any).widgetSettings.peakColor || "") : ""}
					textAlign='center'
				/>
				<br />
				<Tabs
					index={tabIndex}
					onChange={setTabIndex}
					isLazy
					lazyBehavior='keepMounted'
					display='flex'
					flexDirection='column'
					flex='1'
					minH={0}
					overflow='hidden'
				>
					<TabList>
						<Tab>Time Per Action</Tab>
						<Tab>Events</Tab>
						<Tab>Connections</Tab>
						<Tab>Merch</Tab>
						<Tab>Fourthwall</Tab>
						<Tab>Change Time</Tab>
						<Tab>Terminal</Tab>
						<Tab>Subcounts</Tab>
						<Tab>Text Boxes</Tab>
						<Tab>Firesale</Tab>
						<Tab>Raffle</Tab>
						<Tab>Mystery Box</Tab>
						<Tab>Wonder Box</Tab>
						<Tab>Drops</Tab>
						<Tab>Box Board</Tab>
						<Tab>Permissions</Tab>
						<Tab>Settings</Tab>
					</TabList>
					<TabPanels flex='1' overflowY='auto' minH={0}>
						<TabPanel>
							<ActivePanel active={tabIndex === 0}><TimePerAction ws={ws} settings={settings} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 1}><Events ws={ws} settings={settings} products={fwProducts} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 2}><Connections ws={ws} settings={settings} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 3}><Merch ws={ws} endTime={endTime} settings={settings} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 4}><FourthwallProducts ws={ws} settings={settings} products={fwProducts} error={fwProductsError} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 5}><ChangeTime ws={ws} endTime={endTime} settings={settings} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 6}><Terminal
								entries={log}
								hasMore={logHasMore}
								active={tabIndex === 6}
								onLoadOlder={loadOlder}
								onCommand={runTerminalCommand}
							/></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 7}><SubCounts ws={ws} token={token} settings={settings} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 8}><TextBoxes ws={ws} token={token} settings={settings} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 9}><Firesale ws={ws} token={token} settings={settings} run={firesale} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 10}><Raffle ws={ws} token={token} settings={settings} run={raffle} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 11}><MysteryBox ws={ws} token={token} settings={settings} run={mysterybox} revive={quickRevive} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 12}><WonderBox ws={ws} settings={settings} run={mysterybox} products={fwProducts} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 13}><Drops ws={ws} token={token} settings={settings} revive={quickRevive} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 14}><BoxBoard ws={ws} token={token} settings={settings} products={fwProducts} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 15}><Permissions ws={ws} settings={settings} /></ActivePanel>
						</TabPanel>
						<TabPanel>
							<ActivePanel active={tabIndex === 16}><Controls ws={ws} token={token} settings={settings} /></ActivePanel>
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
