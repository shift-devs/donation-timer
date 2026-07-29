import React, { useEffect } from "react";
import { useCountdownSeconds } from "./useCountdown";

var timer_text: string;
var timer_color: string;
const audioContext = new AudioContext(); // Context switching is slow

class AAudio {
	pBufferData: Promise<AudioBuffer>
	sourceNode: AudioBufferSourceNode | any

	constructor(src: string){
		this.sourceNode = 0;
		this.pBufferData = new Promise((resolve,reject)=>{
			fetch(src).then((resp)=>{
				return resp.arrayBuffer();
			}).then((data)=>{
				audioContext.decodeAudioData(data).then((ddata)=>{
					resolve(ddata)
				})
			})
		})
	}

	async play(doLoop: boolean = false, loopStart = 0, loopEnd = 0){
		// If sourceNode is set, it's probably already playing
		if (!this.sourceNode){
			this.sourceNode = audioContext.createBufferSource();
			this.sourceNode.buffer = await this.pBufferData;
			this.sourceNode.connect(audioContext.destination);
			this.sourceNode.start();
		}
		this.sourceNode.loop = doLoop;
		this.sourceNode.loopStart = loopStart;
		this.sourceNode.loopEnd = loopEnd;
	}

	stop(){
		if (this.sourceNode){
			this.sourceNode.stop();
			this.sourceNode = 0;
		}
	}
}

const beep = new AAudio('/beep.wav')
const longBeep = new AAudio('/dead.wav')

let suspendTimeout = 0;
let postBeepClarity = 0;
let obsDumbFix = true;

// timer faces, keyed by the value that travels in the /widget url. the mono option is heavier than the
// display one because Azeret Mono at 400 reads much lighter than Staatliches at the same size.
// tightenColons: monospaced faces give ":" a full digit-wide advance, which leaves a conspicuous gap either
// side of it — see renderTimerText.
export const TIMER_FONTS: { [key: string]: { label: string; stack: string; weight: number; tightenColons?: boolean } } = {
	display: { label: "Staatliches (display)", stack: "'Staatliches', cursive", weight: 400 },
	mono: { label: "Azeret Mono (monospaced)", stack: "'Azeret Mono', monospace", weight: 700, tightenColons: true },
};

// how far each colon is pulled toward its neighbours, per side. em-based so it tracks the font size.
const COLON_TIGHTEN = "0.15em";

// splits "1:23:45" into digit groups with the colons rendered as their own pulled-in spans. only the colons
// get negative margins — the digit groups keep the face's fixed advance, which is the whole point of the
// monospaced option (digits must not shift horizontally as they tick). the proportional face is returned
// untouched, since its colon is already narrow.
export function renderTimerText(text: string, font?: string): React.ReactNode {
	const face = TIMER_FONTS[font || ""] || TIMER_FONTS.display;
	if (!face.tightenColons || !text.includes(":"))
		return text;
	return text.split(":").map((group, i) => (
		<React.Fragment key={i}>
			{i > 0 && <span style={{ marginLeft: `-${COLON_TIGHTEN}`, marginRight: `-${COLON_TIGHTEN}` }}>:</span>}
			{group}
		</React.Fragment>
	));
}

