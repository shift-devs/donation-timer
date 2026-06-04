import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Input, Text } from "@chakra-ui/react";

function pad(n: number) {
	return ("0" + n).slice(-2);
}

function fmtTs(t: number) {
	const d = new Date(t);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// remaining time as a clock (H:MM:SS or M:SS)
function fmtClock(ms: number) {
	let s = Math.round(ms / 1000);
	const h = Math.floor(s / 3600);
	s %= 3600;
	const m = Math.floor(s / 60);
	s %= 60;
	if (h) return `${h}:${pad(m)}:${pad(s)}`;
	return `${m}:${pad(s)}`;
}

// signed delta, ms shown only when non-zero
function fmtDelta(ms: number) {
	const sign = ms < 0 ? "-" : "+";
	let v = Math.abs(Math.round(ms));
	const msPart = v % 1000;
	let whole = Math.floor(v / 1000);
	const h = Math.floor(whole / 3600);
	whole %= 3600;
	const m = Math.floor(whole / 60);
	const s = whole % 60;
	const parts: string[] = [];
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}m`);
	if (s) parts.push(`${s}s`);
	if (msPart) parts.push(`${msPart}ms`);
	if (parts.length === 0) parts.push("0s");
	return sign + parts.join(" ");
}

// command-feed lines (echo / result) carry a `line`; server timer-action entries carry action/oldMs/newMs
function lineColor(kind: string) {
	if (kind === "err") return "#ff6b6b";
	if (kind === "input") return "#9ad1ff";
	return "#7CFC7C";
}

const Terminal: React.FC<{
	entries: any[];
	hasMore: boolean;
	active: boolean;
	onLoadOlder: () => void;
	onCommand: (cmd: string) => void;
}> = ({ entries, hasMore, active, onLoadOlder, onCommand }) => {
	const ref = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef(true);
	const prevHeightRef = useRef(0);
	const loadingOlderRef = useRef(false);
	const prevLenRef = useRef(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const [input, setInput] = useState("");
	const historyRef = useRef<string[]>([]);
	const histPosRef = useRef(-1);

	const onScroll = () => {
		const el = ref.current;
		if (!el) return;
		pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
		if (el.scrollTop < 80 && hasMore && !loadingOlderRef.current) {
			loadingOlderRef.current = true;
			prevHeightRef.current = el.scrollHeight; // hold position across the prepend
			onLoadOlder();
		}
	};

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const len = entries.length;
		const prevLen = prevLenRef.current;
		prevLenRef.current = len;
		if (loadingOlderRef.current) {
			// older rows just prepended — keep the same rows under the viewport
			el.scrollTop = el.scrollHeight - prevHeightRef.current;
			loadingOlderRef.current = false;
		} else if (prevLen === 0 && len > 0) {
			el.scrollTop = el.scrollHeight; // first load
		} else if (len > prevLen && pinnedRef.current) {
			el.scrollTop = el.scrollHeight; // live entry while pinned to the bottom
		}
	}, [entries]);

	// land at the bottom + focus the input when the tab is opened
	useEffect(() => {
		const el = ref.current;
		if (active && el) {
			el.scrollTop = el.scrollHeight;
			pinnedRef.current = true;
			if (inputRef.current) inputRef.current.focus();
		}
	}, [active]);

	const submit = () => {
		const cmd = input.trim();
		if (!cmd) return;
		historyRef.current.push(cmd);
		histPosRef.current = -1;
		pinnedRef.current = true; // snap to bottom to show the response
		onCommand(cmd);
		setInput("");
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			submit();
		} else if (e.key === "ArrowUp") {
			const h = historyRef.current;
			if (!h.length) return;
			e.preventDefault();
			histPosRef.current = histPosRef.current < 0 ? h.length - 1 : Math.max(0, histPosRef.current - 1);
			setInput(h[histPosRef.current]);
		} else if (e.key === "ArrowDown") {
			const h = historyRef.current;
			if (histPosRef.current < 0) return;
			e.preventDefault();
			histPosRef.current = histPosRef.current + 1;
			if (histPosRef.current >= h.length) {
				histPosRef.current = -1;
				setInput("");
			} else {
				setInput(h[histPosRef.current]);
			}
		}
	};

	return (
		<Box display="flex" flexDirection="column" height="60vh">
			<Box
				ref={ref}
				onScroll={onScroll}
				bg="#0b0b0b"
				color="#7CFC7C"
				fontFamily="mono"
				fontSize="sm"
				textAlign="left"
				p={3}
				borderTopRadius="md"
				flex="1"
				minH={0}
				overflowY="auto"
			>
				{hasMore && (
					<Text color="#5a5a5a" textAlign="center" mb={2}>
						… scroll up to load older …
					</Text>
				)}
				{entries.length === 0 ? (
					<Text color="gray.500">No timer actions logged yet. Type a command below — try "help".</Text>
				) : (
					entries.map((e, i) =>
						e.line !== undefined ? (
							<Text
								key={`l${e.t}-${i}`}
								whiteSpace="pre-wrap"
								lineHeight="1.6"
								color={lineColor(e.kind)}
							>
								{e.line}
							</Text>
						) : (
							<Text key={e.id != null ? `id${e.id}` : `t${e.t}-${i}`} whiteSpace="pre-wrap" lineHeight="1.6">
								<Text as="span" color="#5a5a5a">
									[{fmtTs(e.t)}]
								</Text>
								{`: ${e.action} | ${fmtClock(e.oldMs)} -> ${fmtClock(e.newMs)} (${fmtDelta(e.addedMs)})`}
							</Text>
						)
					)
				)}
			</Box>
			<Input
				ref={inputRef}
				value={input}
				onChange={(e) => setInput(e.currentTarget.value)}
				onKeyDown={onKeyDown}
				placeholder='run a command — e.g. "youtube superchat 10", or "help"'
				bg="#000"
				color="#7CFC7C"
				fontFamily="mono"
				fontSize="sm"
				border="none"
				borderTop="1px solid #2a2a2a"
				borderBottomRadius="md"
				_placeholder={{ color: "#4a4a4a" }}
				_focus={{ boxShadow: "none", borderTop: "1px solid #3a3a3a" }}
				spellCheck={false}
				autoComplete="off"
			/>
		</Box>
	);
};

export default Terminal;
