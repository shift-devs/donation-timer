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
	const [twitchChannel, setTwitchChannel] = useState("");
	const [slToken, setSlToken] = useState("");

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

				<AccordionItem isDisabled>
					<AccordionButton>
						<HStack flex="1" textAlign="left">
							<Text fontWeight={600}>YouTube</Text>
							<Badge>coming soon</Badge>
						</HStack>
						<AccordionIcon />
					</AccordionButton>
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
