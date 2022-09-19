import { createUser, Users } from "./db.js";
import axios from "axios";
import url from "url";
import tmi from "tmi.js";
import WebSocket from "ws";
import io from "socket.io-client";
import { user, wsType } from "./types.js";

const portWss = 3003;
const wss = new WebSocket.Server({ port: portWss });
const client_id: string = process.env.CLIENT_ID || "";
const pages: Array<string> = ["settings", "widget", "hype"];
var now = Math.trunc(Date.now() / 1000);
const allowedUsers = ["shift", "lobomfz"];
const defaultValues = {
	sub: 60,
	dollar: 15,
	pushFrequency: 1,
	timeoutTime: 30,
	widgetSyncFrequency: 1,
	forceSync: 60,
	hypeMinutes: 5,
};

const hypeSettings = {
	0: {
		subs: 5,
		seconds: 0,
	},
	1: {
		subs: 10,
		seconds: 10,
	},
	2: {
		subs: 20,
		seconds: 20,
	},
	3: {
		subs: 50,
		seconds: 30,
	},
	4: {
		seconds: 60,
		subs: 100,
	},
	5: {
		seconds: 999,
		subs: 999,
	},
};

function addHype(ws: wsType) {
	if (ws.hypeEndTime < now) {
		ws.hypeEndTime =
			Math.trunc(Date.now() / 1000) + defaultValues.hypeMinutes * 60 + 10;
		ws.currentHype = 1;
	} else {
		ws.currentHype += 1;
		if (ws.currentHype >= hypeSettings[ws.hypeLevel].subs && ws.hypeLevel < 4) {
			ws.hypeEndTime = now + defaultValues.hypeMinutes * 60;
			ws.hypeLevel += 1;
			ws.bonusTime = hypeSettings[ws.hypeLevel].seconds;
			ws.currentHype = 0;
		}
	}
	console.log(
		`adding hype, hype level: ${ws.hypeLevel}, current hype: ${ws.currentHype},hype endtime: ${ws.hypeEndTime}`
	);
	pushToDb(ws);
}

function addToEndTime(ws: wsType, seconds: number, type: string = "sub") {
	if (ws.endTime < now) ws.endTime = now;
	if (type == "donate") timeToAdd = seconds; // invert these later
	else var timeToAdd = seconds + ws.bonusTime;
	ws.endTime += timeToAdd;
	console.log(`adding ${timeToAdd} to ${ws.name}`);
	if (ws.type == "hype" && type == "sub") addHype(ws);
	syncTimer(ws);
}

function startTMI(ws: wsType) {
	console.log(`Connecting to ${ws.name} tmi`);
	const client = new tmi.Client({
		connection: {
			reconnect: true,
		},
		channels: [ws.name],
	});

	var aliveCheck = setInterval(() => {
		if (!ws.isAlive) {
			console.log(`disconnecting from ${ws.name}`);
			client.disconnect();
			clearInterval(aliveCheck);
			return 0;
		}
	}, 1000);

	client.connect();

	client.on(
		"subgift",
		(channel, username, streakMonths, recipient, methods, userstate) => {
			var plan: string = userstate["msg-param-sub-plan"] || "";
			addToEndTime(
				ws,
				(plan == "Prime" ? 1 : parseInt(plan) / 1000) * ws.subTime
			);
		}
	);

	client.on("anongiftpaidupgrade", (_channel, _username, userstate) => {
		var plan: string = userstate["msg-param-sub-plan"] || "";
		addToEndTime(
			ws,
			(plan == "Prime" ? 1 : parseInt(plan) / 1000) * ws.subTime
		);
	});

	client.on("cheer", (_channel, userstate, _message) => {
		var bits: string = userstate["bits"] || "";
		addToEndTime(ws, (parseInt(bits) / 100) * ws.dollarTime);
	});

	client.on(
		"resub",
		(_channel, _username, _months, _message, userstate, _methods) => {
			var plan: string = userstate["msg-param-sub-plan"] || "";
			addToEndTime(
				ws,
				(plan == "Prime" ? 1 : parseInt(plan) / 1000) * ws.subTime
			);
		}
	);

	client.on(
		"subscription",
		(_channel, _username, _method, _message, userstate) => {
			var plan: string = userstate["msg-param-sub-plan"] || "";
			addToEndTime(
				ws,
				(plan == "Prime" ? 1 : parseInt(plan) / 1000) * ws.subTime
			);
		}
	);
}

