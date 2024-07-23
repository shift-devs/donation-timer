import { createUser, Users } from "./db.js";
import axios from "axios";
import url from "url";
import tmi from "tmi.js";
import WebSocket from "ws";
import io from "socket.io-client";
import { user, wsType } from "./types.js";
import { hypeTiersTime, processTimerTiers, capTime } from "./hypeTimeTiers.js";

const portWss = 3003;
const wss = new WebSocket.Server({ port: portWss });
const client_id: string = process.env.CLIENT_ID || "";
const pages: Array<string> = ["settings", "widget", "hype", "timebonus"];

var now = Math.trunc(Date.now() / 1000);

const allowedUsers = ["shift", "lobomfz", "yoman47", "darkrta", "the_ivo_robotnic", "aaronrules5"];

export const defaultValues = {
	sub: 85,
	dollar: 21,
	pushFrequency: 1,
	timeoutTime: 30,
	widgetSyncFrequency: 1,
	forceSync: 5,
	hypeMinutes: 5,
	maxHours: 30,
};

const hypeSettings = {
	0: {
		0: {
			subs: 0,
			seconds: 0,
		},
		1: {
			subs: 10,
			seconds: 10,
		},
		2: {
			subs: 15,
			seconds: 20,
		},
		3: {
			subs: 30,
			seconds: 50,
		},
		4: {
			subs: 10,
			seconds: 60,
		},
	},
	1: {
		0: {
			subs: 0,
			seconds: 10,
		},
		1: {
			subs: 10,
			seconds: 20,
		},
		2: {
			subs: 15,
			seconds: 30,
		},
		3: {
			subs: 30,
			seconds: 50,
		},
		4: {
			subs: 10,
			seconds: 60,
		},
	},
	2: {
		0: {
			subs: 0,
			seconds: 20,
		},
		1: {
			subs: 10,
			seconds: 30,
		},
		2: {
			subs: 15,
			seconds: 40,
		},
		3: {
			subs: 30,
			seconds: 50,
		},
		4: {
			subs: 10,
			seconds: 60,
		},
	},
};

function addHype(ws: wsType) {
	return 0;
	if (ws.type !== "settings") return 0;
	ws.currentHype += 1;

	if (ws.hypeEndTime < now) {
		ws.hypeEndTime =
			Math.trunc(Date.now() / 1000) + defaultValues.hypeMinutes * 60;
	}

	if (
		ws.hypeLevel < 3 &&
		ws.currentHype >= hypeSettings[ws.currentTimeTier][ws.hypeLevel + 1].subs
	) {
		ws.hypeEndTime =
			Math.trunc(Date.now() / 1000) + defaultValues.hypeMinutes * 60;
		ws.hypeLevel += 1;
		ws.currentHype = 0;
	}

	console.log(
		`adding hype, hype level: ${ws.hypeLevel}, current hype: ${ws.currentHype},hype endtime: ${ws.hypeEndTime}, page: ${ws.type}`
	);
	hypeCleanup(ws);
}

function addToEndTime(ws: wsType, seconds: number, tier: number = 1) {
	if (ws.endTime < now) ws.endTime = now;

	if (ws.type == "settings") {
		var timeToAdd = seconds + ws.bonusTime;
		ws.endTime += Math.floor(timeToAdd);
		console.log(`adding ${timeToAdd} to ${ws.name}`);
		// ! Disabled hype addition. -yoman
		//for (var i = 0; i < tier; i++) {
			//addHype(ws);
		//}
	}
	syncTimer(ws);
}

function addDollarToEndTime(ws: wsType, dollar: number) {
	if (ws.endTime < now) ws.endTime = now;
	var tierModifier: number = 0;
	switch (ws.currentTimeTier) {
		case 0:
			tierModifier = 14;
			break;
		case 1:
			tierModifier = 16;
			break;
		case 2:
			tierModifier = 18;
			break;
	}

	if (ws.type == "settings") {
		ws.endTime += Math.floor(tierModifier * dollar);
		console.log(`adding ${tierModifier * dollar} to ${ws.name}`);
	}

	syncTimer(ws);
}

