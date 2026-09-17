import { useEffect, useState } from "react";

// Displayed seconds derived purely from endTime. Samples at 100ms but only
// re-renders when the integer changes (React bails on identical state), so
// second transitions land within ~100ms of the true boundary. A 1s interval's
// phase drifts against the countdown's boundaries — and reset on every server
// sync — which read as stutter (a value holding ~2s, then jumping ahead).
// frozenMs (from the sync's timerPause) holds the display still while a mystery box prize has the countdown
// paused. it has to be handled HERE rather than left to endTime: the server drags endTime forward in real
// time to keep the remaining time where it is, but a source only hears the new value every few seconds — so
// on its own it would count down from the last one it heard and jump back on the next sync.
export function useCountdownSeconds(endTime: number, frozenMs?: number | null): number {
	const [seconds, setSeconds] = useState(0);
	const paused = typeof frozenMs === "number";
	useEffect(() => {
		const tick = () => {
			const s = Math.round((paused ? (frozenMs as number) : endTime - Date.now()) / 1000);
			setSeconds(s > 0 ? s : 0);
		};
		tick(); // reflect a new endTime immediately, not at the next sample
		if (paused)
			return; // nothing moves while paused; the next sync re-runs this effect with a fresh value
		const id = setInterval(tick, 100);
		return () => clearInterval(id);
	}, [endTime, paused, frozenMs]);
	return seconds;
}