function connectStreamlabs(ws: wsType) {
	if (ws.socket) ws.socket.disconnect();

	console.log(`connecting to ${ws.name} sl`);

	var aliveCheck = setInterval(() => {
		if (!ws.isAlive) {
			ws.socket.disconnect();
			clearInterval(aliveCheck);
			return 0;
		}
	}, 1000);

	ws.socket = io(`https://sockets.streamlabs.com?token=${ws.slToken}`, {
		transports: ["websocket"],
	});

	ws.socket.on("connect", () => {
		console.log(`connected to ${ws.name} sl`);
		ws.slStatus = true;
		pushToDb(ws);
		syncTimer(ws);
	});

	ws.socket.on("disconnect", () => {
		ws.slStatus = false;
	});

	ws.socket.on("event", (e: any) => {
		if (e.type == "donation") {
			var amount = e.message[0].amount * ws.dollarTime;
			addToEndTime(ws, amount, "donate");
		}
	});
}

async function syncTimer(ws: wsType) {
	ws.send(
		JSON.stringify({
			success: true,
			endTime: ws.endTime,
			hypeEndTime: ws.hypeEndTime,
			subTime: ws.subTime,
			dollarTime: ws.dollarTime,
			slStatus: ws.slStatus,
			hypeLevel: ws.hypeLevel,
			currentHype: ws.currentHype,
			bonusTime: ws.bonusTime,
			nextLevel: hypeSettings[ws.hypeLevel].subs,
			nextBonus: hypeSettings[ws.hypeLevel + 1].seconds,
		})
	);
	pushToDb(ws);
}

async function login(ws: wsType, accessToken: string) {
	ws.slStatus = false;
	axios
		.get(`https://api.twitch.tv/helix/users`, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Client-Id": client_id,
			},
		})
		.then((httpRes) => {
			ws.userId = httpRes.data.data[0].id;
			ws.name = httpRes.data.data[0].login;
			if (!allowedUsers.includes(ws.name)) {
				ws.send(
					JSON.stringify({
						success: false,
						error: "not allowed",
					})
				);
				ws.close();
			}
			Users.findByPk(ws.userId).then((res: any) => {
				if (!res) {
					var newUser: user = {
						userId: ws.userId,
						name: ws.name,
						accessToken: accessToken,
						subTime: defaultValues.sub,
						dollarTime: defaultValues.dollar,
						endTime: 0,
						hypeEndTime: 0,
						bonusTime: 0,
						hypeLevel: 0,
						currentHype: 0,
					};
					Object.assign(ws, newUser);
					createUser(newUser);
					ws.initialized = true;
					startTMI(ws);
				} else {
					Object.assign(ws, res.dataValues);
					if (ws.slToken) connectStreamlabs(ws);
					else syncTimer(ws);
					startTMI(ws);
				}
			});
		})
		.catch(function (error) {
			sendError(ws, "failed to login" + error);
			return 0;
		});
}

async function pushToDb(ws: wsType) {
	if (ws.userId && ws.type == "settings") {
		Users.update(
			{
				name: ws.name,
				accessToken: ws.accessToken,
				subTime: ws.subTime,
				dollarTime: ws.dollarTime,
				slToken: ws.slToken,
				endTime: ws.endTime,
			},
			{
				where: {
					userId: ws.userId,
				},
			}
		);
	}
	if (ws.userId && ws.type == "hype") {
		Users.update(
			{
				hypeEndTime: ws.hypeEndTime,
				bonusTime: ws.bonusTime,
				hypeLevel: ws.hypeLevel,
				currentHype: ws.currentHype,
			},
			{
				where: {
					userId: ws.userId,
				},
			}
		);
	}
}