function startTMI(ws: wsType) {
	var tries = 0;
	if (ws.type !== "settings") return 0;
	console.log(`Connecting to ${ws.name} tmi`);
	const client = new tmi.Client({
		connection: {
			reconnect: true,
			reconnectInterval: 5000,
		},
		channels: [ws.name],
	});

	var aliveCheck = setInterval(() => {
		if (ws.readyState == 3) tries += 1;
		else tries = 0;
		if (tries > 5) {
			client.disconnect();
			console.log(`TMI IS NOT ALIVE, disconnecting from ${ws.name} tmi`);
			clearInterval(aliveCheck);
			return 0;
		}
	}, 1000);

	client.connect();

	client.on("connecting", l("connecting"));
	client.on("connected", l("connected"));

	function l(event) {
		return function () {
			console.log(new Date().toISOString(), " EVENT 123: " + event, arguments);
		};
	}

	client.on("message", (channel, tags, message, self) => {
		var mSplit = message.toLowerCase().split(" ");
		console.log(`message: ${message}`);

		if (tags.username) {
			if (tags.mod || tags.username.toLowerCase() == ws.name)
				switch (mSplit[0]) {
					case "!addsub":
						if (mSplit[1] || parseInt(mSplit[1]) < 200)
							for (var i = 0; i < parseInt(mSplit[1]); i++) {
								console.log(`adding: ${ws.subTime}`);
								addToEndTime(ws, ws.subTime, 1);
							}
						else addToEndTime(ws, ws.subTime, 1);
						break;
					case "!addtime":
						addToEndTime(ws, parseInt(mSplit[1]), 0);
						break;
					case "!addcombo":
						if (mSplit[1] || parseInt(mSplit[1]) < 200)
							for (var i = 0; i < parseInt(mSplit[1]); i++) {
								addHype(ws);
							}
						else addHype(ws);
						break;
				}
		}
	});

	client.on(
		"subgift",
		(channel, username, streakMonths, recipient, methods, userstate) => {
			var plan: string = userstate["msg-param-sub-plan"] || "";
			var tier: number = plan == "Prime" ? 1 : parseInt(plan) / 1000;
			if (tier == 3) tier = 5;
			addToEndTime(ws, tier * ws.subTime, tier);
		}
	);

	client.on("anongiftpaidupgrade", (_channel, _username, userstate) => {
		var plan: string = userstate["msg-param-sub-plan"] || "";
		var tier: number = plan == "Prime" ? 1 : parseInt(plan) / 1000;
		if (tier == 3) tier = 5;
		addToEndTime(ws, tier * ws.subTime, tier);
	});

	client.on("cheer", (_channel, userstate, _message) => {
		var bits: string = userstate["bits"] || "";
		addDollarToEndTime(ws, parseInt(bits) / 100);
	});

	client.on(
		"resub",
		(_channel, _username, _months, _message, userstate, _methods) => {
			var plan: string = userstate["msg-param-sub-plan"] || "";
			var tier: number = plan == "Prime" ? 1 : parseInt(plan) / 1000;
			if (tier == 3) tier = 5;
			addToEndTime(ws, tier * ws.subTime, tier);
		}
	);

	client.on(
		"subscription",
		(_channel, _username, _method, _message, userstate) => {
			var plan: string = userstate["msg-param-sub-plan"] || "";
			var tier: number = plan == "Prime" ? 1 : parseInt(plan) / 1000;
			if (tier == 3) tier = 5;
			addToEndTime(ws, tier * ws.subTime, tier);
		}
	);
}

