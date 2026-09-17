import React, { useState } from "react";
import {
	Accordion,
	AccordionItem,
	AccordionButton,
	AccordionPanel,
	AccordionIcon,
	Badge,
	Box,
	Button,
	HStack,
	Input,
	Text,
	Tooltip,
	VStack,
} from "@chakra-ui/react";
import { setConnection, startTwitchSubsDeviceAuth, setTwitchBot, startTwitchBotDeviceAuth, testTwitchBot } from "../../Api";

// green only when the server reports the connection is actually live; the only meaningful signal.
// tips spells out what each state actually proves so a hover explains the colour.
type Tips = { ok: string; notConnecting: string; notSetup: string };
function statusBadge(ok: boolean, configured: boolean, tips: Tips) {
	if (ok)
		return (
			<Tooltip label={tips.ok} hasArrow>
				<Badge colorScheme="green">working</Badge>
			</Tooltip>
		);
	if (configured)
		return (
			<Tooltip label={tips.notConnecting} hasArrow>
				<Badge colorScheme="yellow">not connecting</Badge>
			</Tooltip>
		);
	return (
		<Tooltip label={tips.notSetup} hasArrow>
			<Badge>not set up</Badge>
		</Tooltip>
	);
}

// human-readable age of a ms timestamp, recomputed each time the server pushes a sync (~5s)
function ago(ts?: number): string {
	if (!ts) return "";
	const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

// small grey "<label> <age>" line; renders nothing until we've actually seen the signal
const Fresh: React.FC<{ ts?: number; label: string }> = ({ ts, label }) =>
	ts ? (
		<Text fontSize="xs" color="gray.500">
			{label} {ago(ts)}
		</Text>
	) : null;

// red reason box, matching the fourthwall treatment — only shown when configured-but-not-working with a reason
const ErrorBox: React.FC<{ show: boolean; text: string }> = ({ show, text }) =>
	show && text ? (
		<Box bg="red.50" borderWidth="1px" borderColor="red.200" borderRadius="md" px={3} py={2}>
			<Text fontSize="sm" color="red.600">
				{text}
			</Text>
		</Box>
	) : null;

// youtube + kick only relay through streamlabs, so we can never prove them directly. the honest signal is "have we
// actually seen a real event from this platform yet": green + age once we have, otherwise "waiting" rather than a lie.
function relayBadge(slOk: boolean, name: string, ts?: number) {
	if (!slOk)
		return (
			<Tooltip label={`${name} events relay through Streamlabs, which isn't connected. Connect Streamlabs to enable them.`} hasArrow>
				<Badge>needs Streamlabs</Badge>
			</Tooltip>
		);
	if (ts)
		return (
			<Tooltip label={`Streamlabs is connected and ${name} events are arriving — last one ${ago(ts)}.`} hasArrow>
				<Badge colorScheme="green">via Streamlabs · {ago(ts)}</Badge>
			</Tooltip>
		);
	return (
		<Tooltip label={`Streamlabs is connected, but no ${name} event has arrived yet — so we can't confirm ${name} is linked in your Streamlabs account.`} hasArrow>
			<Badge colorScheme="yellow">relayed · no events yet</Badge>
		</Tooltip>
	);
}

const Connections: React.FC<{ ws: any; settings: any }> = ({ ws, settings }) => {
	const conns = settings.connections || {};
	const curChannel = (conns.twitch && conns.twitch.channel) || "";
	const twitchError = (conns.twitch && conns.twitch.error) || "";
	const slHasToken = !!(conns.streamlabs && conns.streamlabs.hasToken);
	const slError = (conns.streamlabs && conns.streamlabs.error) || "";
	const fwConfigured = !!(conns.fourthwall && conns.fourthwall.configured);
	const fwError = (conns.fourthwall && conns.fourthwall.error) || "";
	const fwLastOkAt = (conns.fourthwall && conns.fourthwall.lastOkAt) || 0;
	// active-sub reads are a separate twitch credential from chat: chat is anonymous, but helix/subscriptions
	// only answers the broadcaster's own authorized token
	const ts = conns.twitchSubs || {};
	const tsHasApp = !!ts.hasApp;
	const tsAuthorized = !!ts.authorized;
	const tsError = ts.error || "";
	const tsLastOkAt = ts.lastOkAt || 0;
	const [tsId, setTsId] = useState("");
	const [tsSecret, setTsSecret] = useState("");
	const tsPending = ts.pending || null; // a code the streamer still has to type in on twitch
	const tsLogin = ts.login || "";
	const lastEventAt = settings.lastEventAt || {};
	// the account the app speaks and moderates as. separate from everything above: chat is read anonymously,
	// but saying anything (or timing anyone out) needs an account, and timing out needs it to be a mod.
	const tb = conns.twitchBot || {};
	const tbHasApp = !!tb.hasApp;
	const tbSharedApp = !!tb.sharedApp;
	const tbAuthorized = !!tb.authorized;
	const tbPending = tb.pending || null;
	const tbLogin = tb.login || "";
	const tbError = tb.error || "";
	const [tbId, setTbId] = useState("");
	const [tbSecret, setTbSecret] = useState("");
	const [twitchChannel, setTwitchChannel] = useState("");
	const [slToken, setSlToken] = useState("");
	const [fwUser, setFwUser] = useState("");
	const [fwPass, setFwPass] = useState("");

	return (
		<Box textAlign="left">
			<Text color="gray.500" fontSize="sm" mb={3}>
				Set up which channels the timer watches. Changes apply immediately on the server.
			</Text>
			<Accordion allowMultiple defaultIndex={[0]}>
				<AccordionItem>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>Twitch</Text>
							{statusBadge(!!settings.twitchStatus, !!curChannel, {
								ok: "Connected to Twitch chat — chat commands, subs, and cheers are coming through live.",
								notConnecting: "A channel is set but the chat connection isn't live. See the reason below.",
								notSetup: "No Twitch channel set. Add one to watch its chat.",
							})}
							{settings.twitchStatus && <Fresh ts={lastEventAt.twitch} label="last event" />}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<VStack align="stretch" spacing={3}>
							<Text fontSize="sm" color="gray.600">
								Twitch channel whose chat to watch.
							</Text>
							<ErrorBox show={!!curChannel && !settings.twitchStatus} text={twitchError} />
							<HStack>
								<Input
									placeholder={curChannel || "channel name"}
									value={twitchChannel}
									onChange={(e) => setTwitchChannel(e.currentTarget.value)}
									width="320px"
								/>
								<Button
									colorScheme="purple"
									isDisabled={!twitchChannel.trim()}
									onClick={() => {
										setConnection(ws, "twitch", { channel: twitchChannel.trim() });
										setTwitchChannel("");
									}}
								>
									{curChannel ? "Update" : "Connect"}
								</Button>
							</HStack>
							{curChannel && (
								<Text fontSize="xs" color="gray.500">
									Currently watching: {curChannel}
								</Text>
							)}
						</VStack>
					</AccordionPanel>
				</AccordionItem>

				<AccordionItem>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>Streamlabs</Text>
							{statusBadge(!!settings.slStatus, slHasToken, {
								ok: "Streamlabs socket is live — donations and merch (and relayed YouTube/Kick events) come through here.",
								notConnecting: "A token is set but the socket isn't live — usually a bad/expired token or a dropped connection. See the reason below.",
								notSetup: "No Streamlabs socket token set.",
							})}
							{settings.slStatus && <Fresh ts={lastEventAt.streamlabs} label="last donation/merch" />}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<VStack align="stretch" spacing={3}>
							<Text fontSize="sm" color="gray.600">
								Streamlabs socket API token (donations + merch).
							</Text>
							<ErrorBox show={slHasToken && !settings.slStatus} text={slError} />
							<HStack>
								<Input
									type="password"
									placeholder={slHasToken ? "token set — paste to replace" : "paste socket token"}
									value={slToken}
									onChange={(e) => setSlToken(e.currentTarget.value)}
									width="320px"
								/>
								<Button
									colorScheme="purple"
									isDisabled={!slToken}
									onClick={() => {
										setConnection(ws, "streamlabs", { token: slToken });
										setSlToken("");
									}}
								>
									{slHasToken ? "Update" : "Connect"}
								</Button>
							</HStack>
							{slHasToken && (
								<Button
									size="xs"
									variant="link"
									colorScheme="purple"
									onClick={() => setConnection(ws, "streamlabs", { token: "" })}
								>
									disconnect
								</Button>
							)}
						</VStack>
					</AccordionPanel>
				</AccordionItem>

				<AccordionItem>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>YouTube</Text>
							{relayBadge(!!settings.slStatus, "YouTube", lastEventAt.youtube)}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<Text fontSize="sm" color="gray.600">
							YouTube Super Chats, Super Stickers, and memberships are relayed through your Streamlabs
							connection. Connect Streamlabs above (with your YouTube channel linked in Streamlabs) to
							enable them, then set their rates under Time Per Action.
						</Text>
					</AccordionPanel>
				</AccordionItem>
				<AccordionItem>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>Fourthwall</Text>
							{statusBadge(!!settings.fourthwallStatus, fwConfigured, {
								ok: "The last store poll succeeded with these credentials — orders, donations, and memberships are being watched.",
								notConnecting: "Credentials are set but the last poll failed (bad key or unreachable). See the reason below.",
								notSetup: "No Fourthwall API key set.",
							})}
							{settings.fourthwallStatus && <Fresh ts={fwLastOkAt} label="verified" />}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<VStack align="stretch" spacing={3}>
							<Text fontSize="sm" color="gray.600">
								Adds time for store purchases, donations, and memberships. Paste a Fourthwall API key
								(username + password from your Fourthwall dashboard); the server polls your store for new
								activity. The credentials are stored so polling can continue.
							</Text>
							<ErrorBox show={fwConfigured && !settings.fourthwallStatus} text={fwError} />
							<HStack>
								<Input
									placeholder="API username"
									value={fwUser}
									onChange={(e) => setFwUser(e.currentTarget.value)}
									width="200px"
								/>
								<Input
									type="password"
									placeholder="API password"
									value={fwPass}
									onChange={(e) => setFwPass(e.currentTarget.value)}
									width="200px"
								/>
								<Button
									colorScheme="purple"
									isDisabled={!fwUser.trim() || !fwPass}
									onClick={() => {
										setConnection(ws, "fourthwall", { username: fwUser.trim(), password: fwPass });
										setFwUser("");
										setFwPass("");
									}}
								>
									{fwConfigured ? "Reconnect" : "Connect"}
								</Button>
							</HStack>
							{fwConfigured && (
								<Button
									size="xs"
									variant="link"
									colorScheme="purple"
									onClick={() => setConnection(ws, "fourthwall", { disconnect: true })}
								>
									disconnect
								</Button>
							)}
						</VStack>
					</AccordionPanel>
				</AccordionItem>
				<AccordionItem>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>Twitch — active subs</Text>
							{statusBadge(!!settings.twitchSubsStatus, tsAuthorized, {
								ok: "The last read succeeded — the live active-sub count and sub points are current.",
								notConnecting: "Authorized, but the last read failed. See the reason below.",
								notSetup: "Not set up — the active-sub browser sources have no number to show.",
							})}
							{settings.twitchSubsStatus && <Fresh ts={tsLastOkAt} label="read" />}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<VStack align="stretch" spacing={3}>
							<Text fontSize="sm" color="gray.600">
								Powers the live <b>active subs</b> and <b>sub points</b> browser sources on the Subcounts
								tab. These rise and fall with real subscriber numbers, unlike the all-time tallies which
								only count up. Twitch only reports this to the broadcaster&apos;s own authorized token —
								there&apos;s no API key for it — so this needs a one-time approval on your channel.
								Nothing here adds time to the timer.
							</Text>
							<ErrorBox show={tsAuthorized && !settings.twitchSubsStatus} text={tsError} />
							<Box fontSize="sm" color="gray.600">
								<Text>
									<b>1.</b> At <Text as="code">dev.twitch.tv/console/apps</Text> register an application. Client
									type <b>must be Confidential</b> — a Public app&apos;s access expires after 30 days and
									the counts would stop mid-marathon. Twitch demands a redirect URL in the form; put
									anything valid there, e.g. <Text as="code">https://localhost</Text>, as this never uses it.
								</Text>
								<Text><b>2.</b> Paste its Client ID and a New Secret below and save.</Text>
								<Text><b>3.</b> Hit Authorize and type the code it shows into Twitch on any device.</Text>
							</Box>
							<HStack>
								<Input
									placeholder="Client ID"
									value={tsId}
									onChange={(e) => setTsId(e.currentTarget.value)}
									width="200px"
								/>
								<Input
									type="password"
									placeholder="Client Secret"
									value={tsSecret}
									onChange={(e) => setTsSecret(e.currentTarget.value)}
									width="200px"
								/>
								<Button
									colorScheme="purple"
									isDisabled={!tsId.trim() || !tsSecret}
									onClick={() => {
										setConnection(ws, "twitchsubs", { clientId: tsId.trim(), clientSecret: tsSecret });
										setTsId("");
										setTsSecret("");
									}}
								>
									Save app
								</Button>
							</HStack>
							{tsHasApp && !tsPending && (
								<HStack>
									<Button
										colorScheme="purple"
										variant="outline"
										size="sm"
										onClick={() => startTwitchSubsDeviceAuth(ws)}
									>
										{tsAuthorized ? "Re-authorize" : "Authorize"}
									</Button>
									<Text fontSize="xs" color="gray.500">
										{tsAuthorized && tsLogin ? `currently reading ${tsLogin}` : "gives you a code to enter on Twitch"}
									</Text>
								</HStack>
							)}
							{tsPending && (
								<Box borderWidth="1px" borderRadius="md" borderColor="purple.300" p={3}>
									<Text fontSize="sm" mb={2}>
										Go to{" "}
										<Text as="a" href={tsPending.verificationUri} target="_blank" rel="noreferrer"
											color="purple.300" textDecoration="underline">
											{tsPending.verificationUri.replace(/\?.*$/, "")}
										</Text>{" "}
										while signed in as the broadcaster, and enter this code:
									</Text>
									<Text fontSize="3xl" fontWeight={700} letterSpacing="0.2em" fontFamily="mono">
										{tsPending.userCode}
									</Text>
									<Text fontSize="xs" color="gray.500" mt={2}>
										Waiting for Twitch — this page picks it up on its own, no need to come back and click
										anything. The code stops working in about 30 minutes.
									</Text>
								</Box>
							)}
							{tsAuthorized && (
								<Button
									size="xs"
									variant="link"
									colorScheme="purple"
									onClick={() => setConnection(ws, "twitchsubs", { disconnect: true })}
								>
									disconnect
								</Button>
							)}
						</VStack>
					</AccordionPanel>
				</AccordionItem>
				<AccordionItem>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>Twitch — chat bot</Text>
							{statusBadge(tbAuthorized, tbHasApp, {
								ok: `Authorized as ${tbLogin || "the bot"} — it can talk in chat and run timeouts.`,
								notConnecting: "An app is set up, but the bot hasn't been authorized yet.",
								notSetup: "Not set up — prizes that talk or time people out will only report what they would have done.",
							})}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<VStack align="stretch" spacing={3}>
							<Text fontSize="sm" color="gray.600">
								The account this app <b>speaks and moderates as</b>. Reading chat needs nobody, but saying
								anything — or the Mystery Box&apos;s <b>Nuke</b> prize timing people out — needs an account,
								and timeouts need that account to be a <b>moderator</b> in the channel. Without this, those
								prizes report what they would have done and change nothing.
							</Text>
							<ErrorBox show={!!tbError} text={tbError} />
							<Box fontSize="sm" color="gray.600">
								<Text>
									<b>1.</b> In the channel&apos;s chat, the broadcaster types{" "}
									<Text as="code">/mod yourbotname</Text>.
								</Text>
								<Text>
									<b>2.</b> {tbSharedApp
										? "The Twitch app from the active-subs connection above will be used — leave the boxes below blank. (An app identifies this software, not an account, so sharing one is fine.)"
										: "Paste a Twitch app's Client ID and Secret below, or set up the active-subs connection above and this will share its app."}
								</Text>
								<Text><b>3.</b> Hit Authorize and enter the code it gives you.</Text>
								<Text color="orange.300" mt={1}>
									<b>Enter that code while logged into Twitch AS THE BOT</b> — use a private window. Twitch
									gives the access to whoever is signed in, so doing it on the broadcaster&apos;s login
									quietly authorizes the wrong account.
								</Text>
							</Box>
							<HStack>
								<Input
									placeholder={tbSharedApp ? "Client ID (optional — sharing the app above)" : "Client ID"}
									value={tbId}
									onChange={(e) => setTbId(e.currentTarget.value)}
									width="240px"
								/>
								<Input
									type="password"
									placeholder="Client Secret"
									value={tbSecret}
									onChange={(e) => setTbSecret(e.currentTarget.value)}
									width="200px"
								/>
								<Button
									colorScheme="purple"
									isDisabled={!tbId.trim() || !tbSecret}
									onClick={() => {
										setTwitchBot(ws, { clientId: tbId.trim(), clientSecret: tbSecret });
										setTbId("");
										setTbSecret("");
									}}
								>
									Save app
								</Button>
							</HStack>
							{tbHasApp && !tbPending && (
								<HStack>
									<Button
										colorScheme="purple"
										variant="outline"
										size="sm"
										onClick={() => startTwitchBotDeviceAuth(ws)}
									>
										{tbAuthorized ? "Re-authorize" : "Authorize"}
									</Button>
									{tbAuthorized && (
										<Button size="sm" variant="outline" onClick={() => testTwitchBot(ws)}>
											Test
										</Button>
									)}
									<Text fontSize="xs" color="gray.500">
										{tbAuthorized && tbLogin
											? `talking as ${tbLogin} — Test checks it's still a mod (result on the Terminal tab)`
											: "gives you a code to enter on Twitch, signed in as the bot"}
									</Text>
								</HStack>
							)}
							{tbPending && (
								<Box borderWidth="1px" borderRadius="md" borderColor="purple.300" p={3}>
									<Text fontSize="sm" mb={2}>
										Go to{" "}
										<Text as="a" href={tbPending.verificationUri} target="_blank" rel="noreferrer"
											color="purple.300" textDecoration="underline">
											{tbPending.verificationUri.replace(/\?.*$/, "")}
										</Text>{" "}
										<b>signed in as the bot account</b>, and enter this code:
									</Text>
									<Text fontSize="3xl" fontWeight={700} letterSpacing="0.2em" fontFamily="mono">
										{tbPending.userCode}
									</Text>
									<Text fontSize="xs" color="gray.500" mt={2}>
										Waiting for Twitch — this page picks it up on its own. The code stops working in about
										30 minutes.
									</Text>
								</Box>
							)}
							{tbAuthorized && (
								<Button
									size="xs"
									variant="link"
									colorScheme="purple"
									onClick={() => setTwitchBot(ws, { disconnect: true })}
								>
									disconnect
								</Button>
							)}
						</VStack>
					</AccordionPanel>
				</AccordionItem>
				<AccordionItem>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>Kick</Text>
							{relayBadge(!!settings.slStatus, "Kick", lastEventAt.kick)}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<Text fontSize="sm" color="gray.600">
							Kick subscriptions and gifted subs are relayed through your Streamlabs connection (with your
							Kick channel linked in Streamlabs). Connect Streamlabs above to enable them, then set their
							rates under Time Per Action. Kick tips arrive via the Streamlabs donation rate.
						</Text>
					</AccordionPanel>
				</AccordionItem>
			</Accordion>
		</Box>
	);
};

export default Connections;
