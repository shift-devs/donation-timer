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

export function setCapSeconds(ws: WebSocket, value: number) {
	console.log(`Setting capSeconds to: ${value}`);
	send(ws, { event: "setCapSeconds", value: value });
	return 1;
}


export function setStopAtZero(ws: WebSocket, value: boolean) {
	console.log(`Setting stopAtZero to: ${value}`);
	send(ws, { event: "setStopAtZero", value: value });
	return 1;
}

export function setAnon(ws: WebSocket, value: boolean) {
	console.log(`Setting ignoreAnon to: ${value}`);
	send(ws, { event: "setAnon", value: value });
	return 1;
}

export function setSubCount(ws: WebSocket, platform: "twitch" | "youtube" | "kick", value: number) {
	if (!Number.isFinite(value)) return 1; // empty/NaN field — ignore
	send(ws, { event: "setSubCount", platform: platform, value: Math.max(0, Math.trunc(value)) });
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

export function setEventLayers(ws: WebSocket, layers: any) {
	send(ws, { event: "setEventLayers", layers: layers });
	return 1;
}

// the box list and how each one looks. the server keeps the words that are on stream — see setTextBoxText.
export function setTextBoxes(ws: WebSocket, boxes: any) {
	send(ws, { event: "setTextBoxes", boxes: boxes });
	return 1;
}

// what one box says. the same path a mod's !changetext takes, so the dashboard and chat can't disagree.
export function setTextBoxText(ws: WebSocket, box: string, text: string) {
	send(ws, { event: "setTextBoxText", box: box, text: text });
	return 1;
}

// how the /firesale source looks and behaves. merged server-side, so one field can be pushed on its own.
export function setFiresaleSettings(ws: WebSocket, settings: any) {
	send(ws, { event: "setFiresaleSettings", settings: settings });
	return 1;
}

// start a giveaway by hand — a rehearsal, or one whose Fourthwall announcement never arrived
export function startFiresale(ws: WebSocket, seconds: number, prize: string, gifter: string) {
	send(ws, { event: "startFiresale", seconds: seconds, prize: prize, gifter: gifter });
	return 1;
}

export function stopFiresale(ws: WebSocket) {
	send(ws, { event: "stopFiresale" });
	return 1;
}

// close entries early; the winner is still whoever Fourthwall announces
export function endFiresaleEntries(ws: WebSocket) {
	send(ws, { event: "endFiresaleEntries" });
	return 1;
}

export function setFiresaleWinner(ws: WebSocket, name: string) {
	send(ws, { event: "setFiresaleWinner", name: name });
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

export function setWidgetSettings(ws: WebSocket, settings: any) {
	send(ws, { event: "setWidgetSettings", settings: settings });
	return 1;
}

export function setFwProductSounds(ws: WebSocket, sounds: any) {
	send(ws, { event: "setFwProductSounds", sounds: sounds });
	return 1;
}

export function setFwProductAlerts(ws: WebSocket, alerts: any) {
	send(ws, { event: "setFwProductAlerts", alerts: alerts });
	return 1;
}

export function setFwProductBanners(ws: WebSocket, banners: any) {
	send(ws, { event: "setFwProductBanners", banners: banners });
	return 1;
}

export function setFwProductShadows(ws: WebSocket, shadows: any) {
	send(ws, { event: "setFwProductShadows", shadows: shadows });
	return 1;
}

export function setFwProductNames(ws: WebSocket, names: any) {
	send(ws, { event: "setFwProductNames", names: names });
	return 1;
}

export function getFwProducts(ws: WebSocket) {
	send(ws, { event: "getFwProducts" });
	return 1;
}

export function testFwPurchase(ws: WebSocket, product: { id: string; name: string; usd: number; image?: string }) {
	send(ws, { event: "testFwPurchase", id: product.id, name: product.name, usd: product.usd, image: product.image || "" });
	return 1;
}

export function setConnection(ws: WebSocket, platform: string, config: any) {
	send(ws, { event: "setConnection", platform: platform, config: config });
	return 1;
}

export function startTwitchSubsDeviceAuth(ws: WebSocket) {
	send(ws, { event: "startTwitchSubsDeviceAuth" });
	return 1;
}

export function runCommand(ws: WebSocket, command: string) {
	send(ws, { event: "runCommand", command: command });
	return 1;
}
