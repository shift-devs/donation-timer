import React from "react";

var timer: string;
var timer_color: string;
const Timer: React.FC<{
	input_seconds: number;
	textAlign?: any;
	color?: any;
}> = ({ input_seconds, textAlign = "center", color = "black" }) => {
	if (input_seconds > 0) {
		timer = `${Math.floor(input_seconds / 3600)}:${(
			"0" +
			(Math.floor(input_seconds / 60) % 60)
		).slice(-2)}:${("0" + (input_seconds % 60)).slice(-2)}`;
		//if (input_seconds > 107998) timer_color = "green";
		//else ;
		timer_color = color;
	} else timer = "0:00:00";

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
