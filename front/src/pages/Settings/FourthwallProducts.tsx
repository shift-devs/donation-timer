import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	Box,
	Button,
	Flex,
	HStack,
	Image,
	Input,
	NumberInput,
	NumberInputField,
	Select,
	Slider,
	SliderFilledTrack,
	SliderThumb,
	SliderTrack,
	Spacer,
	Spinner,
	Switch,
	Text,
	useToast,
} from "@chakra-ui/react";
import { getFwProducts, setFwProductBonuses, setFwProductSounds, setFwProductAlerts, setFwProductBanners, setFwProductShadows, testFwPurchase } from "../../Api";
import { copyText } from "../../copy";
import MaskedUrl from "../../MaskedUrl";
import ProgressBar from "../../ProgressBar";
import { BASE_URL } from "../../Consts";

// sound files found in public/fwsounds at build time (vite.config.ts bakes the list in)
const SOUNDS: string[] = typeof __FW_SOUNDS__ !== "undefined" ? __FW_SOUNDS__ : [];
// same for public/banners — the alert's name panel background, per product
const BANNERS: string[] = typeof __BANNERS__ !== "undefined" ? __BANNERS__ : [];

// canonical view of the bonus map: only positive finite numbers survive (mirrors the backend normalizer),
// so zeroing an input reads as "remove the bonus" for dirty-checking and saving alike
function normalize(raw: any): { [id: string]: number } {
	const out: { [id: string]: number } = {};
	if (raw && typeof raw === "object" && !Array.isArray(raw))
		for (const [id, v] of Object.entries(raw)) {
			const n = Number(v);
			if (id && Number.isFinite(n) && n > 0) out[id] = n;
		}
	return out;
}

// same idea for the sound map: entries are { file, volume }, only kept with a non-empty file
// ("None" = removed). a bare string is the legacy shape and reads as volume 1.
function normalizeSounds(raw: any): { [id: string]: { file: string; volume: number } } {
	const out: { [id: string]: { file: string; volume: number } } = {};
	if (raw && typeof raw === "object" && !Array.isArray(raw))
		for (const [id, v] of Object.entries(raw)) {
			const file = typeof v === "string" ? v : (v && typeof (v as any).file === "string" ? (v as any).file : "");
			if (!id || !file) continue;
			const volN = Number(v && (v as any).volume);
			out[id] = { file, volume: Number.isFinite(volN) ? Math.min(1, Math.max(0, volN)) : 1 };
		}
	return out;
}

// banner map: { [id]: filename }, only kept with a non-empty name ("None" = removed, i.e. the alert's
// default purple panel). mirrors the backend normalizer.
function normalizeBanners(raw: any): { [id: string]: string } {
	const out: { [id: string]: string } = {};
	if (raw && typeof raw === "object" && !Array.isArray(raw))
		for (const [id, v] of Object.entries(raw)) {
			const file = typeof v === "string" ? v : "";
			if (id && file) out[id] = file;
		}
	return out;
}

// name drop shadow: default off, so we only keep the products explicitly turned on ({ [id]: true }) —
// mirrors the backend normalizer. any absent id reads as "no shadow".
function normalizeShadows(raw: any): { [id: string]: boolean } {
	const out: { [id: string]: boolean } = {};
	if (raw && typeof raw === "object" && !Array.isArray(raw))
		for (const [id, v] of Object.entries(raw)) {
			if (id && v === true) out[id] = true;
		}
	return out;
}

// alert toggles: default on, so we only keep the products explicitly turned off ({ [id]: false }) —
// mirrors the backend normalizer. any absent id reads as "alerts on".
function normalizeAlerts(raw: any): { [id: string]: boolean } {
	const out: { [id: string]: boolean } = {};
	if (raw && typeof raw === "object" && !Array.isArray(raw))
		for (const [id, v] of Object.entries(raw)) {
			if (id && v === false) out[id] = false;
		}
	return out;
}

// one product's row: thumbnail (click = simulate), per-item bonus, alert toggle + sound. memoized and
// compared by value so a shop of 50 products doesn't re-render every row on each keystroke / color drag /
// 5s sync — only the row whose own data changed re-renders. this is the difference between a snappy tab
// and a laggy one.
type RowProps = {
	id: string; name: string; faded: boolean; image: string; usd: number; simulatable: boolean;
	bonus: number; sound?: { file: string; volume: number }; alertOn: boolean; banner: string; shadow: boolean;
	onBonus: (id: string, n: number) => void;
	onSound: (id: string, entry: { file: string; volume: number }) => void;
	onAlert: (id: string, checked: boolean) => void;
	onBanner: (id: string, file: string) => void;
	onShadow: (id: string, checked: boolean) => void;
	onSimulate: (p: { id: string; name: string; usd: number; image: string }) => void;
};

