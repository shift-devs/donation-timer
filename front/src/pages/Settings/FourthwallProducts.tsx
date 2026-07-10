import React, { useEffect, useRef, useState } from "react";
import {
	Box,
	Button,
	Flex,
	HStack,
	Image,
	NumberInput,
	NumberInputField,
	Spacer,
	Spinner,
	Text,
	useToast,
} from "@chakra-ui/react";
import { getFwProducts, setFwProductBonuses, testFwPurchase } from "../../Api";

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

	// follow the server's values only when there are no unsaved local edits (same pattern as Time Per Action)
	useEffect(() => {
		setDraft((prev: any) => (JSON.stringify(prev) === prevSavedRef.current ? saved : prev));
		prevSavedRef.current = savedStr;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [savedStr]);

	const dirty = JSON.stringify(normalize(draft)) !== savedStr;
	const toast = useToast();

	const simulate = (p: { id: string; name: string; usd: number; image?: string }) => {
		testFwPurchase(ws, p);
		toast({ title: `Simulated purchase: ${p.name}`, status: "info", duration: 2500, isClosable: true });
	};

	const alertUrl = `${window.location.origin}/fwalert?token=${encodeURIComponent(localStorage.getItem("identity") || "")}`;
	const copyAlertUrl = () => {
		navigator.clipboard.writeText(alertUrl).then(
			() => toast({ title: "Alert URL copied", status: "success", duration: 2000 }),
			() => toast({ title: "Couldn't copy — select the URL manually", status: "error", duration: 3000 }),
		);
	};

	if (!configured)
		return <Text color='gray.400'>Connect Fourthwall in the Connections tab to load your products.</Text>;

	// bonuses saved for products the shop no longer lists — keep them visible so they can be zeroed out
	const orphans = products === null ? [] : Object.keys(saved).filter((id) => !products.some((p) => p.id === id));

	const row = (id: string, name: string, faded: boolean, image?: string, product?: { id: string; name: string; usd: number; image?: string }) => (
		<Flex key={id} align='center' py={1.5} borderBottom='1px solid' borderColor='whiteAlpha.200'>
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
				<Button colorScheme='green' isDisabled={!dirty} onClick={() => setFwProductBonuses(ws, normalize(draft))}>
					Save
				</Button>
			</Flex>

			<Box mt={8} p={4} borderRadius='md' bg='whiteAlpha.100' fontSize='sm'>
				<Text fontWeight='bold' mb={2}>Purchase alerts — OBS browser source setup</Text>
				<Text mb={1}>1. In OBS: Sources → + → Browser.</Text>
				<Flex mb={1} align='center' gap={2} flexWrap='wrap'>
					<Text flexShrink={0}>2. URL:</Text>
					<Text as='code' bg='blackAlpha.400' px={2} py={0.5} borderRadius='sm' wordBreak='break-all'>{alertUrl}</Text>
					<Button size='xs' onClick={copyAlertUrl}>Copy</Button>
				</Flex>
				<Text mb={1}>3. Width 1200, Height 220 (the alert is a ~125px banner), FPS 30.</Text>
				<Text mb={1}>
					4. The page is a solid green fill: on the source add Filters → Color Key, key color green
					(#00FF00), so only the alert shows over your scene.
				</Text>
				<Text>
					5. Every Fourthwall purchase plays an alert here — and clicking a product thumbnail above
					simulates one, so you can test the source without spending money.
				</Text>
			</Box>
		</Box>
	);
};

export default FourthwallProducts;
