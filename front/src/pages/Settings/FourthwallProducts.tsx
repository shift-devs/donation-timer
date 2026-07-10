import React, { useEffect, useRef, useState } from "react";
import {
	Box,
	Button,
	Flex,
	HStack,
	Image,
	NumberInput,
	NumberInputField,
	Select,
	Slider,
	SliderFilledTrack,
	SliderThumb,
	SliderTrack,
	Spacer,
	Spinner,
	Text,
	useToast,
} from "@chakra-ui/react";
import { getFwProducts, setFwProductBonuses, setFwProductSounds, testFwPurchase } from "../../Api";

// sound files found in public/fwsounds at build time (vite.config.ts bakes the list in)
const SOUNDS: string[] = typeof __FW_SOUNDS__ !== "undefined" ? __FW_SOUNDS__ : [];

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

	const dirty = JSON.stringify(normalize(draft)) !== savedStr || JSON.stringify(normalizeSounds(soundDraft)) !== savedSoundsStr;
	const toast = useToast();

	const simulate = (p: { id: string; name: string; usd: number; image?: string }) => {
		testFwPurchase(ws, p);
		toast({ title: `Simulated purchase: ${p.name}`, status: "info", duration: 2500, isClosable: true });
	};

	const alertUrl = `${window.location.origin}/fwalert?token=${encodeURIComponent(localStorage.getItem("identity") || "")}`;
	const activityUrl = `${window.location.origin}/fwactivity?token=${encodeURIComponent(localStorage.getItem("identity") || "")}`;
	const copyUrl = (url: string, what: string) => {
		navigator.clipboard.writeText(url).then(
			() => toast({ title: `${what} URL copied`, status: "success", duration: 2000 }),
			() => toast({ title: "Couldn't copy — select the URL manually", status: "error", duration: 3000 }),
		);
	};

	if (!configured)
		return <Text color='gray.400'>Connect Fourthwall in the Connections tab to load your products.</Text>;

	// config saved for products the shop no longer lists — keep it visible so it can be cleared
	const orphans = products === null
		? []
		: Object.keys({ ...saved, ...savedSounds }).filter((id) => !products.some((p) => p.id === id));

	const soundPicker = (id: string) => {
		const entry = soundDraft[id];
		const file = (entry && entry.file) || "";
		const volume = entry && Number.isFinite(entry.volume) ? entry.volume : 1;
		return (
			<>
				<Select
					size='xs'
					maxW='240px'
					value={file}
					onChange={(ev) => setSoundDraft((d: any) => ({ ...d, [id]: { file: ev.currentTarget.value, volume } }))}
				>
					<option value=''>None</option>
					{SOUNDS.map((f) => <option key={f} value={f}>{f}</option>)}
					{/* a saved sound whose file has since been removed from fwsounds — keep it selectable so it's visible */}
					{file && !SOUNDS.includes(file) && <option value={file}>(missing) {file}</option>}
				</Select>
				<Slider
					size='sm'
					w='110px'
					min={0}
					max={100}
					value={Math.round(volume * 100)}
					isDisabled={!file}
					onChange={(n) => setSoundDraft((d: any) => ({ ...d, [id]: { file, volume: n / 100 } }))}
				>
					<SliderTrack><SliderFilledTrack /></SliderTrack>
					<SliderThumb />
				</Slider>
				<Text fontSize='xs' color='gray.500' w='38px' flexShrink={0}>{Math.round(volume * 100)}%</Text>
			</>
		);
	};

	const row = (id: string, name: string, faded: boolean, image?: string, product?: { id: string; name: string; usd: number; image?: string }) => (
		<Box key={id} py={1.5} borderBottom='1px solid' borderColor='whiteAlpha.200'>
			<Flex align='center'>
				<Box
					as={product ? "button" : "div"}
					title={product ? "Click to simulate a purchase" : undefined}
					cursor={product ? "pointer" : undefined}
					onClick={product ? () => simulate(product) : undefined}
					mr={3}
					flexShrink={0}
					borderRadius='md'
					_hover={product ? { outline: "2px solid", outlineColor: "green.300" } : undefined}
				>
					{image ? (
						<Image src={image} alt='' boxSize='36px' objectFit='cover' borderRadius='md' pointerEvents='none'
							fallback={<Box boxSize='36px' bg='whiteAlpha.200' borderRadius='md' />} />
					) : (
						<Box boxSize='36px' bg='whiteAlpha.200' borderRadius='md' />
					)}
				</Box>
				<Text noOfLines={1} color={faded ? "gray.500" : undefined}>{name}</Text>
				{product && product.usd > 0 && (
					<Text fontSize='sm' color='gray.400' ml={2} flexShrink={0}>${product.usd}</Text>
				)}
				<Spacer />
				<HStack>
					<NumberInput
						size='sm'
						maxW='110px'
						min={0}
						value={draft[id] ?? 0}
						onChange={(_, n) => setDraft((d: any) => ({ ...d, [id]: Number.isFinite(n) ? n : 0 }))}
					>
						<NumberInputField />
					</NumberInput>
					<Text fontSize='sm' color='gray.400' w='70px'>sec / item</Text>
				</HStack>
			</Flex>
			<Flex align='center' mt={1.5} pl='48px' gap={2}>
				<Text fontSize='xs' color='gray.500' flexShrink={0}>Alert sound</Text>
				{soundPicker(id)}
			</Flex>
		</Box>
	);

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
			{(products || []).map((p) => row(p.id, p.name, false, p.image, { id: p.id, name: p.name, usd: Number(p.usd) || 0, image: p.image || "" }))}
			{orphans.map((id) => row(id, `(no longer listed) ${id}`, true))}
			<Flex mt={4}>
				<Spacer />
				<Button
					colorScheme='green'
					isDisabled={!dirty}
					onClick={() => {
						setFwProductBonuses(ws, normalize(draft));
						setFwProductSounds(ws, normalizeSounds(soundDraft));
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
					<Text as='code' bg='blackAlpha.400' px={2} py={0.5} borderRadius='sm' wordBreak='break-all'>{alertUrl}</Text>
					<Button size='xs' onClick={() => copyUrl(alertUrl, "Alert")}>Copy</Button>
				</Flex>
				<Text mb={1}>3. Width 1200, Height 220 (the alert is a ~125px banner), FPS 30.</Text>
				<Text mb={1}>
					4. The page is a solid green fill: on the source add Filters → Color Key, key color green
					(#00FF00), so only the alert shows over your scene.
				</Text>
				<Text mb={1}>
					5. Every Fourthwall purchase plays an alert here — and clicking a product thumbnail above
					simulates one, so you can test the source without spending money.
				</Text>
				<Text>
					6. Alert sounds: drop mp3/wav/ogg files into the site&apos;s <Text as='code'>fwsounds</Text> folder
					(<Text as='code'>front/public/fwsounds</Text>, needs a rebuild to appear here), then pick one per
					product above. &quot;None&quot; keeps that product silent.
				</Text>
			</Box>

			<Box mt={4} p={4} borderRadius='md' bg='whiteAlpha.100' fontSize='sm'>
				<Text fontWeight='bold' mb={2}>Activity feed — thank-you tab</Text>
				<Flex mb={1} align='center' gap={2} flexWrap='wrap'>
					<Text flexShrink={0}>Keep this open in a browser tab:</Text>
					<Text as='code' bg='blackAlpha.400' px={2} py={0.5} borderRadius='sm' wordBreak='break-all'>{activityUrl}</Text>
					<Button size='xs' onClick={() => copyUrl(activityUrl, "Activity")}>Copy</Button>
				</Flex>
				<Text>
					Every purchase, donation, and membership appears live with the buyer&apos;s name and checkout
					message — newest on top — so you can thank people as they come in. Simulated purchases show
					up too.
				</Text>
			</Box>
		</Box>
	);
};

export default FourthwallProducts;