function rowsEqual(a: RowProps, b: RowProps): boolean {
	return a.id === b.id && a.name === b.name && a.faded === b.faded && a.image === b.image && a.usd === b.usd
		&& a.simulatable === b.simulatable && a.bonus === b.bonus && a.alertOn === b.alertOn
		&& a.banner === b.banner && a.shadow === b.shadow
		&& (a.sound && a.sound.file) === (b.sound && b.sound.file)
		&& (a.sound && a.sound.volume) === (b.sound && b.sound.volume)
		&& a.onBonus === b.onBonus && a.onSound === b.onSound && a.onAlert === b.onAlert
		&& a.onBanner === b.onBanner && a.onShadow === b.onShadow && a.onSimulate === b.onSimulate;
}

const ProductRow: React.FC<RowProps> = React.memo(({ id, name, faded, image, usd, simulatable, bonus, sound, alertOn, banner, shadow, onBonus, onSound, onAlert, onBanner, onShadow, onSimulate }) => {
	const file = (sound && sound.file) || "";
	const volume = sound && Number.isFinite(sound.volume) ? sound.volume : 1;
	const soundOff = !alertOn;
	return (
		<Box py={1.5} borderBottom='1px solid' borderColor='whiteAlpha.200'>
			<Flex align='center'>
				<Box
					as={simulatable ? "button" : "div"}
					title={simulatable ? "Click to simulate a purchase" : undefined}
					cursor={simulatable ? "pointer" : undefined}
					onClick={simulatable ? () => onSimulate({ id, name, usd, image }) : undefined}
					mr={3}
					flexShrink={0}
					borderRadius='md'
					_hover={simulatable ? { outline: "2px solid", outlineColor: "green.300" } : undefined}
				>
					{image ? (
						<Image src={image} alt='' boxSize='36px' objectFit='cover' borderRadius='md' pointerEvents='none'
							fallback={<Box boxSize='36px' bg='whiteAlpha.200' borderRadius='md' />} />
					) : (
						<Box boxSize='36px' bg='whiteAlpha.200' borderRadius='md' />
					)}
				</Box>
				<Text noOfLines={1} color={faded ? "gray.500" : undefined}>{name}</Text>
				{usd > 0 && <Text fontSize='sm' color='gray.400' ml={2} flexShrink={0}>${usd}</Text>}
				<Spacer />
				<HStack>
					<NumberInput size='sm' maxW='110px' min={0} value={bonus} onChange={(_, n) => onBonus(id, Number.isFinite(n) ? n : 0)}>
						<NumberInputField />
					</NumberInput>
					<Text fontSize='sm' color='gray.400' w='70px'>sec / item</Text>
				</HStack>
			</Flex>
			<Flex align='center' mt={1.5} pl='48px' gap={2}>
				<Text fontSize='xs' color='gray.500' flexShrink={0}>Alert</Text>
				<Switch size='sm' isChecked={alertOn} onChange={(ev) => onAlert(id, ev.target.checked)} />
				<Text fontSize='xs' color='gray.500' flexShrink={0} ml={2}>sound</Text>
				<Select size='xs' maxW='240px' value={file} isDisabled={soundOff} onChange={(ev) => onSound(id, { file: ev.currentTarget.value, volume })}>
					<option value=''>None</option>
					{SOUNDS.map((f) => <option key={f} value={f}>{f}</option>)}
					{/* a saved sound whose file has since been removed from fwsounds — keep it selectable so it's visible */}
					{file && !SOUNDS.includes(file) && <option value={file}>(missing) {file}</option>}
				</Select>
				<Slider size='sm' w='110px' min={0} max={100} value={Math.round(volume * 100)} isDisabled={soundOff || !file} onChange={(n) => onSound(id, { file, volume: n / 100 })}>
					<SliderTrack><SliderFilledTrack /></SliderTrack>
					<SliderThumb />
				</Slider>
				<Text fontSize='xs' color='gray.500' w='38px' flexShrink={0}>{Math.round(volume * 100)}%</Text>
			</Flex>
			<Flex align='center' mt={1.5} pl='48px' gap={2}>
				<Text fontSize='xs' color='gray.500' flexShrink={0}>Banner</Text>
				<Select size='xs' maxW='240px' value={banner} isDisabled={soundOff} onChange={(ev) => onBanner(id, ev.currentTarget.value)}>
					<option value=''>None (purple)</option>
					{BANNERS.map((f) => <option key={f} value={f}>{f}</option>)}
					{/* a saved banner whose file has since been removed from banners/ — keep it selectable so it's visible */}
					{banner && !BANNERS.includes(banner) && <option value={banner}>(missing) {banner}</option>}
				</Select>
				{banner && (
					<Image
						src={`/banners/${encodeURIComponent(banner)}`}
						alt=''
						h='22px'
						maxW='90px'
						objectFit='cover'
						borderRadius='sm'
						fallback={<Box h='22px' w='40px' bg='whiteAlpha.200' borderRadius='sm' />}
					/>
				)}
				<Text fontSize='xs' color='gray.500' flexShrink={0} ml={2}>text shadow</Text>
				<Switch size='sm' isChecked={shadow} isDisabled={soundOff} onChange={(ev) => onShadow(id, ev.target.checked)} />
			</Flex>
		</Box>
	);
}, rowsEqual);

