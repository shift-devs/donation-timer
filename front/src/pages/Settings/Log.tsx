import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Box, Text } from "@chakra-ui/react";

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

const Log: React.FC<{ entries: any[]; hasMore: boolean; active: boolean; onLoadOlder: () => void }> = ({
	entries,
	hasMore,
	active,
	onLoadOlder,
}) => {
	const ref = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef(true);
	const prevHeightRef = useRef(0);
	const loadingOlderRef = useRef(false);
	const prevLenRef = useRef(0);

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

	// land at the bottom when the tab is opened
	useEffect(() => {
		const el = ref.current;
		if (active && el) {
			el.scrollTop = el.scrollHeight;
			pinnedRef.current = true;
		}
	}, [active]);

	return (
		<Box
			ref={ref}
			onScroll={onScroll}
			bg="#0b0b0b"
			color="#7CFC7C"
			fontFamily="mono"
			fontSize="sm"
			textAlign="left"
			p={3}
			borderRadius="md"
			height="60vh"
			overflowY="auto"
		>
			{hasMore && (
				<Text color="#5a5a5a" textAlign="center" mb={2}>
					… scroll up to load older …
				</Text>
			)}
			{entries.length === 0 ? (
				<Text color="gray.500">No timer actions logged yet.</Text>
			) : (
				entries.map((e, i) => (
					<Text key={e.id != null ? `id${e.id}` : `t${e.t}-${i}`} whiteSpace="pre-wrap" lineHeight="1.6">
						<Text as="span" color="#5a5a5a">
							[{fmtTs(e.t)}]
						</Text>
						{`: ${e.action} | ${fmtClock(e.oldMs)} -> ${fmtClock(e.newMs)} (${fmtDelta(e.addedMs)})`}
					</Text>
				))
			)}
		</Box>
	);
};

export default Log;
