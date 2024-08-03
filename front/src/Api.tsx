export function sync(ws: WebSocket) {
	ws.send(
		JSON.stringify({
			event: "getTime",
		})
	);
	return 1;
}

export function setSetting(ws: WebSocket, setting: string, value: number) {
	ws.send(
		JSON.stringify({
			event: "setSetting",
			setting: setting,
			value: value,
		})
	);
	sync(ws);
	return 1;
}

export function connectSl(ws: WebSocket, socketToken: string) {
	ws.send(
		JSON.stringify({
			event: "connectStreamlabs",
			slToken: socketToken,
		})
	);
	sync(ws);
	return 1;
}

export function addTime(
	ws: WebSocket,
	currentEndTime: number,
	seconds: number
) {
	const now = Math.trunc(new Date().getTime() / 1000);
	if (currentEndTime < now) currentEndTime = now;
	seconds = Math.floor(seconds);
	console.log(
		`Trying to add ${seconds} seconds with endTime: ${currentEndTime}`
	);
	setEndTime(ws, currentEndTime + seconds);
	return 1;
}

export function setEndTime(ws: WebSocket, endTime: number) {
	console.log("Trying to set endTime to: ", endTime);
	ws.send(
		JSON.stringify({
			event: "setEndTime",
			value: endTime,
		})
	);
	sync(ws);
	return 1;
}

export function setCap(ws: WebSocket, value: boolean) {
	console.log(`Setting shouldCap to: ${value}`);
	ws.send(
		JSON.stringify({
			event: "setCap",
			value: value,
		})
	);
	return 1;
}


export function setAnon(ws: WebSocket, value: boolean) {
	console.log(`Setting ignoreAnon to: ${value}`);
	ws.send(
		JSON.stringify({
			event: "setAnon",
			value: value,
		})
	);
	return 1;
}