const FourthwallProducts: React.FC<{ ws: any; settings: any; products: any[] | null; error: string }> = ({
	ws,
	settings,
	products,
	error,
}) => {
	const configured = !!(settings.connections && settings.connections.fourthwall && settings.connections.fourthwall.configured);
	const saved = normalize(settings.fwProductBonuses);
	const savedStr = JSON.stringify(saved);
	const [draft, setDraft] = useState<any>(saved);
	const prevSavedRef = useRef(savedStr);
	const savedSounds = normalizeSounds(settings.fwProductSounds);
	const savedSoundsStr = JSON.stringify(savedSounds);
	const [soundDraft, setSoundDraft] = useState<any>(savedSounds);
	const prevSavedSoundsRef = useRef(savedSoundsStr);
	const savedAlerts = normalizeAlerts(settings.fwProductAlerts);
	const savedAlertsStr = JSON.stringify(savedAlerts);
	const [alertDraft, setAlertDraft] = useState<any>(savedAlerts);
	const prevSavedAlertsRef = useRef(savedAlertsStr);
	const savedBanners = normalizeBanners(settings.fwProductBanners);
	const savedBannersStr = JSON.stringify(savedBanners);
	const [bannerDraft, setBannerDraft] = useState<any>(savedBanners);
	const prevSavedBannersRef = useRef(savedBannersStr);
	const savedShadows = normalizeShadows(settings.fwProductShadows);
	const savedShadowsStr = JSON.stringify(savedShadows);
	const [shadowDraft, setShadowDraft] = useState<any>(savedShadows);
	const prevSavedShadowsRef = useRef(savedShadowsStr);

	// follow the server's values only when there are no unsaved local edits (same pattern as Time Per Action)
	useEffect(() => {
		setDraft((prev: any) => (JSON.stringify(prev) === prevSavedRef.current ? saved : prev));
		prevSavedRef.current = savedStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedStr]);
	useEffect(() => {
		setSoundDraft((prev: any) => (JSON.stringify(prev) === prevSavedSoundsRef.current ? savedSounds : prev));
		prevSavedSoundsRef.current = savedSoundsStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedSoundsStr]);
	useEffect(() => {
		setAlertDraft((prev: any) => (JSON.stringify(prev) === prevSavedAlertsRef.current ? savedAlerts : prev));
		prevSavedAlertsRef.current = savedAlertsStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedAlertsStr]);
	useEffect(() => {
		setBannerDraft((prev: any) => (JSON.stringify(prev) === prevSavedBannersRef.current ? savedBanners : prev));
		prevSavedBannersRef.current = savedBannersStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedBannersStr]);
	useEffect(() => {
		setShadowDraft((prev: any) => (JSON.stringify(prev) === prevSavedShadowsRef.current ? savedShadows : prev));
		prevSavedShadowsRef.current = savedShadowsStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedShadowsStr]);

	const dirty = JSON.stringify(normalize(draft)) !== savedStr
		|| JSON.stringify(normalizeSounds(soundDraft)) !== savedSoundsStr
		|| JSON.stringify(normalizeAlerts(alertDraft)) !== savedAlertsStr
		|| JSON.stringify(normalizeBanners(bannerDraft)) !== savedBannersStr
		|| JSON.stringify(normalizeShadows(shadowDraft)) !== savedShadowsStr;
	const toast = useToast();

	// progress-bar browser source builder: pick a product + goal + look, preview it, get a copyable
	// /fwprogress url. everything lives in the url (no saved state) — changing it just re-copies the url.
	const [progressProduct, setProgressProduct] = useState("");
	const [progressMax, setProgressMax] = useState(1000);
	const [progressOffset, setProgressOffset] = useState(0);
	const [progressTitle, setProgressTitle] = useState("");
	const [progressFill, setProgressFill] = useState("#22c55e");
	const [progressTrack, setProgressTrack] = useState("#111827");
	const [progressText, setProgressText] = useState("#ffffff");

	// stable row callbacks (functional setState) so every ProductRow keeps the same prop identities across
	// renders — that's what lets React.memo skip the 50 rows when unrelated state (wizard, colors) changes.
	const onSimulate = useCallback((p: { id: string; name: string; usd: number; image: string }) => {
		testFwPurchase(ws, p);
		toast({ title: `Simulated purchase: ${p.name}`, status: "info", duration: 2500, isClosable: true });
	}, [ws, toast]);
	const onBonus = useCallback((id: string, n: number) => setDraft((d: any) => ({ ...d, [id]: n })), []);
	const onSound = useCallback((id: string, entry: { file: string; volume: number }) => setSoundDraft((d: any) => ({ ...d, [id]: entry })), []);
	const onAlert = useCallback((id: string, checked: boolean) => setAlertDraft((d: any) => ({ ...d, [id]: checked })), []);
	const onBanner = useCallback((id: string, file: string) => setBannerDraft((d: any) => ({ ...d, [id]: file })), []);
	const onShadow = useCallback((id: string, checked: boolean) => setShadowDraft((d: any) => ({ ...d, [id]: checked })), []);

	const alertUrl = `${BASE_URL}/fwalert?token=${encodeURIComponent(localStorage.getItem("identity") || "")}`;
	const activityUrl = `${BASE_URL}/fwactivity?token=${encodeURIComponent(localStorage.getItem("identity") || "")}`;
	const copyUrl = (url: string, what: string) => {
		copyText(url).then((ok) =>
			ok
				? toast({ title: `${what} URL copied`, status: "success", duration: 2000 })
				: toast({ title: "Couldn't copy — select the URL manually", status: "error", duration: 3000 }));
	};

	if (!configured)
		return <Text color='gray.400'>Connect Fourthwall in the Connections tab to load your products.</Text>;

	// config saved for products the shop no longer lists — keep it visible so it can be cleared
	const orphans = products === null
		? []
		: Object.keys({ ...saved, ...savedSounds, ...savedAlerts, ...savedBanners, ...savedShadows }).filter((id) => !products.some((p) => p.id === id));

	return (
		<Box maxW='700px' mx='auto' textAlign='left'>
			<Flex mb={3} align='center'>
				<Text fontWeight='bold'>Per-product time bonuses</Text>
				<Spacer />
				<Button size='sm' onClick={() => getFwProducts(ws)}>Refresh products</Button>
			</Flex>
			<Text fontSize='sm' color='gray.400' mb={4}>
				Extra seconds granted when a product is bought — per item, multiplied by quantity, on top of the
				per-$ order rate from the Time Per Action tab. 0 = no bonus. Click a thumbnail to simulate a
				purchase (uses the saved bonus, so save first to test new values).
			</Text>
			{error && <Text color='red.300' mb={3}>{error}</Text>}
			{products === null && !error && (
				<HStack><Spinner size='sm' /><Text>Loading products…</Text></HStack>
			)}
			{products !== null && products.length === 0 && !error && (
				<Text color='gray.400'>No products found in the shop.</Text>
			)}
			{(products || []).map((p) => (
				<ProductRow
					key={p.id}
					id={p.id}
					name={p.name}
					faded={false}
					image={p.image || ""}
					usd={Number(p.usd) || 0}
					simulatable
					bonus={draft[p.id] ?? 0}
					sound={soundDraft[p.id]}
					alertOn={alertDraft[p.id] !== false}
					banner={bannerDraft[p.id] || ""}
					shadow={shadowDraft[p.id] === true}
					onBonus={onBonus}
					onSound={onSound}
					onAlert={onAlert}
					onBanner={onBanner}
					onShadow={onShadow}
					onSimulate={onSimulate}
				/>
			))}
			{orphans.map((id) => (
				<ProductRow
					key={id}
					id={id}
					name={`(no longer listed) ${id}`}
					faded
					image=''
					usd={0}
					simulatable={false}
					bonus={draft[id] ?? 0}
					sound={soundDraft[id]}
					alertOn={alertDraft[id] !== false}
					banner={bannerDraft[id] || ""}
					shadow={shadowDraft[id] === true}
					onBonus={onBonus}
					onSound={onSound}
					onAlert={onAlert}
					onBanner={onBanner}
					onShadow={onShadow}
					onSimulate={onSimulate}
				/>
			))}
			<Flex mt={4}>
				<Spacer />
				<Button
					colorScheme='green'
					isDisabled={!dirty}
					onClick={() => {
						setFwProductBonuses(ws, normalize(draft));
						setFwProductSounds(ws, normalizeSounds(soundDraft));
						setFwProductAlerts(ws, normalizeAlerts(alertDraft));
						setFwProductBanners(ws, normalizeBanners(bannerDraft));
						setFwProductShadows(ws, normalizeShadows(shadowDraft));
					}}
				>
					Save
				</Button>
			</Flex>

			<Box mt={8} p={4} borderRadius='md' bg='whiteAlpha.100' fontSize='sm'>
				<Text fontWeight='bold' mb={2}>Purchase alerts — OBS browser source setup</Text>
				<Text mb={1}>1. In OBS: Sources → + → Browser.</Text>
				<Flex mb={1} align='center' gap={2} flexWrap='wrap'>
					<Text flexShrink={0}>2. URL:</Text>
					<MaskedUrl url={alertUrl} bg='blackAlpha.400' px={2} py={0.5} borderRadius='sm' wordBreak='break-all' />
					<Button size='xs' onClick={() => copyUrl(alertUrl, "Alert")}>Copy</Button>
				</Flex>
				<Text mb={1}>3. Width 1200, Height 220 (the alert is a ~125px banner), FPS 30.</Text>
				<Text mb={1}>
					4. The page is a solid green fill: on the source add Filters → Color Key, key color green
					(#00FF00), so only the alert shows over your scene.
				</Text>
				<Text mb={1}>
					5. Each purchase plays an alert here unless that product&apos;s <b>Alert</b> toggle above is off.
					Clicking a product thumbnail simulates one (respecting the toggle), so you can test the source
					without spending money.
				</Text>
				<Text>
					6. Alert sounds: drop mp3/wav/ogg files into the site&apos;s <Text as='code'>fwsounds</Text> folder
					(<Text as='code'>front/public/fwsounds</Text>, needs a rebuild to appear here), then pick one per
					product above. &quot;None&quot; keeps that product silent.
				</Text>
				<Text mt={1}>
					7. Alert banners: drop images into the site&apos;s <Text as='code'>banners</Text> folder
					(<Text as='code'>front/public/banners</Text>, needs a rebuild to appear here), then pick one per
					product above. The banner covers the alert&apos;s purple panel; &quot;None&quot; keeps the purple.
					Turn on <b>text shadow</b> for products whose banner is light or busy, so the buyer name stays
					readable over it.
				</Text>
			</Box>

			<Box mt={4} p={4} borderRadius='md' bg='whiteAlpha.100' fontSize='sm'>
				<Text fontWeight='bold' mb={2}>Activity feed — thank-you tab</Text>
				<Flex mb={1} align='center' gap={2} flexWrap='wrap'>
					<Text flexShrink={0}>Keep this open in a browser tab:</Text>
					<MaskedUrl url={activityUrl} bg='blackAlpha.400' px={2} py={0.5} borderRadius='sm' wordBreak='break-all' />
					<Button size='xs' onClick={() => copyUrl(activityUrl, "Activity")}>Copy</Button>
				</Flex>
				<Text>
					Every purchase, donation, and membership appears live with the buyer&apos;s name and checkout
					message — newest on top — so you can thank people as they come in. Simulated purchases show
					up too.
				</Text>
			</Box>

			<Box mt={4} p={4} borderRadius='md' bg='whiteAlpha.100' fontSize='sm'>
				<Text fontWeight='bold' mb={2}>Sales progress bar — OBS browser source</Text>
				<Text color='gray.400' mb={3}>
					A live &quot;title — bar — X / N&quot; row for one product, counting its all-time units sold from
					Fourthwall. Set it up below, check the preview, then copy the URL into an OBS browser source.
				</Text>
				<Flex align='center' gap={2} mb={2} flexWrap='wrap'>
					<Text w='52px' flexShrink={0}>Product</Text>
					<Select
						size='sm'
						maxW='300px'
						placeholder='Select a product…'
						value={progressProduct}
						onChange={(ev) => {
							const id = ev.currentTarget.value;
							setProgressProduct(id);
							setProgressOffset(0); // the offset belongs to whichever product it was set from
							// prefill the title with the product name (still editable)
							const p = (products || []).find((x) => x.id === id);
							setProgressTitle(p ? p.name : "");
						}}
					>
						{(products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
					</Select>
				</Flex>
				<Flex align='center' gap={2} mb={2} flexWrap='wrap'>
					<Text w='52px' flexShrink={0}>Title</Text>
					<Input size='sm' maxW='300px' placeholder='shown to the left of the bar' value={progressTitle} onChange={(ev) => setProgressTitle(ev.currentTarget.value)} />
					<Text flexShrink={0} ml={2}>Goal</Text>
					<NumberInput size='sm' maxW='110px' min={1} value={progressMax} onChange={(_, n) => setProgressMax(Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1)}>
						<NumberInputField />
					</NumberInput>
					<Text color='gray.400'>sold</Text>
				</Flex>
				<Flex align='center' gap={2} mb={2} flexWrap='wrap'>
					<Text w='52px' flexShrink={0}>Offset</Text>
					<NumberInput size='sm' maxW='110px' min={0} value={progressOffset} onChange={(_, n) => setProgressOffset(Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0)}>
						<NumberInputField />
					</NumberInput>
					{progressProduct && (
						<Button
							size='xs'
							variant='outline'
							onClick={() => setProgressOffset(Number(settings.fwUnitsSold && settings.fwUnitsSold[progressProduct]) || 0)}
						>
							Start from now
						</Button>
					)}
					<Text color='gray.400'>subtracted from the all-time count, so the bar starts at 0 for this goal</Text>
				</Flex>
				<Flex align='center' gap={5} mb={3} flexWrap='wrap'>
					<HStack><Text>Fill</Text><Input type='color' w='42px' p={1} value={progressFill} onChange={(ev) => setProgressFill(ev.currentTarget.value)} /></HStack>
					<HStack><Text>Bar Background</Text><Input type='color' w='42px' p={1} value={progressTrack} onChange={(ev) => setProgressTrack(ev.currentTarget.value)} /></HStack>
					<HStack><Text>Text</Text><Input type='color' w='42px' p={1} value={progressText} onChange={(ev) => setProgressText(ev.currentTarget.value)} /></HStack>
				</Flex>
				{progressProduct ? (
					(() => {
						const sold = Number(settings.fwUnitsSold && settings.fwUnitsSold[progressProduct]) || 0;
						const counted = Math.max(0, sold - progressOffset); // what the bar will actually show
						const pct = 50; // preview always shows a half-full bar so colors/layout are easy to judge
						const previewBg = (settings.widgetSettings && settings.widgetSettings.bgColor) || "#00FF00";
						const p = new URLSearchParams({
							token: localStorage.getItem("identity") || "",
							product: progressProduct,
							max: String(progressMax),
							offset: String(progressOffset),
							title: progressTitle,
							fill: progressFill,
							track: progressTrack,
							text: progressText,
						});
						const progressUrl = `${BASE_URL}/fwprogress?${p.toString()}`;
						return (
							<>
								<Text fontSize='xs' color='gray.500' mb={1}>Preview (live sold count — {sold.toLocaleString()} all-time{progressOffset > 0 ? `, ${counted.toLocaleString()} after the offset` : ""}):</Text>
								<Box borderRadius='md' p={3} mb={3} style={{ background: previewBg }}>
									<ProgressBar
										size='preview'
										title={progressTitle}
										value={`${counted.toLocaleString()} / ${progressMax.toLocaleString()}`}
										pct={pct}
										fill={progressFill}
										track={progressTrack}
										textColor={progressText}
									/>
								</Box>
								<Flex align='center' gap={2} flexWrap='wrap'>
									<MaskedUrl url={progressUrl} bg='blackAlpha.400' px={2} py={0.5} borderRadius='sm' wordBreak='break-all' />
									<Button size='xs' onClick={() => copyUrl(progressUrl, "Progress bar")}>Copy</Button>
								</Flex>
							</>
						);
					})()
				) : (
					<Text color='gray.500'>Pick a product above to preview it and get its browser-source URL.</Text>
				)}
				<Text color='gray.400' mt={3}>
					The page background is the timer widget&apos;s chroma color (set in the Settings tab) — add a
					Color Key filter in OBS so only the row shows.
				</Text>
			</Box>
		</Box>
	);
};

export default FourthwallProducts;
