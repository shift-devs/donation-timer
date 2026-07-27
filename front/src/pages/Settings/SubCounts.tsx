import React, { useState } from "react";
import { Box, Button, Divider, HStack, Input, Text, VStack, useToast } from "@chakra-ui/react";
import { setSubCount } from "../../Api";
import { copyText } from "../../copy";
import { BASE_URL } from "../../Consts";
import MaskedUrl from "../../MaskedUrl";

type Platform = "twitch" | "youtube" | "kick";
const SERVICES: { key: Platform; label: string }[] = [
	{ key: "twitch", label: "Twitch" },
	{ key: "youtube", label: "YouTube" },
	{ key: "kick", label: "Kick" },
];

const SubCounts: React.FC<{ ws: any; token: string | null; settings: any }> = ({ ws, token, settings }) => {
	const toast = useToast();
	const counts = settings.subCounts || { twitch: 0, youtube: 0, kick: 0 };
	const total = (Number(counts.twitch) || 0) + (Number(counts.youtube) || 0) + (Number(counts.kick) || 0);

	// per-service "correct to real number" drafts — blank until the operator types one, so the live count
	// keeps showing through without a field fighting the incoming sync
	const [drafts, setDrafts] = useState<{ [k in Platform]?: string }>({});

	const srcUrl = (platform: string) => `${BASE_URL}/subcount?token=${token}&platform=${platform}`;

	const copy = (url: string, name: string) =>
		copyText(url).then((ok) =>
			toast(ok
				? { title: `${name} URL copied`, status: "success", duration: 1500 }
				: { title: "Couldn't copy — reveal and select the URL manually", status: "error", duration: 3000 }));

	const applyCorrection = (p: Platform) => {
		const raw = drafts[p];
		if (raw == null || raw.trim() === "")
			return;
		const v = Math.max(0, Math.trunc(Number(raw)));
		if (!Number.isFinite(v))
			return;
		setSubCount(ws, p, v);
		setDrafts((d) => ({ ...d, [p]: "" }));
		toast({ title: `${p[0].toUpperCase() + p.slice(1)} count set to ${v.toLocaleString()}`, status: "success", duration: 1500 });
	};

	return (
		<VStack align="stretch" spacing={4} maxW="620px" mx="auto">
			<Text color="gray.500" fontSize="sm">
				A live, all-time tally of subs per service (each gifted sub counts individually). We can only
				<b> add</b> subs as they come in — platforms never tell us about expirations — so these drift up
				over time. Whenever a number is off, type the real current count from that platform's dashboard
				and hit Set; it keeps counting live from there.
			</Text>

			{SERVICES.map(({ key, label }) => (
				<Box key={key} borderWidth="1px" borderRadius="md" p={3}>
					<HStack justify="space-between" align="center" wrap="wrap" spacing={3}>
						<Box minW="160px">
							<Text fontSize="sm" fontWeight={600}>{label}</Text>
							<Text fontSize="2xl" fontWeight={700}>{(Number(counts[key]) || 0).toLocaleString()}</Text>
						</Box>
						<HStack>
							<Input
								size="sm"
								width="130px"
								placeholder="real count"
								value={drafts[key] ?? ""}
								onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.currentTarget.value }))}
								onKeyDown={(e) => { if (e.key === "Enter") applyCorrection(key); }}
							/>
							<Button size="sm" colorScheme="purple" onClick={() => applyCorrection(key)}>Set</Button>
						</HStack>
					</HStack>
					<HStack mt={2} spacing={2}>
						<MaskedUrl url={srcUrl(key)} p={2} fontSize="xs" flex="1" overflowX="auto" whiteSpace="nowrap" />
						<Button size="xs" onClick={() => copy(srcUrl(key), label)}>Copy</Button>
					</HStack>
				</Box>
			))}

			<Divider />

			<Box borderWidth="1px" borderRadius="md" p={3}>
				<HStack justify="space-between" align="center" wrap="wrap" spacing={3}>
					<Box minW="160px">
						<Text fontSize="sm" fontWeight={600}>Combined (all services)</Text>
						<Text fontSize="2xl" fontWeight={700}>{total.toLocaleString()}</Text>
					</Box>
				</HStack>
				<HStack mt={2} spacing={2}>
					<MaskedUrl url={srcUrl("all")} p={2} fontSize="xs" flex="1" overflowX="auto" whiteSpace="nowrap" />
					<Button size="xs" onClick={() => copy(srcUrl("all"), "Combined")}>Copy</Button>
				</HStack>
			</Box>

			<Text fontSize="xs" color="gray.400">
				Add each URL as a Browser source in OBS. The page fills with the widget's chroma-key background
				(set on the Settings tab) so it keys out cleanly. Optional URL tweaks: <b>&amp;label=Subs</b> prints
				a caption above the number, <b>&amp;color=%23ffffff</b> sets the number color.
			</Text>
		</VStack>
	);
};

export default SubCounts;
