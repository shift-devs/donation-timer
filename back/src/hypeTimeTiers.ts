import { defaultValues } from "./index.js";
import { wsType } from "./types.js";

export const hypeTiersTime = {
	0: 0,
	1: 10 * 3600,
	2: 20 * 3600,
	3: 30 * 3600,
};

export function processTimerTiers(ws: wsType) {
	if (ws.endTime - Math.trunc(Date.now() / 1000) > hypeTiersTime[2])
		ws.currentTimeTier = 2;
	else if (ws.endTime - Math.trunc(Date.now() / 1000) > hypeTiersTime[1])
		ws.currentTimeTier = 1;
	else {
		ws.currentTimeTier = 0;
	}
}

export function capTime(ws: wsType) {
	if (
		ws.shouldCap &&
		ws.endTime > Math.trunc(Date.now() / 1000) + defaultValues.maxHours * 3600
	)
		ws.endTime = Math.trunc(Date.now() / 1000) + defaultValues.maxHours * 3600;
}