function connectStreamlabs(ws: wsType) {
	if (ws.type !== "settings") return 0;

	if (ws.socket) ws.socket.disconnect();

	console.log(`connecting to ${ws.name} sl`);

	var aliveCheck = setInterval(() => {
		if (ws.readyState == 3) {
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
		syncTimer(ws);
	});

	ws.socket.on("disconnect", () => {
		ws.slStatus = false;
	});

	ws.socket.on("event", (e: any) => {
		console.log(`slevent: ${JSON.stringify(e)}`);
		if (e.type == "donation") {
			addDollarToEndTime(ws, e.message[0].amount);
		}
	});
}

async function syncTimer(ws: wsType) {
	var nbonus: any = null;

	if (typeof ws.hypeLevel === "undefined") {
		ws.hypeLevel = 0;
	} else if (hypeSettings[ws.currentTimeTier][ws.hypeLevel])
		if ("seconds" in hypeSettings[ws.currentTimeTier][ws.hypeLevel + 1]) {
			nbonus = hypeSettings[ws.currentTimeTier][ws.hypeLevel + 1].seconds;
		}

	ws.send(
		JSON.stringify({
			success: true,
			hypeTimer: ws.hypeEndTime - Math.trunc(Date.now() / 1000),
			endTime: ws.endTime,
			hypeEndTime: ws.hypeEndTime,
			subTime: ws.subTime,
			dollarTime: ws.dollarTime,
			slStatus: ws.slStatus,
			hypeLevel: ws.hypeLevel,
			currentHype: ws.currentHype,
			bonusTime: ws.bonusTime,
			nextLevel: hypeSettings[ws.currentTimeTier][ws.hypeLevel + 1].subs,
			nextBonus: nbonus,
			timeTier: ws.currentTimeTier,
			nextTimeTier: hypeTiersTime[ws.currentTimeTier + 1] / 3600,
			cap: ws.shouldCap,
			currentTimeTier: ws.currentTimeTier,
		})
	);
}

async function login(ws: wsType, accessToken: string) {
	ws.slStatus = false;
	console.log(`loggin in ${ws.name} on ${ws.type}`);
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
					if (ws.slToken && ws.type !== "hype") connectStreamlabs(ws);
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
				endTime: Math.floor(ws.endTime),
				hypeEndTime: Math.floor(ws.hypeEndTime),
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
			if (parseInt(data.value)) ws.subTime = parseInt(data.value);
			break;
		case "dollarTime":
			if (parseInt(data.value)) ws.dollarTime = parseInt(data.value);
			break;
	}
}

function syncWidget(ws: wsType) {
	if (ws.type !== "settings")
		Users.findByPk(ws.userId).then((res: any) => {
			if (res) {
				if (
					ws.hypeEndTime !== res.dataValues.hypeEndTime ||
					ws.subTime !== res.dataValues.subTime ||
					ws.bonusTime !== res.dataValues.bonusTime ||
					ws.hypeLevel !== res.dataValues.hypeLevel ||
					ws.currentHype !== res.dataValues.currentHype ||
					ws.endTime !== res.dataValues.endTime
				) {
					ws.hypeEndTime = res.dataValues.hypeEndTime;
					ws.subTime = res.dataValues.subTime;
					ws.bonusTime = res.dataValues.bonusTime;
					ws.hypeLevel = res.dataValues.hypeLevel;
					ws.currentHype = res.dataValues.currentHype;
					ws.endTime = res.dataValues.endTime;
					syncTimer(ws);
				}
			}
		});
}

function syncEndTime(ws: wsType) {
	if (ws.type !== "settings")
		Users.findByPk(ws.userId).then((res: any) => {
			if (res) {
				if (ws.endTime !== res.dataValues.endTime) {
					ws.endTime = res.dataValues.endTime;

					syncTimer(ws);
				}
			}
		});
}

