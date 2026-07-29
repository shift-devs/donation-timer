import React from "react";

// the stroke / drop-shadow treatment shared by the timer widget and the subcount browser sources, so "drop
// shadow" means one thing across the app. it lives here rather than in Timer.tsx because that module builds
// an AudioContext at import time for the countdown beeps, which a counter source has no business creating.
//
// text-shadow and -webkit-text-stroke both inherit, so applying this to a wrapper covers every bit of text
// inside it.
export const TEXT_EFFECTS = ["stroke", "shadow"];
export const MAX_EFFECT_WIDTH = 20; // px; past this the outline swallows the glyphs

export function textEffectStyle(effect?: string, color?: string, width?: number): React.CSSProperties {
	const w = width && width > 0 ? width : 0;
	// the mode gates this, not the colour/width: a builder keeps those set while the effect is off, so
	// falling through on them would draw an outline for effect "none"
	if (!color || w <= 0)
		return {};
	if (effect === "shadow")
		// centred on the glyphs rather than offset, so it reads as an even halo and the width is the blur
		return { textShadow: `0 0 ${w}px ${color}` };
	if (effect === "stroke")
		return {
			WebkitTextStrokeWidth: `${w}px`,
			WebkitTextStrokeColor: color,
			// draw the stroke behind the glyphs; centred on the edge it eats into the letterforms instead
			paintOrder: "stroke fill",
		};
	return {};
}

// chakra's global styles paint body white, which would show through a transparent fill. any source offering
// a transparent background needs this so its own wrapper is the only thing painting one.
export const TRANSPARENT_BODY_CSS = `html, body, #root { background: transparent !important; }`;
