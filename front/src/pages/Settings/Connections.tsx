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
	VStack,
} from "@chakra-ui/react";
import { setConnection } from "../../Api";

// green only when the server reports the connection is actually live; the only meaningful signal
function statusBadge(ok: boolean, configured: boolean) {
	if (ok) return <Badge colorScheme="green">working</Badge>;
	if (configured) return <Badge colorScheme="yellow">not connecting</Badge>;
	return <Badge>not set up</Badge>;
}

const Connections: React.FC<{ ws: any; settings: any }> = ({ ws, settings }) => {
	const conns = settings.connections || {};
	const curChannel = (conns.twitch && conns.twitch.channel) || "";
	const slHasToken = !!(conns.streamlabs && conns.streamlabs.hasToken);
	const fwConfigured = !!(conns.fourthwall && conns.fourthwall.configured);
	const fwError = (conns.fourthwall && conns.fourthwall.error) || "";
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
							{statusBadge(!!settings.twitchStatus, !!curChannel)}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<VStack align="stretch" spacing={3}>
							<Text fontSize="sm" color="gray.600">
								Twitch channel whose chat to watch.
							</Text>
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
							{statusBadge(!!settings.slStatus, slHasToken)}
						</HStack>
						<AccordionIcon />
					</AccordionButton>
					<AccordionPanel pb={4}>
						<VStack align="stretch" spacing={3}>
							<Text fontSize="sm" color="gray.600">
								Streamlabs socket API token (donations + merch).
							</Text>
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
							{settings.slStatus ? (
								<Badge colorScheme="green">via Streamlabs</Badge>
							) : (
								<Badge>needs Streamlabs</Badge>
							)}
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
							{statusBadge(!!settings.fourthwallStatus, fwConfigured)}
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
							{fwConfigured && !settings.fourthwallStatus && fwError && (
								<Box bg="red.50" borderWidth="1px" borderColor="red.200" borderRadius="md" px={3} py={2}>
									<Text fontSize="sm" color="red.600">
										{fwError}
									</Text>
								</Box>
							)}
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
				<AccordionItem isDisabled>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>Kick</Text>
							<Badge>coming soon</Badge>
						</HStack>
						<AccordionIcon />
					</AccordionButton>
				</AccordionItem>
			</Accordion>
		</Box>
	);
};

export default Connections;
