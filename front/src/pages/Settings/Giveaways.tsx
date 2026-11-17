import React, { useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Checkbox, Flex, HStack, Input, Select, Table, Tbody, Td, Text, Th, Thead, Tr } from "@chakra-ui/react";
import { setGiveawayWin, deleteGiveawayWin } from "../../Api";

// everybody who won a giveaway prize — a box's "Giveaway" prize, or a minigame that names a giveaway — for the
// client to ship by hand. rows come in on the sync (settings.giveawayWinners); ticks, notes and deletes go back
// to the server, which keeps the list in the database.

type Win = { id: string; t: number; giveaway: string; source: string; login: string; name: string; shipped: boolean; note: string };

function when(t: number): string {
	return t ? new Date(t).toLocaleString() : "";
}

function csvCell(v: any): string {
	const s = String(v == null ? "" : v);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Win[]): string {
	const head = ["Won at", "Giveaway", "Winner", "Twitch login", "Won from", "Shipped", "Note"];
	const lines = rows.map((r) => [new Date(r.t).toISOString(), r.giveaway, r.name, r.login, r.source, r.shipped ? "yes" : "no", r.note].map(csvCell).join(","));
	return [head.join(","), ...lines].join("\r\n");
}

// the note box keeps what's being typed locally and sends it when the field is left, so the 5s sync can't
// overwrite a half-typed note and every keystroke isn't a message
const NoteField: React.FC<{ ws: any; row: Win }> = ({ ws, row }) => {
	const [draft, setDraft] = useState(row.note);
	const [editing, setEditing] = useState(false);
	useEffect(() => {
		if (!editing)
			setDraft(row.note);
	}, [row.note, editing]);
	return (
		<Input
			size="xs"
			minW="160px"
			placeholder="address, tracking #…"
			value={draft}
			maxLength={500}
			onFocus={() => setEditing(true)}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				setEditing(false);
				if (draft !== row.note)
					setGiveawayWin(ws, row.id, { note: draft });
			}}
		/>
	);
};

const Giveaways: React.FC<{ ws: any; settings: any }> = ({ ws, settings }) => {
	const all: Win[] = Array.isArray(settings.giveawayWinners) ? settings.giveawayWinners : [];
	const [which, setWhich] = useState("");
	const [showShipped, setShowShipped] = useState(true);

	// every giveaway that has a winner, with how many are still to ship
	const giveaways = useMemo(() => {
		const m: { [name: string]: { total: number; unshipped: number } } = {};
		for (const r of all) {
			const g = (m[r.giveaway] = m[r.giveaway] || { total: 0, unshipped: 0 });
			g.total++;
			if (!r.shipped)
				g.unshipped++;
		}
		return Object.keys(m).sort((a, b) => a.localeCompare(b)).map((name) => ({ name, ...m[name] }));
	}, [all]);

	const rows = useMemo(
		() => all.filter((r) => (!which || r.giveaway === which) && (showShipped || !r.shipped)).sort((a, b) => b.t - a.t),
		[all, which, showShipped],
	);

	const download = () => {
		const blob = new Blob([toCsv(rows)], { type: "text/csv" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `giveaway-winners${which ? `-${which.replace(/[^\w-]+/g, "_")}` : ""}-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	};

	return (
		<Box textAlign="left" maxW="1200px" mx="auto">
			<Text fontSize="sm" color="muted" mb={3}>
				Everybody who has won a giveaway prize on stream, so the prizes can be shipped later. A win is logged when a
				box lands on a <b>Giveaway</b> prize, or when somebody wins a minigame (cup and ball, solve for x, shell game,
				vote &apos;em up) that has a giveaway set. Test spins are never logged. Tick a win once it&apos;s shipped.
			</Text>
			{giveaways.length > 0 && (
				<Flex gap={2} wrap="wrap" mb={3}>
					{giveaways.map((g) => (
						<Badge
							key={g.name}
							cursor="pointer"
							colorScheme={which === g.name ? "purple" : "gray"}
							px={2}
							py={1}
							onClick={() => setWhich(which === g.name ? "" : g.name)}
						>
							{g.name}: {g.total} won{g.unshipped ? `, ${g.unshipped} to ship` : ", all shipped"}
						</Badge>
					))}
				</Flex>
			)}
			<HStack spacing={3} mb={3} wrap="wrap">
				<Select size="sm" maxW="260px" value={which} onChange={(e) => setWhich(e.target.value)}>
					<option value="">Every giveaway</option>
					{giveaways.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
				</Select>
				<Checkbox isChecked={showShipped} onChange={(e) => setShowShipped(e.target.checked)}>Show shipped</Checkbox>
				<Button size="sm" onClick={download} isDisabled={!rows.length}>Download CSV</Button>
				<Text fontSize="sm" color="subtle">{rows.length} shown</Text>
			</HStack>
			{!all.length ? (
				<Text color="subtle">Nobody has won a giveaway yet.</Text>
			) : (
				<Box overflowX="auto">
					<Table size="sm">
						<Thead>
							<Tr>
								<Th>Shipped</Th>
								<Th>Won at</Th>
								<Th>Winner</Th>
								<Th>Giveaway</Th>
								<Th>Won from</Th>
								<Th>Note</Th>
								<Th />
							</Tr>
						</Thead>
						<Tbody>
							{rows.map((r) => (
								<Tr key={r.id} opacity={r.shipped ? 0.6 : 1}>
									<Td><Checkbox isChecked={r.shipped} onChange={(e) => setGiveawayWin(ws, r.id, { shipped: e.target.checked })} /></Td>
									<Td whiteSpace="nowrap">{when(r.t)}</Td>
									<Td>
										<b>{r.name}</b>
										{r.login && r.login !== r.name.toLowerCase() ? <Text as="span" color="subtle"> ({r.login})</Text> : null}
									</Td>
									<Td>{r.giveaway}</Td>
									<Td color="muted">{r.source}</Td>
									<Td><NoteField ws={ws} row={r} /></Td>
									<Td>
										<Button
											size="xs"
											variant="ghost"
											colorScheme="red"
											onClick={() => {
												if (window.confirm(`Delete ${r.name}'s win of "${r.giveaway}"? This can't be undone.`))
													deleteGiveawayWin(ws, r.id);
											}}
										>
											Delete
										</Button>
									</Td>
								</Tr>
							))}
						</Tbody>
					</Table>
				</Box>
			)}
		</Box>
	);
};

export default Giveaways;
