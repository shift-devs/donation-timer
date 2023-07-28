import React, { useEffect, useState } from "react";

var timer: string;
var timer_color: string;
const Timer: React.FC<{
	input_seconds: number;
	textAlign?: any;
	color?: any;
}> = ({ input_seconds, textAlign = "center", color = "black" }) => {

	const [beep] = useState(new Audio('/public/beep.wav'))
	const [shortBeep] = useState(new Audio('/public/2beeps1second.wav'))
	const [shorterBeep] = useState(new Audio('/public/under3seconds.wav'))

	if (input_seconds > 0) {
		timer = `${Math.floor(input_seconds / 3600)}:${(
			"0" +
			(Math.floor(input_seconds / 60) % 60)
		).slice(-2)}:${("0" + (input_seconds % 60)).slice(-2)}`;
		//if (input_seconds > 107998) timer_color = "green";
		//else ;
		timer_color = color;
	} else timer = "0:00:00";

	/**
	 * @description Triggers whenever the input seconds changes, plays a beep according to the threshold.
	 */
	useEffect(() => {
		if(input_seconds <= 60 && input_seconds > 10 ) {
			beep.pause();
			beep.currentTime=0;
			beep.play();
		} else if (input_seconds <= 10 && input_seconds > 3) {
			shortBeep.pause();
			shortBeep.currentTime=0;
			shortBeep.play();
		}
		else if (input_seconds >= 3) {
			shorterBeep.pause();
			shorterBeep.currentTime=0;
			shorterBeep.play();


			if(input_seconds === 0) {
				// TODO Timer ended! Do something.
			}
		} 
	},[input_seconds])


	return (
		<div
			className='Timer'
			style={{
				color: timer_color,
				fontFamily: "Roboto, sans-serif",
				fontSize: "128px",
				fontWeight: 400,
				textAlign: textAlign,
			}}
		>
			{timer}
		</div>
	);
};

export default Timer;
