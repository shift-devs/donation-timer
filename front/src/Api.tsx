// all outbound messages go through here; never send on a closed/reconnecting socket (would throw in the caller)
function send(ws: WebSocket, payload: any) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify(payload));
}

export function sync(ws: WebSocket) {
	send(ws, { event: "getTime" });
	return 1;
}

export function setSetting(ws: WebSocket, setting: string, value: number) {
	send(ws, { event: "setSetting", setting: setting, value: value });
	sync(ws);
	return 1;
}

export function connectSl(ws: WebSocket, socketToken: string) {
	send(ws, { event: "connectStreamlabs", slToken: socketToken });
	sync(ws);
	return 1;
}

export function addTime(
	ws: WebSocket,
	currentEndTime: number,
	seconds: number
) {
	if (!Number.isFinite(seconds)) return 1; // empty/NaN input from a number field — ignore
	const now = Date.now();
	if (currentEndTime < now) currentEndTime = now;
	console.log(
		`Trying to add ${seconds} seconds with endTime: ${currentEndTime}`
	);
	setEndTime(ws, currentEndTime + Math.round(seconds * 1000));
	return 1;
}

export function setEndTime(ws: WebSocket, endTime: number) {
	if (!Number.isFinite(endTime)) return 1; // never push a NaN deadline
	console.log("Trying to set endTime to: ", endTime);
	send(ws, { event: "setEndTime", value: endTime });
	sync(ws);
	return 1;
}

export function setCap(ws: WebSocket, value: boolean) {
	console.log(`Setting shouldCap to: ${value}`);
	send(ws, { event: "setCap", value: value });
	return 1;
}


export function setAnon(ws: WebSocket, value: boolean) {
	console.log(`Setting ignoreAnon to: ${value}`);
	send(ws, { event: "setAnon", value: value });
	return 1;
}

export function setRates(ws: WebSocket, rates: any) {
	send(ws, { event: "setRates", rates: rates });
	return 1;
}

export function setTimerEvents(ws: WebSocket, timerEvents: any) {
	send(ws, { event: "setTimerEvents", timerEvents: timerEvents });
	return 1;
}

export function testTimerEvent(ws: WebSocket, id: string) {
	send(ws, { event: "testTimerEvent", id: id });
	return 1;
}

export function setFwProductBonuses(ws: WebSocket, bonuses: any) {
	send(ws, { event: "setFwProductBonuses", bonuses: bonuses });
	return 1;
}

export function getFwProducts(ws: WebSocket) {
	send(ws, { event: "getFwProducts" });
	return 1;
}

export function setConnection(ws: WebSocket, platform: string, config: any) {
	send(ws, { event: "setConnection", platform: platform, config: config });
	return 1;
}

export function runCommand(ws: WebSocket, command: string) {
	send(ws, { event: "runCommand", command: command });
	return 1;
}