// the timer's text styling, shared by the /widget source, the dashboard timer and the widget wizard's
// preview so the three can't drift apart. effect "stroke" outlines the digits, "shadow" drops a shadow
// behind them; either needs a colour and a width > 0, otherwise the digits are drawn plain.
export function timerTextStyle(o: {
	background?: string;
	textAlign?: any;
	fontSize?: string;
	font?: string;
	effect?: string;
	effectColor?: string;
	effectWidth?: number;
}): React.CSSProperties {
	const face = TIMER_FONTS[o.font || ""] || TIMER_FONTS.display;
	const w = o.effectWidth && o.effectWidth > 0 ? o.effectWidth : 0;
	const base: React.CSSProperties = {
		// white text; black background by default (the /widget page overrides to chroma green)
		background: o.background,
		color: "white",
		fontFamily: face.stack,
		fontSize: o.fontSize || "128px",
		fontWeight: face.weight,
		textAlign: o.textAlign,
		// breathing room so left/right-aligned digits don't sit flush against the edge of the source. in em
		// so it stays proportional between the full-size source and the wizard's shrunken preview.
		padding: "0 0.15em",
		boxSizing: "border-box",
	};
	// the mode gates this, not the colour/width: those keep their last value while the effect is off, so
	// falling through on them would draw a stroke for effect "none"
	if (!o.effectColor || w <= 0)
		return base;
	if (o.effect === "shadow")
		// centred on the glyphs rather than offset, so it reads as an even halo on every side and the width
		// is simply the blur radius
		return { ...base, textShadow: `0 0 ${w}px ${o.effectColor}` };
	if (o.effect === "stroke")
		return {
			...base,
			WebkitTextStrokeWidth: `${w}px`,
			WebkitTextStrokeColor: o.effectColor,
			// draw the stroke behind the glyphs; without this the outline is centred on the edge and
			// eats into the letterforms, which is very visible on a heavy display face
			paintOrder: "stroke fill",
		};
	return base;
}

const Timer: React.FC<{
	endTime: number;
	textAlign?: any;
	color?: any;
	background?: string;
	font?: string;
	effect?: string;
	effectColor?: string;
	effectWidth?: number;
}> = ({ endTime, textAlign = "center", color = "black", background = "#000000", font = "display", effect = "none", effectColor = "", effectWidth = 0 }) => {
	// the countdown state lives here (the only thing that changes every second) so the pages that mount
	// the timer don't re-render — and drag their whole tree along — on every tick.
	const input_seconds = useCountdownSeconds(endTime);

	if (input_seconds > 0) {
		let hour = Math.floor(input_seconds / 3600);
		let min = Math.floor(input_seconds / 60) % 60;
		let sec = input_seconds % 60;
		let strBuf = "";

		if (hour >= 1)
			strBuf += `${hour}:${("0"+min).slice(-2)}:`
		else
			strBuf += `${min}:`

		strBuf += `${("0"+sec).slice(-2)}`
		timer_text = strBuf;
		timer_color = color;
	} else timer_text = "0:00";

	/**
	 * @description Triggers whenever the input seconds changes, plays a beep according to the threshold.
	 */
	useEffect(() => {
		if (suspendTimeout){
			clearTimeout(suspendTimeout);
			suspendTimeout = 0;
		}
		audioContext.resume();
		if (postBeepClarity > Date.now()){
			return;
		}
		if(input_seconds <= 60 && input_seconds > 10 ) {
			beep.play(true);
		} else if (input_seconds <= 10 && input_seconds > 3) {
			beep.play(true, 0, 0.2);
		}
		else if (input_seconds <= 3 && input_seconds > 0) {
			beep.play(true, 0, 0.1);
		}
		else if(input_seconds <= 0) {
			beep.stop();
			// Game over man...
			if (!obsDumbFix){
				longBeep.stop();
				longBeep.play(false); // One shot
				obsDumbFix = true;
				// Dont beep again for a bit.
				postBeepClarity = Date.now() + 3000;
			}
			return;
		}
		else {
			beep.stop();
			// Keep longBeep ringing on even if the timer goes back up again.
		}
		obsDumbFix = false;
		
		return ()=>{
			// Used to stop beeping if the timer disconnects while beeping
			suspendTimeout = window.setTimeout(()=>{audioContext.suspend()},2000);
		}

	},[input_seconds])


	return (
		<div className='Timer' style={timerTextStyle({ background, textAlign, font, effect, effectColor, effectWidth })}>
			{renderTimerText(timer_text, font)}
		</div>
	);
};

export default Timer;
