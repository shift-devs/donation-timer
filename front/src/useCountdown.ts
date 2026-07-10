import { useEffect, useState } from "react";

// Displayed seconds derived purely from endTime. Samples at 100ms but only
// re-renders when the integer changes (React bails on identical state), so
// second transitions land within ~100ms of the true boundary. A 1s interval's
// phase drifts against the countdown's boundaries — and reset on every server
// sync — which read as stutter (a value holding ~2s, then jumping ahead).
export function useCountdownSeconds(endTime: number): number {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		const tick = () => {
			const s = Math.round((endTime - Date.now()) / 1000);
			setSeconds(s > 0 ? s : 0);
		};
		tick(); // reflect a new endTime immediately, not at the next sample
		const id = setInterval(tick, 100);
		return () => clearInterval(id);
	}, [endTime]);
	return seconds;
}