function hypeCleanup(ws: wsType) {
	if (
		ws.hypeLevel == 3 &&
		ws.currentHype >= hypeSettings[ws.currentTimeTier][ws.hypeLevel + 1].subs
	) {
		ws.hypeEndTime =
			ws.hypeEndTime +
			hypeSettings[ws.currentTimeTier][ws.hypeLevel + 1].seconds;
		ws.currentHype =
			ws.currentHype - hypeSettings[ws.currentTimeTier][ws.hypeLevel + 1].subs;
		syncTimer(ws);
	}

	ws.bonusTime = hypeSettings[ws.currentTimeTier][ws.hypeLevel].seconds;

	if (ws.hypeEndTime < now)
		if (ws.currentHype > 0 || ws.hypeLevel > 0) {
			ws.hypeLevel = 0;
			ws.currentHype = 0;
			ws.bonusTime = 0;
			syncTimer(ws);
		}
}

async function initialize(ws: wsType, intervals: any) {
	ws.currentTimeTier = 0;
	intervals.syncProcessTimerTiersInterval = setInterval(
		() => processTimerTiers(ws),
		1000
	);

	intervals.forceSync = setInterval(
		() => syncTimer(ws),
		defaultValues.forceSync * 1000
	);

	switch (ws.type) {
		case "timebonus":
			intervals.syncEndTime = setInterval(() => syncEndTime(ws), 1000);
			break;
		case "hype":
		case "widget":
			syncWidget(ws);
			intervals.syncWidgetInterval = setInterval(() => syncWidget(ws), 1000);
			break;
		case "settings":
			hypeCleanup(ws);
			ws.shouldLogin = true;
			intervals.tryToCap = setInterval(() => capTime(ws), 1000);
			intervals.forceSyncDb = setInterval(() => pushToDb(ws), 1000);
			intervals.syncHypeInterval = setInterval(() => hypeCleanup(ws), 1000);
			break;
	}
	syncTimer(ws);
}

async function closeStuff(ws: wsType, intervals: any) {
	clearInterval(intervals.forceSync);
	clearInterval(intervals.syncProcessTimerTiersInterval);

	switch (ws.type) {
		case "timebonus":
			clearInterval(intervals.syncEndTime);
			break;
		case "hype":
		case "widget":
			clearInterval(intervals.syncWidgetInterval);
			break;
		case "settings":
			clearInterval(intervals.syncHypeInterval);
			clearInterval(intervals.forceSyncDb);
			break;
	}
}

function main() {
	setInterval(() => (now = Math.trunc(Date.now() / 1000)), 1000);

	wss.on("connection", (ws: wsType, req: any) => {
		var intervals: any = {};
		ws.hypeLevel = 0;
		ws.currentTimeTier = 0;
		ws.shouldCap = false;
		ws.isAlive = true;
		ws.on("pong", () => heartbeat(ws));
		var urlParams = url.parse(req.url, true).query;
		if (
			typeof urlParams["page"] == "string" &&
			pages.includes(urlParams["page"])
		)
			ws.type = urlParams["page"];

		initialize(ws, intervals);

		if (urlParams.token) {
			try {
				console.log(urlParams.token);
				login(ws, urlParams.token as string);
			} catch (error) {
				sendError(ws, "invalid token.");
				return 0;
			}
		}

		ws.on("close", () => {
			ws.isAlive = false;
			console.log(`Disconnected from ${ws.name}`);
			closeStuff(ws, intervals);
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
					connectStreamlabs(ws);
					break;
				case "setSetting":
					updateSetting(ws, data);
					break;
				case "setEndTime":
					ws.endTime = Math.floor(parseInt(data.value) || 0);
					syncTimer(ws);
					break;
				case "setCap":
					ws.shouldCap = Boolean(data.value) || false;
					syncTimer(ws);
					break;
			}
		};
	});

	const timeout = setInterval(function ping() {
		wss.clients.forEach(function each(ws: any) {
			console.log(`pinging ${ws.name} on page ${ws.type}`);
			if (ws.isAlive === false) return ws.terminate();
			ws.isAlive = false;
			ws.ping();
		});
	}, defaultValues.timeoutTime * 1000);

	wss.on("close", function close() {
		clearInterval(timeout);
	});
}

main();
