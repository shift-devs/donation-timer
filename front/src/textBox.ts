import React from "react";
import { textEffectStyle } from "./textEffect";

// the look of a text box, shared by the /text browser source and the dashboard's preview of it, so what the
// operator sets up is what OBS draws. the box itself (name, words, look) lives on the server — see
// back/src/textBoxes.ts, whose defaults and allowed values these MUST match, or a save would quietly reset a
// field the dashboard just set.

// sans is Roboto (already loaded for the dashboard); the other two are the timer widget's faces, so a text box
// can be made to match the countdown sitting next to it.
export const TEXT_FONTS: { [key: string]: { label: string; stack: string; weight: number; boldWeight: number } } = {
	sans: { label: "Roboto (sans)", stack: "'Roboto', sans-serif", weight: 400, boldWeight: 700 },
	display: { label: "Staatliches (display)", stack: "'Staatliches', cursive", weight: 400, boldWeight: 700 },
	mono: { label: "Azeret Mono (monospaced)", stack: "'Azeret Mono', monospace", weight: 400, boldWeight: 700 },
};

export const MAX_TEXT = 500;
export const MAX_FONT_SIZE = 400;
export const MAX_EFFECT_WIDTH = 20;

export const DEFAULT_TEXT_BOX = {
	id: "",
	name: "",
	text: "",
	font: "sans",
	fontSize: 64,
	color: "#ffffff",
	bgColor: "transparent",
	align: "center",
	valign: "middle",
	bold: false,
	effect: "none",
	effectColor: "#000000",
	effectWidth: 4,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function hexOr(v: any, fallback: string, extra?: string): string {
	const s = typeof v === "string" ? v.trim() : "";
	if (extra && s === extra)
		return s;
	return HEX.test(s) ? s : fallback;
}

function numIn(v: any, min: number, max: number, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

// fill in whatever the server left out (or a hand-mangled url asked for), so both the source and the dashboard
// always render a complete box
export function canonTextBox(raw: any) {
	const r = raw && typeof raw === "object" ? raw : {};
	const d = DEFAULT_TEXT_BOX;
	return {
		id: typeof r.id === "string" ? r.id : "",
		name: typeof r.name === "string" ? r.name : "",
		text: typeof r.text === "string" ? r.text.slice(0, MAX_TEXT) : "",
		font: TEXT_FONTS[r.font] ? r.font : d.font,
		fontSize: numIn(r.fontSize, 8, MAX_FONT_SIZE, d.fontSize),
		color: hexOr(r.color, d.color),
		bgColor: hexOr(r.bgColor, d.bgColor, "transparent"),
		align: ["left", "center", "right"].includes(r.align) ? r.align : d.align,
		valign: ["top", "middle", "bottom"].includes(r.valign) ? r.valign : d.valign,
		bold: !!r.bold,
		effect: ["none", "stroke", "shadow"].includes(r.effect) ? r.effect : d.effect,
		effectColor: hexOr(r.effectColor, d.effectColor),
		effectWidth: numIn(r.effectWidth, 0, MAX_EFFECT_WIDTH, d.effectWidth),
	};
}

// everything but the positioning: the source stretches this over the whole viewport, the dashboard preview puts
// it in a small box at a smaller font size (hence the override).
export function textBoxStyle(box: any, fontSize?: number): React.CSSProperties {
	const f = TEXT_FONTS[box.font] || TEXT_FONTS.sans;
	return {
		display: "flex",
		flexDirection: "column",
		justifyContent: box.valign === "top" ? "flex-start" : box.valign === "bottom" ? "flex-end" : "center",
		background: box.bgColor,
		color: box.color,
		fontFamily: f.stack,
		fontWeight: box.bold ? f.boldWeight : f.weight,
		fontSize: `${fontSize == null ? box.fontSize : fontSize}px`,
		lineHeight: 1.2,
		textAlign: box.align,
		// the words as typed: keep the line breaks, and wrap a long one rather than let it run off the source
		whiteSpace: "pre-wrap",
		overflowWrap: "break-word",
		overflow: "hidden",
		padding: "0.15em 0.3em",
		boxSizing: "border-box",
		...textEffectStyle(box.effect, box.effectColor, box.effectWidth),
	};
}
