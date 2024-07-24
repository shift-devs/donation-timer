import React, { useEffect, useState } from "react";

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

	async play(doLoop: boolean = false){
		// Try asking again!
		if (audioContext.state === "suspended") {
			audioContext.resume();
			return; 
		}
		// If sourceNode is set, it's probably already playing
		if (!this.sourceNode){
			this.sourceNode = audioContext.createBufferSource();
			this.sourceNode.buffer = await this.pBufferData;
			this.sourceNode.loop = doLoop;
			this.sourceNode.connect(audioContext.destination);
			this.sourceNode.start();
		}
	}

	stop(){
		if (this.sourceNode){
			this.sourceNode.stop();
			this.sourceNode = 0;
		}
	}
}

const beep = new AAudio('/under60seconds.wav')
const shortBeep = new AAudio('/under10seconds.wav')
const shorterBeep = new AAudio('/under3seconds.wav')
const longBeep = new AAudio('/dead.wav')

let postBeepClarity = 0;
let obsDumbFix = true;

const Timer: React.FC<{
	input_seconds: number;
	textAlign?: any;
	color?: any;
}> = ({ input_seconds, textAlign = "center", color = "black" }) => {

	if (input_seconds > 0) {
		timer_text = `${Math.floor(input_seconds / 3600)}:${(
			"0" +
			(Math.floor(input_seconds / 60) % 60)
		).slice(-2)}:${("0" + (input_seconds % 60)).slice(-2)}`;
		//if (input_seconds > 107998) timer_color = "green";
		//else ;
		timer_color = color;
	} else timer_text = "0:00:00";

	/**
	 * @description Triggers whenever the input seconds changes, plays a beep according to the threshold.
	 */
	useEffect(() => {
		if (postBeepClarity > Date.now())
			return;
		if(input_seconds <= 60 && input_seconds > 10 ) {
			beep.play(true);
			shortBeep.stop();
			shorterBeep.stop();
		} else if (input_seconds <= 10 && input_seconds > 3) {
			beep.stop();
			shortBeep.play(true);
			shorterBeep.stop();
		}
		else if (input_seconds <= 3 && input_seconds > 0) {
			beep.stop();
			shortBeep.stop();
			shorterBeep.play(true);
		}
		else if(input_seconds <= 0) {
			beep.stop();
			shortBeep.stop();
			shorterBeep.stop();
			// Game over man...
			if (!obsDumbFix){
				longBeep.stop();
				longBeep.play(false);
				obsDumbFix = true;
				// Dont beep again for a bit.
				postBeepClarity = Date.now() + 6000;
			}
			return;
		}
		else {
			beep.stop();
			shortBeep.stop();
			shorterBeep.stop();
			// Keep longBeep ringing on even if the timer goes back up again.
		}
		obsDumbFix = false;
	},[input_seconds])


	return (
		<div
			className='Timer'
			style={{
				// ! We're just forcing this to white on black now.
				background:"#000000",
				color: "white",

				fontFamily: "'Staatliches', cursive",
				fontSize: "128px",
				fontWeight: 400,
				textAlign: textAlign,
			}}
		>
			{timer_text}
		</div>
	);
};

export default Timer;
