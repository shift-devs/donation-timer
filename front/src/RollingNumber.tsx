import React, { useEffect, useRef, useState } from "react";

// odometer-style number: when the value changes, only the digit places that actually differ scroll — upward
// when the number rose, downward when it fell — while the rest stay put. that selective bit is what reads as
// a mechanical counter rather than the whole number flickering.
//
// each changed place is a two-cell strip (old digit, new digit) inside a one-cell window, animated by
// keyframes rather than a css transition: a transition needs two renders to fire, whereas remounting the
// strip on a nonce restarts the keyframes cleanly even when a new value lands mid-roll.
const CELL = 1.2;    // em per cell — over 1 so tall glyphs aren't clipped by the window
const ROLL_MS = 600; // slow enough to read as motion, short enough to settle before the next 1s poll
// a place is mod 10, so however big the jump in the number, one wheel never travels more than 9 notches —
// which is why no cap is needed here even going from 0 to a five-figure count.
const MAX_STEPS = 9;

// one keyframe pair per travel distance. the alternative, a single pair reading a per-element custom
// property, leans on var() resolving inside keyframes — fine in current chromium but not worth betting an
// on-stream graphic on when nine static pairs cost nothing.
export const ROLL_CSS = Array.from({ length: MAX_STEPS }, (_, i) => {
	const n = i + 1;
	const d = (n * CELL).toFixed(2);
	return `@keyframes rollDigitUp${n} { from { transform: translateY(0); } to { transform: translateY(-${d}em); } }\n`
		+ `@keyframes rollDigitDown${n} { from { transform: translateY(-${d}em); } to { transform: translateY(0); } }`;
}).join("\n") + "\n";

const cellStyle: React.CSSProperties = { display: "block", height: `${CELL}em`, lineHeight: `${CELL}em` };

const DIGIT = /^[0-9]$/;

// every digit a single place passes through, laid out top to bottom in the order it will be shown.
// rolling up the strip runs old -> new and animates upward; rolling down it's stored new -> old and
// animates downward, so either way the window starts on the old digit and settles on the new one.
function sweep(oldC: string, newC: string, up: boolean): string[] {
	// a comma, or a place that only just appeared, has nothing to pass through
	if (!DIGIT.test(oldC) || !DIGIT.test(newC))
		return up ? [oldC, newC] : [newC, oldC];
	const a = Number(oldC), b = Number(newC);
	const steps = up ? (b - a + 10) % 10 : (a - b + 10) % 10;
	const seq: string[] = [];
	for (let i = 0; i <= steps; i++)
		seq.push(String(up ? (a + i) % 10 : (a - i + 10) % 10));
	return up ? seq : seq.reverse();
}

// which places move, and the cells each moving one shows. null = that place is unchanged and stays put,
// which is the whole point: only the digits that differ should be in motion, and they travel different
// distances on the same clock — low places blur while high ones creep. pulled out of the component so the
// behaviour is testable without a dom.
export function rollStrips(from: string, to: string, up: boolean): (null | string[])[] {
	// pad on the left so place values stay aligned when the number gains or loses a digit (999 -> 1,000)
	const width = Math.max(from.length, to.length);
	const f = from.padStart(width, " ");
	const t = to.padStart(width, " ");
	return t.split("").map((ch, i) => (f[i] === ch ? null : sweep(f[i], ch, up)));
}

const RollingNumber: React.FC<{ value: number; animate?: boolean }> = ({ value, animate = true }) => {
	const text = value.toLocaleString();
	const prevTextRef = useRef(text);
	const prevValueRef = useRef(value);
	const [roll, setRoll] = useState({ from: text, to: text, up: true, nonce: 0 });

	useEffect(() => {
		if (text === prevTextRef.current)
			return;
		setRoll((r) => ({ from: prevTextRef.current, to: text, up: value >= prevValueRef.current, nonce: r.nonce + 1 }));
		prevTextRef.current = text;
		prevValueRef.current = value;
	}, [text, value]);

	if (!animate)
		return <>{text}</>;

	const glyph = (c: string) => (c === " " ? "" : c);
	const width = Math.max(roll.from.length, roll.to.length);
	const shown = roll.to.padStart(width, " ");
	// nonce 0 is the first render — nothing has changed yet, so nothing should be mid-roll
	const strips = roll.nonce === 0 ? shown.split("").map(() => null) : rollStrips(roll.from, roll.to, roll.up);

	return (
		<span style={{ display: "inline-flex", alignItems: "flex-start" }}>
			{shown.split("").map((ch, i) => {
				const strip = strips[i];
				if (!strip)
					return <span key={i} style={cellStyle}>{glyph(ch)}</span>;
				return (
					<span key={i} style={{ display: "inline-block", height: `${CELL}em`, overflow: "hidden", verticalAlign: "top" }}>
						<span
							key={roll.nonce}
							// fixed duration whatever the distance, so a nine-notch spin simply moves faster than a
							// one-notch tick — and every place still settles well inside the 1s poll
							style={{ display: "block", animation: `rollDigit${roll.up ? "Up" : "Down"}${strip.length - 1} ${ROLL_MS}ms cubic-bezier(.22,.61,.36,1) both` }}
						>
							{strip.map((c, j) => <span key={j} style={cellStyle}>{glyph(c)}</span>)}
						</span>
					</span>
				);
			})}
		</span>
	);
};

export default RollingNumber;
