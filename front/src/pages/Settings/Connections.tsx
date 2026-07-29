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
import { setConnection, getTwitchSubsAuthUrl } from "../../Api";
import { BASE_URL } from "../../Consts";
import { REDIRECT_PATH } from "../TwitchAuth";

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
	// twitch matches this byte-for-byte, so it's editable rather than assumed: whichever address the streamer
	// actually opens the dashboard on has to be the one registered on the app. defaults to this origin.
	const [tsRedirect, setTsRedirect] = useState<string | null>(null);
	const tsRedirectValue = tsRedirect ?? (ts.redirectUri || `${BASE_URL}${REDIRECT_PATH}`);
	const lastEventAt = settings.lastEventAt || {};
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
								<Text><b>1.</b> At <Text as="code">dev.twitch.tv/console/apps</Text> register an application.</Text>
								<Text>
									<b>2.</b> Add the OAuth Redirect URL below to it, character for character. It must be the
									address the streamer actually opens this dashboard on — Twitch rejects the login if the
									two differ at all. An app can hold several redirect URLs, so add one per address you use.
								</Text>
								<Text><b>3.</b> Paste its Client ID and a New Secret below and save, then authorize.</Text>
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
							</HStack>
							<HStack>
								<Input
									placeholder="OAuth Redirect URL"
									value={tsRedirectValue}
									onChange={(e) => setTsRedirect(e.currentTarget.value)}
									width="408px"
									fontFamily="mono"
									fontSize="sm"
								/>
								<Button
									colorScheme="purple"
									isDisabled={!tsId.trim() || !tsSecret || !tsRedirectValue.trim()}
									onClick={() => {
										setConnection(ws, "twitchsubs", {
											clientId: tsId.trim(),
											clientSecret: tsSecret,
											redirectUri: tsRedirectValue.trim(),
										});
										setTsId("");
										setTsSecret("");
										setTsRedirect(null); // follow the stored value again
									}}
								>
									Save app
								</Button>
							</HStack>
							{tsHasApp && (
								<HStack>
									<Button
										colorScheme="purple"
										variant="outline"
										size="sm"
										onClick={() => getTwitchSubsAuthUrl(ws)}
									>
										{tsAuthorized ? "Re-authorize on Twitch" : "Authorize on Twitch"}
									</Button>
									<Text fontSize="xs" color="gray.500">
										opens Twitch, then comes back here
									</Text>
								</HStack>
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
