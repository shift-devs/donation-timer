import React, { useState } from "react";
import { Badge, Box, Button, Code, Flex, Heading, Input, Switch, Tag, TagCloseButton, TagLabel, Text } from "@chakra-ui/react";
import { setChatPermissions } from "../../Api";

type Entry = { key: string; label: string; commands: string[]; hint: string };

// the entries, in the order they're listed. the keys MUST match back/src/chatPermissions.ts
const SECTIONS: { title: string; entries: Entry[] }[] = [
	{
		title: "Timer",
		entries: [
			{ key: "time", label: "Add or remove time", commands: ["!addtime", "!time"], hint: "Straight seconds on or off the clock — a negative number takes time away." },
			{ key: "subs", label: "Subs and memberships", commands: ["!addsub", "!twitch sub_t1", "!youtube membership_…", "!kick subscription"], hint: "Time as if subs or members came in, at your Time Per Action rates." },
			{ key: "bits", label: "Bits", commands: ["!twitch bits"], hint: "Time as if a cheer came in." },
			{ key: "money", label: "Donations and orders", commands: ["!addmoney", "!streamlabs donation", "!youtube superchat", "!fourthwall order"], hint: "Time as if money came in." },
		],
	},
	{
		title: "Overlays and giveaways",
		entries: [
			{ key: "text", label: "Text boxes", commands: ["!changetext"], hint: "The words on the /text browser sources." },
			{ key: "firesale", label: "Firesale", commands: ["!firesale start", "stop", "draw", "winner"], hint: "Driving the giveaway overlay by hand. Fourthwall's own announcements and chat's !enter still work either way." },
			{ key: "raffle", label: "Raffle", commands: ["!raffle start", "draw", "stop"], hint: "Running the raffle. Entering it is open to everyone either way." },
			{ key: "drop", label: "Drops", commands: ["!drop", "!drop test", "!drop stop", "clear", "status"], hint: "Putting a drop up or calling one off. Drops from contributions keep happening on their own." },
		],
	},
	{
		title: "Mystery box",
		entries: [
			{ key: "mb_give", label: "Give boxes", commands: ["!mb give <name> [count]"], hint: "Hands someone mystery boxes for free. Worth keeping to a short list of mods." },
			{ key: "mb_take", label: "Take boxes back", commands: ["!mb take <name> [count]"], hint: "Removes boxes someone is holding." },
			{ key: "mb_stop", label: "Clear the overlay", commands: ["!mb stop"], hint: "Takes a box that's mid-spin off the screen." },
			{ key: "mb_test", label: "Test a prize", commands: ["!mb test [prize]"], hint: "Runs a prize for real without spending anybody's box." },
			{ key: "mb_revive", label: "Quick revive", commands: ["!mb revive", "!mb revive stop"], hint: "Starts or calls off the quick revive." },
		],
	},
];

const LOGIN = /^[a-z0-9_]{1,25}$/;

const PermissionRow: React.FC<{ ws: any; entry: Entry; perm: { on: boolean; mods: string[] } }> = ({ ws, entry, perm }) => {
	const [draft, setDraft] = useState("");
	const mods = perm.mods || [];

	const setMods = (next: string[]) => setChatPermissions(ws, { [entry.key]: { mods: next } });
	const add = () => {
		const names = draft.split(/[\s,]+/).map((n) => n.trim().replace(/^@/, "").toLowerCase()).filter((n) => LOGIN.test(n));
		if (names.length)
			setMods([...mods, ...names.filter((n) => !mods.includes(n))]);
		setDraft("");
	};

	return (
		<Box py={2}>
			<Flex align="center" gap={3}>
				<Switch isChecked={perm.on} onChange={(e) => setChatPermissions(ws, { [entry.key]: { on: e.target.checked } })} />
				<Text fontWeight="semibold">{entry.label}</Text>
				{!perm.on
					? <Badge colorScheme="red">mods can&apos;t</Badge>
					: mods.length
						? <Badge colorScheme="purple">{mods.length} mod{mods.length === 1 ? "" : "s"} only</Badge>
						: <Badge colorScheme="green">all mods</Badge>}
			</Flex>
			<Box ml="46px">
				<Flex gap={1} wrap="wrap" mt={1}>
					{entry.commands.map((c) => <Code key={c} fontSize="xs">{c}</Code>)}
				</Flex>
				<Text fontSize="xs" color="gray.500" mt={1}>{entry.hint}</Text>
				{perm.on && (
					<Box mt={2}>
						<Flex gap={1} wrap="wrap" align="center" mb={mods.length ? 2 : 0}>
							{mods.map((m) => (
								<Tag key={m} size="sm" colorScheme="purple">
									<TagLabel>{m}</TagLabel>
									<TagCloseButton onClick={() => setMods(mods.filter((x) => x !== m))} />
								</Tag>
							))}
						</Flex>
						<Flex gap={2} maxW="420px">
							<Input
								size="sm"
								placeholder="Limit to these mods (Twitch usernames)"
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Enter") add(); }}
							/>
							<Button size="sm" onClick={add} isDisabled={!draft.trim()}>Add</Button>
						</Flex>
					</Box>
				)}
			</Box>
		</Box>
	);
};

// which ! commands twitch mods may use in chat, and which mods. applies immediately — no Save.
const Permissions: React.FC<{ ws: any; settings: any }> = ({ ws, settings }) => {
	const perms = settings.chatPermissions || {};

	return (
		<Box maxW="900px" mx="auto" textAlign="left">
			<Text fontSize="sm" color="gray.600" mb={3}>
				Which <b>!</b> commands your Twitch mods can use in chat. Switch one off and no mod can use it. Leave it on
				with no names listed and every mod can; add names and only those mods can. Refused commands get nothing in
				chat — the Terminal shows who tried. The broadcaster can always use all of them, and the Terminal tab and
				the buttons on the other tabs aren&apos;t affected.
			</Text>
			{SECTIONS.map((s) => (
				<Box key={s.title} mb={4}>
					<Heading size="sm" mb={2}>{s.title}</Heading>
					<Box borderWidth="1px" borderRadius="md" px={3} py={1}>
						{s.entries.map((entry, i) => (
							<Box key={entry.key} borderTopWidth={i ? "1px" : 0}>
								<PermissionRow ws={ws} entry={entry} perm={perms[entry.key] || { on: false, mods: [] }} />
							</Box>
						))}
					</Box>
				</Box>
			))}
			<Text fontSize="xs" color="gray.500">
				Opening your own box (<Code fontSize="xs">!mb open</Code>), <Code fontSize="xs">!mb count</Code>,{" "}
				<Code fontSize="xs">!enter</Code> and <Code fontSize="xs">!raygun</Code> are open to everyone and aren&apos;t listed here.
			</Text>
		</Box>
	);
};

export default Permissions;
