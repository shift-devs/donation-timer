import React, { useState } from "react";
import {
	Box,
	Button,
	Divider,
	Flex,
	HStack,
	Input,
	NumberInput,
	NumberInputField,
	Select,
	Text,
	VStack,
	useToast,
} from "@chakra-ui/react";
import { setSubCount } from "../../Api";
import { copyText } from "../../copy";
import { BASE_URL } from "../../Consts";
import MaskedUrl from "../../MaskedUrl";
import ProgressBar from "../../ProgressBar";

type Platform = "twitch" | "youtube" | "kick";
const SERVICES: { key: Platform; label: string }[] = [
	{ key: "twitch", label: "Twitch" },
	{ key: "youtube", label: "YouTube" },
	{ key: "kick", label: "Kick" },
];
// the progress bar can also track the combined total, so it offers one more choice than the tallies above
const BAR_SERVICES: { key: string; label: string }[] = [...SERVICES, { key: "all", label: "Combined (all services)" }];

const SubCounts: React.FC<{ ws: any; token: string | null; settings: any }> = ({ ws, token, settings }) => {
	const toast = useToast();
	const counts = settings.subCounts || { twitch: 0, youtube: 0, kick: 0 };
	const total = (Number(counts.twitch) || 0) + (Number(counts.youtube) || 0) + (Number(counts.kick) || 0);

	// per-service "correct to real number" drafts — blank until the operator types one, so the live count
	// keeps showing through without a field fighting the incoming sync
	const [drafts, setDrafts] = useState<{ [k in Platform]?: string }>({});

	// progress-bar browser source builder: pick a tally + goal + look, preview it, get a copyable /subprogress
	// url. everything lives in the url (no saved state) — changing it just re-copies the url.
	const [barPlatform, setBarPlatform] = useState("");
	const [barMax, setBarMax] = useState(100);
	const [barOffset, setBarOffset] = useState(0);
	const [barTitle, setBarTitle] = useState("");
	const [barFill, setBarFill] = useState("#22c55e");
	const [barTrack, setBarTrack] = useState("#111827");
	const [barText, setBarText] = useState("#ffffff");
	const tallyOf = (p: string) => (p === "all" ? total : Number(counts[p as Platform]) || 0);

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

			<Divider />

			<Box borderWidth="1px" borderRadius="md" p={4} fontSize="sm">
				<Text fontWeight={600} mb={2}>Sub goal progress bar &mdash; OBS browser source</Text>
				<Text color="gray.500" mb={3}>
					A live &quot;title &mdash; bar &mdash; X / N&quot; row for one of the tallies above, for running a sub
					goal on stream. Set it up below, check the preview, then copy the URL into an OBS browser source.
				</Text>
				<Flex align="center" gap={2} mb={2} wrap="wrap">
					<Text w="52px" flexShrink={0}>Subs</Text>
					<Select
						size="sm"
						maxW="300px"
						placeholder="Select a tally…"
						value={barPlatform}
						onChange={(e) => {
							const key = e.currentTarget.value;
							setBarPlatform(key);
							setBarOffset(0); // the offset belongs to whichever tally it was set from
							// prefill the title from the service name (still editable)
							const svc = BAR_SERVICES.find((x) => x.key === key);
							setBarTitle(!svc ? "" : key === "all" ? "Subs" : `${svc.label} Subs`);
						}}
					>
						{BAR_SERVICES.map((svc) => <option key={svc.key} value={svc.key}>{svc.label}</option>)}
					</Select>
				</Flex>
				<Flex align="center" gap={2} mb={2} wrap="wrap">
					<Text w="52px" flexShrink={0}>Title</Text>
					<Input size="sm" maxW="300px" placeholder="shown to the left of the bar" value={barTitle} onChange={(e) => setBarTitle(e.currentTarget.value)} />
					<Text flexShrink={0} ml={2}>Goal</Text>
					<NumberInput size="sm" maxW="110px" min={1} value={barMax} onChange={(_, n) => setBarMax(Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1)}>
						<NumberInputField />
					</NumberInput>
					<Text color="gray.500">subs</Text>
				</Flex>
				<Flex align="center" gap={2} mb={2} wrap="wrap">
					<Text w="52px" flexShrink={0}>Offset</Text>
					<NumberInput size="sm" maxW="110px" min={0} value={barOffset} onChange={(_, n) => setBarOffset(Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0)}>
						<NumberInputField />
					</NumberInput>
					{barPlatform && (
						<Button size="xs" variant="outline" onClick={() => setBarOffset(tallyOf(barPlatform))}>Start from now</Button>
					)}
					<Text color="gray.500">subtracted from the all-time tally, so the bar starts at 0 for this goal</Text>
				</Flex>
				<Flex align="center" gap={5} mb={3} wrap="wrap">
					<HStack><Text>Fill</Text><Input type="color" w="42px" p={1} value={barFill} onChange={(e) => setBarFill(e.currentTarget.value)} /></HStack>
					<HStack><Text>Bar Background</Text><Input type="color" w="42px" p={1} value={barTrack} onChange={(e) => setBarTrack(e.currentTarget.value)} /></HStack>
					<HStack><Text>Text</Text><Input type="color" w="42px" p={1} value={barText} onChange={(e) => setBarText(e.currentTarget.value)} /></HStack>
				</Flex>
				{barPlatform ? (
					(() => {
						const tally = tallyOf(barPlatform);
						const counted = Math.max(0, tally - barOffset); // what the bar will actually show
						const previewBg = (settings.widgetSettings && settings.widgetSettings.bgColor) || "#00FF00";
						const p = new URLSearchParams({
							token: token || "",
							platform: barPlatform,
							max: String(barMax),
							offset: String(barOffset),
							title: barTitle,
							fill: barFill,
							track: barTrack,
							text: barText,
						});
						const barUrl = `${BASE_URL}/subprogress?${p.toString()}`;
						return (
							<>
								<Text fontSize="xs" color="gray.500" mb={1}>
									Preview (live tally &mdash; {tally.toLocaleString()} all-time{barOffset > 0 ? `, ${counted.toLocaleString()} after the offset` : ""}):
								</Text>
								<Box borderRadius="md" p={3} mb={3} style={{ background: previewBg }}>
									{/* the fill is pinned half-full so the colors/layout are easy to judge */}
									<ProgressBar
										size="preview"
										title={barTitle}
										value={`${counted.toLocaleString()} / ${barMax.toLocaleString()}`}
										pct={50}
										fill={barFill}
										track={barTrack}
										textColor={barText}
									/>
								</Box>
								<HStack spacing={2}>
									<MaskedUrl url={barUrl} p={2} fontSize="xs" flex="1" overflowX="auto" whiteSpace="nowrap" />
									<Button size="xs" onClick={() => copy(barUrl, "Progress bar")}>Copy</Button>
								</HStack>
							</>
						);
					})()
				) : (
					<Text color="gray.500">Pick a tally above to preview it and get its browser-source URL.</Text>
				)}
				<Text color="gray.400" mt={3}>
					Same chroma-key setup as the plain counters: add a Color Key filter in OBS so only the row shows.
					One URL per bar &mdash; run several if you want a goal per service.
				</Text>
			</Box>
		</VStack>
	);
};

export default SubCounts;
