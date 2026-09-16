// the two decisions a typed number box has to make, kept apart from the component so they can be reasoned
// about (and tested) on their own. see NumberField.tsx for why a box that clamps on every keystroke is
// unusable — this is the half that got it wrong the first time.

// what a keystroke should push up, or null for "not yet". only text that is ALREADY a legal value commits:
// the "1" of a "100" being typed into a box with a minimum of 5 is not one, and must leave the value alone
// rather than being clamped up to 5 — which is what made 100 impossible to type.
export function typedValue(raw: string, min: number, max: number): number | null {
	if (raw.trim() === "")
		return null; // an emptied box is on its way somewhere; let it be empty
	const n = Number(raw);
	if (!Number.isFinite(n) || n < min || n > max)
		return null;
	return Math.trunc(n);
}

// what leaving the box should settle on. this is where clamping belongs, because by now the number is
// finished. junk or an empty box puts back what was there rather than inventing a default — the operator
// deleting a value and clicking away meant "leave it", not "reset it".
export function blurValue(text: string, min: number, max: number, current: number): number {
	if (text.trim() === "")
		return current;
	const n = Number(text);
	if (!Number.isFinite(n))
		return current;
	return Math.min(max, Math.max(min, Math.trunc(n)));
}
