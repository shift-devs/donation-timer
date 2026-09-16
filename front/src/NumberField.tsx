import React, { useEffect, useState } from "react";
import { Input } from "@chakra-ui/react";
import { typedValue, blurValue } from "./numberInput";

// a number box you can actually type in.
//
// the obvious version — a controlled input that clamps in its onChange — is unusable for any field whose
// minimum is above 1. typing the "1" of "100" into a box that won't go below 5 clamps it to 5 on the first
// keystroke, so the box now reads 5 and the 00 land on the end of THAT; three digits are unreachable. and
// backspacing to empty parses as NaN, which the same handler replaces with the old value, so the field can't
// be cleared either. it reads as the box fighting you, because it is.
//
// so the text is local while the box has focus, the value is only pushed up when what's been typed is
// already a legal number, and the clamp waits until you leave. a half-typed "1" on its way to "100" simply
// doesn't move anything yet. this is the same bargain Events.tsx makes with its time boxes, for the same
// reason — a value prop that rewrites the box mid-keystroke eats what you're typing.
const NumberField: React.FC<{
	value: number;
	min: number;
	max: number;
	// called with a clamped whole number, and only when it's worth acting on: while typing, only for text
	// that's already in range; on blur, once more if leaving the box changed anything
	onCommit: (n: number) => void;
	width?: string;
	placeholder?: string;
}> = ({ value, min, max, onCommit, width = "100px", placeholder }) => {
	const [text, setText] = useState(String(value));
	const [editing, setEditing] = useState(false);

	// follow the value from above only while the box ISN'T being typed in — that's the whole point
	useEffect(() => {
		if (!editing)
			setText(String(value));
	}, [value, editing]);

	return (
		<Input
			size="sm"
			maxW={width}
			inputMode="numeric"
			placeholder={placeholder}
			value={text}
			onFocus={() => setEditing(true)}
			onChange={(e) => {
				const raw = e.target.value;
				setText(raw);
				const n = typedValue(raw, min, max);
				if (n !== null)
					onCommit(n);
			}}
			onBlur={() => {
				setEditing(false);
				const next = blurValue(text, min, max, value);
				setText(String(next));
				if (next !== value)
					onCommit(next);
			}}
		/>
	);
};

export default NumberField;
