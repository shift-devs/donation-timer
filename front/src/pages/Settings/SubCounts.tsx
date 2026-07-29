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
import { parseSourceUrl, hexParam, oneOfParam, intParam, textParam } from "../../wizardUrl";
import { TEXT_EFFECTS, MAX_EFFECT_WIDTH, textEffectStyle } from "../../textEffect";

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
	// live twitch snapshot, a different animal from the tallies above: it goes down too. ok=false means the
	// read is failing, so show a dash instead of a number nobody should trust.
	const activeSubs = settings.activeSubs || { count: 0, points: 0, ok: false };
	const activeOk = !!activeSubs.ok;
	const activeReady = !!(settings.connections && settings.connections.twitchSubs && settings.connections.twitchSubs.authorized);
	const activeError = (settings.connections && settings.connections.twitchSubs && settings.connections.twitchSubs.error) || "";

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

	// paste a /subprogress url back in to keep editing it
	const [barPaste, setBarPaste] = useState("");
	const loadBarUrl = () => {
		const sp = parseSourceUrl(barPaste, "/subprogress");
		if (!sp) {
			toast({ title: "That doesn't look like a sub goal bar URL", status: "error", duration: 3000 });
			return;
		}
		setBarPlatform(oneOfParam(sp, "platform", BAR_SERVICES.map((s) => s.key), barPlatform));
		setBarMax(intParam(sp, "max", 1, 1000000000, barMax));
		setBarOffset(intParam(sp, "offset", 0, 1000000000, barOffset));
		setBarTitle(textParam(sp, "title", barTitle));
		setBarFill(hexParam(sp, "fill", barFill));
		setBarTrack(hexParam(sp, "track", barTrack));
		setBarText(hexParam(sp, "text", barText));
		setBarPaste("");
		toast({ title: "Loaded — edit and copy the new URL", status: "success", duration: 2000 });
	};

	// look shared by every counter source below, carried in each url. transparent is url-only here: the synced
	// widget colour is also read by the progress sources, which don't clear the body background.
	const syncBg = (settings.widgetSettings && settings.widgetSettings.bgColor) || "#00FF00";
	const [cntBg, setCntBg] = useState<string | null>(null);
	const [cntBgHex, setCntBgHex] = useState("#00FF00");
	const [cntColor, setCntColor] = useState("#ffffff");
	const [cntEffect, setCntEffect] = useState("none");
	const [cntEffectColor, setCntEffectColor] = useState("#000000");
	const [cntEffectW, setCntEffectW] = useState(4);
	const cntBgValue = cntBg ?? syncBg;
	const cntTransparent = cntBgValue === "transparent";
	const pickCntBg = (v: string) => {
		setCntBg(v);
		if (v !== "transparent")
			setCntBgHex(v);
	};

	const srcUrl = (platform: string) => {
		const p = new URLSearchParams({ token: token || "", platform, bg: cntBgValue, color: cntColor });
		if (cntEffect !== "none" && cntEffectW > 0) {
			p.set("effect", cntEffect);
			p.set("effectColor", cntEffectColor);
			p.set("effectWidth", String(cntEffectW));
		}
		return `${BASE_URL}/subcount?${p.toString()}`;
	};

	// paste any counter url back in to recover its look (the tally comes from whichever row you copy)
	const [cntPaste, setCntPaste] = useState("");
	const loadCntUrl = () => {
		const sp = parseSourceUrl(cntPaste, "/subcount");
		if (!sp) {
			toast({ title: "That doesn't look like a subcount URL", status: "error", duration: 3000 });
			return;
		}
		const bg = hexParam(sp, "bg", cntBgValue, "transparent");
		setCntBg(bg);
		if (bg !== "transparent")
			setCntBgHex(bg);
		setCntColor(hexParam(sp, "color", cntColor));
		const effect = oneOfParam(sp, "effect", TEXT_EFFECTS, "none");
		setCntEffect(effect);
		if (effect !== "none") {
			setCntEffectColor(hexParam(sp, "effectColor", cntEffectColor));
			setCntEffectW(intParam(sp, "effectWidth", 0, MAX_EFFECT_WIDTH, cntEffectW));
		}
		setCntPaste("");
		toast({ title: "Loaded — the URLs above now carry that look", status: "success", duration: 2000 });
	};
	// so a transparent preview reads as see-through rather than as the dashboard's own background
	const checker: React.CSSProperties = {
		backgroundColor: "#2b2b2b",
		backgroundImage:
			"linear-gradient(45deg,#3d3d3d 25%,transparent 25%,transparent 75%,#3d3d3d 75%)," +
			"linear-gradient(45deg,#3d3d3d 25%,transparent 25%,transparent 75%,#3d3d3d 75%)",
		backgroundSize: "18px 18px",
		backgroundPosition: "0 0, 9px 9px",
	};

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

			<Box borderWidth="1px" borderRadius="md" p={3}>
				<Text fontSize="sm" fontWeight={600} mb={2}>Counter appearance</Text>
				<Text fontSize="xs" color="gray.500" mb={3}>
					Applies to every counter URL above &mdash; set it here, then copy the ones you want. Re-copy after
					changing anything, since the look travels in the URL.
				</Text>
				<Flex align="center" gap={2} mb={2} wrap="wrap">
					<Text fontSize="sm" w="80px" flexShrink={0}>Background</Text>
					<Input type="color" w="42px" p={1} cursor="pointer" value={cntTransparent ? cntBgHex : cntBgValue}
						opacity={cntTransparent ? 0.4 : 1} onChange={(e) => pickCntBg(e.currentTarget.value)} />
					<Text as="code" fontSize="xs">{cntBgValue}</Text>
					<Button size="xs" onClick={() => pickCntBg("transparent")} isDisabled={cntTransparent}>transparent</Button>
					<Button size="xs" onClick={() => pickCntBg("#00FF00")} isDisabled={cntBgValue.toUpperCase() === "#00FF00"}>chroma green</Button>
				</Flex>
				<Flex align="center" gap={2} mb={2} wrap="wrap">
					<Text fontSize="sm" w="80px" flexShrink={0}>Text</Text>
					<Input type="color" w="42px" p={1} cursor="pointer" value={cntColor} onChange={(e) => setCntColor(e.currentTarget.value)} />
					<Text as="code" fontSize="xs">{cntColor}</Text>
				</Flex>
				<Flex align="center" gap={2} mb={2} wrap="wrap">
					<Text fontSize="sm" w="80px" flexShrink={0}>Effect</Text>
					<Select size="sm" w="130px" value={cntEffect} onChange={(e) => setCntEffect(e.currentTarget.value)}>
						<option value="none">None</option>
						<option value="stroke">Stroke</option>
						<option value="shadow">Drop shadow</option>
					</Select>
					{cntEffect !== "none" && (
						<>
							<Input type="color" w="42px" p={1} cursor="pointer" value={cntEffectColor} onChange={(e) => setCntEffectColor(e.currentTarget.value)} />
							<NumberInput size="sm" maxW="90px" min={0} max={MAX_EFFECT_WIDTH} value={cntEffectW}
								onChange={(_, n) => setCntEffectW(Number.isFinite(n) ? Math.min(MAX_EFFECT_WIDTH, Math.max(0, Math.trunc(n))) : 0)}>
								<NumberInputField />
							</NumberInput>
							<Text fontSize="sm" color="gray.500">
								{cntEffectW <= 0 ? "px — off" : cntEffect === "stroke" ? "px outline" : "px blur"}
							</Text>
						</>
					)}
				</Flex>
				<Text fontSize="xs" color="gray.500" mb={1}>Preview:</Text>
				<Box borderRadius="md" overflow="hidden" mb={2} style={cntTransparent ? checker : undefined}>
					<Box p={3} textAlign="center" style={{
						background: cntTransparent ? "transparent" : cntBgValue,
						fontFamily: "'Staatliches', cursive",
						color: cntColor,
						...textEffectStyle(cntEffect, cntEffectColor, cntEffectW),
					}}>
						<Box fontSize="44px" lineHeight={1}>1,234</Box>
					</Box>
				</Box>
				<HStack spacing={2}>
					<Input size="xs" placeholder="…or paste an existing counter URL to load its look"
						value={cntPaste} onChange={(e) => setCntPaste(e.currentTarget.value)}
						onKeyDown={(e) => { if (e.key === "Enter") loadCntUrl(); }} />
					<Button size="xs" isDisabled={!cntPaste.trim()} onClick={loadCntUrl}>Load</Button>
				</HStack>
			</Box>

			<Text fontSize="xs" color="gray.400">
				Add each URL as a Browser source in OBS. A transparent background needs no Color Key filter at all;
				any other colour does. One more optional tweak per URL: <b>&amp;label=Subs</b> prints a caption above
				the number.
			</Text>

			<Divider />

			<Box borderWidth="1px" borderRadius="md" p={4} fontSize="sm">
				<Text fontWeight={600} mb={2}>Live active subs &mdash; OBS browser sources</Text>
				<Text color="gray.500" mb={3}>
					Your real subscriber count and sub points as Twitch reports them right now, re-read every 30
					seconds. Unlike the tallies above these go <b>down</b> too, so expirations, cancellations and
					decay show up on their own and there is nothing to correct by hand. Sub points count Tier 1 and
					Prime as 1, Tier 2 as 2 and Tier 3 as 6; the count excludes your own subscription, matching what
					the Twitch API reports.
				</Text>
				{!activeReady ? (
					<Text color="orange.300">
						Set this up under <b>Twitch &mdash; active subs</b> on the Connections tab first: Twitch only
						reports these numbers to the broadcaster&apos;s own authorized token.
					</Text>
				) : (
					<>
						{!activeOk && (
							<Text color="red.300" mb={3}>
								{activeError || "Twitch reads are failing — see the Connections tab."}
							</Text>
						)}
						<HStack align="stretch" spacing={3} wrap="wrap">
							{[
								{ key: "activesubs", label: "Active subs", value: activeSubs.count },
								{ key: "subpoints", label: "Sub points", value: activeSubs.points },
							].map(({ key, label, value }) => (
								<Box key={key} borderWidth="1px" borderRadius="md" p={3} flex="1" minW="260px">
									<Text fontSize="sm" fontWeight={600}>{label}</Text>
									<Text fontSize="2xl" fontWeight={700}>
										{activeOk ? (Number(value) || 0).toLocaleString() : "—"}
									</Text>
									<HStack mt={2} spacing={2}>
										<MaskedUrl url={srcUrl(key)} p={2} fontSize="xs" flex="1" overflowX="auto" whiteSpace="nowrap" />
										<Button size="xs" onClick={() => copy(srcUrl(key), label)}>Copy</Button>
									</HStack>
								</Box>
							))}
						</HStack>
						<Text fontSize="xs" color="gray.400" mt={3}>
							Same page as the tallies above, so <b>&amp;label=</b> and <b>&amp;color=</b> work here too. The
							source shows a dash whenever the Twitch read is failing rather than freezing on a stale
							number.
						</Text>
					</>
				)}
			</Box>

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
				<HStack spacing={2} mt={2}>
					<Input
						size="xs"
						placeholder="…or paste an existing sub goal bar URL to edit it"
						value={barPaste}
						onChange={(e) => setBarPaste(e.currentTarget.value)}
						onKeyDown={(e) => { if (e.key === "Enter") loadBarUrl(); }}
					/>
					<Button size="xs" isDisabled={!barPaste.trim()} onClick={loadBarUrl}>Load</Button>
				</HStack>
				<Text color="gray.400" mt={3}>
					Same chroma-key setup as the plain counters: add a Color Key filter in OBS so only the row shows.
					One URL per bar &mdash; run several if you want a goal per service.
				</Text>
			</Box>
		</VStack>
	);
};

export default SubCounts;
