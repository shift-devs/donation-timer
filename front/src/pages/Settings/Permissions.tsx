import React from "react";
import { Badge, Box, Code, Flex, Switch, Text } from "@chakra-ui/react";
import { setChatPermissions } from "../../Api";

// the switches, in the order they're listed. the keys MUST match back/src/chatPermissions.ts
const GROUPS: { key: string; label: string; commands: string[]; hint: string }[] = [
	{ key: "time", label: "Add or remove time", commands: ["!addtime", "!time"], hint: "Straight seconds on or off the clock — a negative number takes time away." },
	{ key: "subs", label: "Subs and memberships", commands: ["!addsub", "!twitch sub_t1", "!youtube membership_…", "!kick subscription"], hint: "Time as if subs or members came in, at your Time Per Action rates." },
	{ key: "bits", label: "Bits", commands: ["!twitch bits"], hint: "Time as if a cheer came in." },
	{ key: "money", label: "Donations and orders", commands: ["!addmoney", "!streamlabs donation", "!youtube superchat", "!fourthwall order"], hint: "Time as if money came in." },
	{ key: "text", label: "Text boxes", commands: ["!changetext"], hint: "The words on the /text browser sources." },
	{ key: "firesale", label: "Firesale", commands: ["!firesale start", "stop", "draw", "winner"], hint: "Driving the giveaway overlay by hand. Fourthwall's own announcements and chat's !enter still work either way." },
	{ key: "raffle", label: "Raffle", commands: ["!raffle start", "draw", "stop"], hint: "Running the raffle. Entering it is open to everyone either way." },
	{ key: "mb", label: "Mystery box controls", commands: ["!mb give", "take", "stop", "test", "revive"], hint: "Handing out and taking back boxes, rehearsing prizes, the quick revive. Opening your own box and !mb count stay open to everyone." },
	{ key: "drop", label: "Drops", commands: ["!drop", "!drop test", "!drop stop", "clear", "status"], hint: "Putting a drop up or calling one off. Drops from contributions keep happening on their own." },
];

// which ! commands twitch mods may use in chat. applies immediately — no Save.
const Permissions: React.FC<{ ws: any; settings: any }> = ({ ws, settings }) => {
	const perms = settings.chatPermissions || {};

	return (
		<Box maxW="900px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={3}>
				Which <b>!</b> commands your Twitch mods can use in chat. Switch a group off and mods typing it get nothing —
				the Terminal shows who tried. The broadcaster can always use all of them, and the Terminal tab and the
				buttons on the other tabs aren&apos;t affected.
			</Text>
			<Box borderWidth="1px" borderRadius="md" p={3}>
				{GROUPS.map((g, i) => (
					<Box key={g.key} py={2} borderTopWidth={i ? "1px" : 0}>
						<Flex align="center" gap={3}>
							<Switch isChecked={!!perms[g.key]} onChange={(e) => setChatPermissions(ws, { [g.key]: e.target.checked })} />
							<Text fontWeight="semibold">{g.label}</Text>
							{!perms[g.key] && <Badge colorScheme="red">mods can&apos;t</Badge>}
						</Flex>
						<Flex gap={1} wrap="wrap" mt={1} ml="46px">
							{g.commands.map((c) => <Code key={c} fontSize="xs">{c}</Code>)}
						</Flex>
						<Text fontSize="xs" color="gray.500" mt={1} ml="46px">{g.hint}</Text>
					</Box>
				))}
			</Box>
		</Box>
	);
};

export default Permissions;
