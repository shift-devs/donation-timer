import React, { useMemo } from "react";
import { Badge, Box, Button, Code, Flex, Text, VStack } from "@chakra-ui/react";

// one of the ledgers of who is holding what (ray gun shots, first aid kits, …) — each is a map of
// key → { name, count }, listed biggest holding first with a +1 / −1 beside each.
//
// MEMOISED: these lists can run to hundreds of names, and before they were split out
// every keystroke in a prize (and every countdown tick) rebuilt all of them. now they re-render only when
// their own ledger changes, which the dashboard's sync keeps the same object until it does.
export type WalletRow = { key: string; name: string; count: number };

export function walletRows(map: { [key: string]: any } | null | undefined): WalletRow[] {
	const m = map || {};
	return Object.keys(m)
		.map((k) => ({ key: k, name: m[k].name || k, count: m[k].count || 0 }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function useWalletRows(map: { [key: string]: any } | null | undefined): WalletRow[] {
	return useMemo(() => walletRows(map), [map]);
}

const WalletList: React.FC<{
	ws: any;
	ledger: { [key: string]: any } | null | undefined;
	// plain strings (not JSX) so the memo holds — a fresh element every render would defeat it
	title: string;
	blurb: string;
	// the chat command that spends one, shown as "… with !cmd <name>"
	command?: string;
	// the command takes no name after it (the ice staff isn't aimed at anybody)
	untargeted?: boolean;
	color: string;
	give: (ws: any, key: string, n: number) => void;
}> = React.memo(({ ws, ledger, title, blurb, command, untargeted, color, give }) => {
	const rows = useWalletRows(ledger);
	if (!rows.length)
		return null;
	return (
		<Box borderWidth="1px" borderRadius="md" p={3} mb={4}>
			<Flex align="center" gap={3} mb={2} wrap="wrap">
				<Text fontWeight="bold">{title}</Text>
				<Text fontSize="sm" color="muted">
					{blurb}
					{command != null && <> with <Code fontSize="xs">!{command}{untargeted ? "" : " <name>"}</Code></>}
				</Text>
			</Flex>
			<VStack align="stretch" spacing={1} maxH="160px" overflowY="auto">
				{rows.map((g) => (
					<Flex key={g.key} align="center" gap={2} fontSize="sm">
						<Text flex="1" minW="140px">{g.name}</Text>
						<Badge colorScheme={color}>{g.count}</Badge>
						<Button size="xs" variant="ghost" onClick={() => give(ws, g.key, 1)}>+1</Button>
						<Button size="xs" variant="ghost" onClick={() => give(ws, g.key, -1)}>−1</Button>
					</Flex>
				))}
			</VStack>
		</Box>
	);
});
WalletList.displayName = "WalletList";

export default WalletList;
