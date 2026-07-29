import React from "react";

// the "title  [====fill====]  count / goal" row shared by the /fwprogress and /subprogress browser sources
// and by their dashboard previews. "obs" is the full-size version a browser source shows over the chroma
// fill; "preview" is the shrunken one the wizards render inline.
type Props = {
	title: string;
	value: string;   // right-hand label, already formatted ("16 / 100", or "—" before the first sync)
	pct: number;     // 0-100 fill width
	fill: string;
	track: string;
	textColor: string;
	size?: "obs" | "preview";
};

const SIZES = {
	obs: { height: "96px", radius: "48px", border: "4px", pad: "0 44px", font: "56px", maxWidth: "1600px", shadow: "0 2px 6px rgba(0,0,0,0.6)" },
	preview: { height: "38px", radius: "999px", border: "2px", pad: "0 18px", font: "20px", maxWidth: "none", shadow: "0 1px 3px rgba(0,0,0,0.6)" },
};

const ProgressBar: React.FC<Props> = ({ title, value, pct, fill, track, textColor, size = "obs" }) => {
	const s = SIZES[size];
	// title + count sit inside the bar (name left, progress right); shadow keeps them legible over the fill
	const barText: React.CSSProperties = {
		position: "relative",
		zIndex: 1,
		fontFamily: "'Staatliches', sans-serif",
		fontSize: s.font,
		fontWeight: 400,
		lineHeight: 1,
		color: textColor,
		whiteSpace: "nowrap",
		textShadow: s.shadow,
	};

	return (
		<div
			style={{
				position: "relative",
				boxSizing: "border-box",
				width: "100%",
				maxWidth: s.maxWidth,
				height: s.height,
				background: track,
				borderRadius: s.radius,
				overflow: "hidden",
				border: `${s.border} solid ${textColor}`,
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: s.pad,
			}}
		>
			{/* fill sits behind the text */}
			<div
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					height: "100%",
					width: `${Math.min(100, Math.max(0, pct))}%`,
					background: fill,
					transition: "width 0.6s ease",
					zIndex: 0,
				}}
			/>
			<div style={barText}>{title}</div>
			<div style={barText}>{value}</div>
		</div>
	);
};

export default ProgressBar;