async function sendError(ws: wsType, message: string) {
	ws.send(
		JSON.stringify({
			error: message,
		})
	);
}

function heartbeat(ws: wsType) {
	ws.isAlive = true;
}

function updateSetting(ws: wsType, data: any) {
	switch (data.setting) {
		case "subTime":
			console.log(`setting ${ws.name} sub time to`, parseInt(data.value) || 60);
			ws.subTime = parseInt(data.value) || 60;
			break;
		case "dollarTime":
			console.log(
				`setting ${ws.name} dollar time to`,
				parseInt(data.value) || 60
			);
			ws.dollarTime = parseInt(data.value) || 15;
			break;
	}
}

function syncWidget(ws: wsType) {
	Users.findByPk(ws.userId).then((res: any) => {
		if (ws.endTime !== res.dataValues.endTime) {
			ws.endTime = res.dataValues.endTime;
			syncTimer(ws);
		}
	});
}

function getBonusTime(ws: wsType) {
	Users.findByPk(ws.userId).then((res: any) => {
		if (res)
			if (ws.bonusTime !== res.dataValues.bonusTime) {
				ws.bonusTime = res.dataValues.bonusTime;
			}
	});
}

function hypeCleanup(ws: wsType) {
	if (ws.hypeEndTime < now && ws.currentHype > 0) {
		ws.hypeLevel = 0;
		ws.currentHype = 0;
		ws.bonusTime = 0;
		if (ws.type == "hype") pushToDb(ws);
		syncTimer(ws);
	}
}

function main() {
	setInterval(() => (now = Math.trunc(Date.now() / 1000)), 1000);

	wss.on("connection", (ws: wsType, req: any) => {
		ws.isAlive = true;
		ws.on("pong", () => heartbeat(ws));
		var urlParams = url.parse(req.url, true).query;
		if (urlParams.token) {
			try {
				login(ws, urlParams.token as string);
			} catch (error) {
				sendError(ws, "invalid token.");
				return 0;
			}
		}

		if (
			typeof urlParams["page"] == "string" &&
			pages.includes(urlParams["page"])
		)
			ws.type = urlParams["page"];

		if (ws.type == "widget")
			var updateWidget = setInterval(
				() => syncWidget(ws),
				defaultValues.widgetSyncFrequency * 1000
			);

		if (ws.type !== "hype")
			var getBonus = setInterval(
				() => getBonusTime(ws),
				defaultValues.widgetSyncFrequency * 1000
			);

		var cleanupInterval = setInterval(() => hypeCleanup(ws), 1000);

		var forceSync = setInterval(
			() => syncTimer(ws),
			defaultValues.forceSync * 1000
		);

		ws.on("close", () => {
			ws.isAlive = false;
			console.log(`Disconnected from ${ws.name}`);
			clearInterval(forceSync);
			clearInterval(cleanupInterval);
			if (ws.type == "widget") clearInterval(updateWidget);
			if (ws.type !== "hype") clearInterval(getBonus);
		});

		ws.onmessage = function (event: any) {
			try {
				var data = JSON.parse(event.data);
			} catch (error) {
				sendError(ws, "json error");
				return 0;
			}

			switch (data.event) {
				case "getTime":
					syncTimer(ws);
					break;
				case "connectStreamlabs":
					if (data.slToken.length < 300) ws.slToken = data.slToken;
					pushToDb(ws);
					connectStreamlabs(ws);
					break;
				case "setSetting":
					updateSetting(ws, data);
					pushToDb(ws);
					break;
				case "setEndTime":
					ws.endTime = parseInt(data.value) || 0;
					pushToDb(ws);
					syncTimer(ws);
					break;
			}
		};
	});

	const timeout = setInterval(function ping() {
		wss.clients.forEach(function each(ws: any) {
			if (ws.isAlive === false) return ws.terminate();
			console.log(`pinging ${ws.name} at ${ws.endTime - now}`);
			ws.isAlive = false;
			ws.ping();
		});
	}, defaultValues.timeoutTime * 1000);

	wss.on("close", function close() {
		clearInterval(timeout);
	});
}

main();
