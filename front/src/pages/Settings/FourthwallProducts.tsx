import React, { useEffect, useRef, useState } from "react";
import {
	Box,
	Button,
	Flex,
	HStack,
	NumberInput,
	NumberInputField,
	Spacer,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { getFwProducts, setFwProductBonuses } from "../../Api";

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

	if (!configured)
		return <Text color='gray.400'>Connect Fourthwall in the Connections tab to load your products.</Text>;

	// bonuses saved for products the shop no longer lists — keep them visible so they can be zeroed out
	const orphans = products === null ? [] : Object.keys(saved).filter((id) => !products.some((p) => p.id === id));

	const row = (id: string, name: string, faded: boolean) => (
		<Flex key={id} align='center' py={1.5} borderBottom='1px solid' borderColor='whiteAlpha.200'>
			<Text noOfLines={1} color={faded ? "gray.500" : undefined}>{name}</Text>
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
				per-$ order rate from the Time Per Action tab. 0 = no bonus.
			</Text>
			{error && <Text color='red.300' mb={3}>{error}</Text>}
			{products === null && !error && (
				<HStack><Spinner size='sm' /><Text>Loading products…</Text></HStack>
			)}
			{products !== null && products.length === 0 && !error && (
				<Text color='gray.400'>No products found in the shop.</Text>
			)}
			{(products || []).map((p) => row(p.id, p.name, false))}
			{orphans.map((id) => row(id, `(no longer listed) ${id}`, true))}
			<Flex mt={4}>
				<Spacer />
				<Button colorScheme='green' isDisabled={!dirty} onClick={() => setFwProductBonuses(ws, normalize(draft))}>
					Save
				</Button>
			</Flex>
		</Box>
	);
};

export default FourthwallProducts;
