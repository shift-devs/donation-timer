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
const pages: Array<string> = ["settings", "widget"];

var now = Math.trunc(Date.now() / 1000);

const allowedUsers = ["shift", "aaronrules5", "darkrta", "the_ivo_robotnic", "yoman47", "lobomfz"];
const chatCmdMaxTime = 10*3600;
export const defaultValues = {
	sub: 70,
	dollar: 14,
	pushFrequency: 1,
	timeoutTime: 30,
	widgetSyncFrequency: 1,
	forceSync: 5,
	maxHours: 30,
};

function capTime(ws: wsType) {
	let maxEndtime = Math.trunc(Date.now() / 1000) + defaultValues.maxHours * 3600;
	if (ws.shouldCap && ws.endTime > maxEndtime)
		ws.endTime = maxEndtime
}

function addToEndTime(ws: wsType, seconds: number) {
	if (ws.endTime < now) ws.endTime = now;

	if (ws.type == "settings") {
		ws.endTime += Math.floor(seconds);
		console.log(`Adding ${seconds} seconds to ${ws.name}'s endTime!`);
	}
	capTime(ws);
	syncTimer(ws);
}

function addDollarToEndTime(ws: wsType, dollar: number) {
	if (ws.endTime < now) ws.endTime = now;

	if (ws.type == "settings") {
		const addSecs = Math.floor(ws.dollarTime * dollar);
		ws.endTime += addSecs;
		console.log(`Adding ${addSecs} seconds to ${ws.name}'s endTime!`);
	}
	capTime(ws);
	syncTimer(ws);
}

function startTMI(ws: wsType) {
	var tries = 0;
	if (ws.type !== "settings") return 0;

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
			console.log(`TMI is no longer alive. Disconnecting from ${ws.name} TMI.`);
			clearInterval(aliveCheck);
			return 0;
		}
	}, 1000);

	client.connect();

	client.on("connecting", l("Connecting to TMI..."));
	client.on("connected", l("Connected to TMI!"));

	function l(event) {
		return function(){
			console.log(event, arguments);
		}
	}
	client.on("message", (channel, tags, message, self) => {
		let filterMessage = message.toLowerCase().replaceAll(/[^ -~]/g,"").trim();
		var mSplit = filterMessage.split(" ");
		console.log(`TWITCH MESSAGE - ${tags.username}: ${message}`);
		if (tags.username) {
			if (tags.mod || tags.username.toLowerCase() == ws.name){
				let timeToAdd = 0;
				switch (mSplit[0]) {
					case "!nop":
						console.log("No operation!");
						break;
					case "!addsub":
						var subs = 1, tier = 1, ptr = 1;
						while (ptr < mSplit.length){
							if (mSplit[ptr].charAt(0) == "t"){
								tier = parseInt(mSplit[ptr].slice(1),10);
								if (!(tier >= 1 && tier <= 3)){
									console.log("Invalid Tier!");
									return;
								}
								tier = tier == 3 ? 5 : tier;
								ptr++;
								continue;
							}
							if (mSplit[ptr] == ""){
								ptr++;
								continue;
							}
							subs = parseInt(mSplit[ptr],10);
							if (!Number.isFinite(subs)){
								console.log("Invalid Number of Subs!");
								return;
							}
							ptr++;
						}
						timeToAdd = tier * ws.subTime * subs;
						break;
					case "!addmoney":
						let dollars = 0;
						if (mSplit.length < 2){
							console.log("Not Enough Parameters!");
							return;
						}
						let dollarString = mSplit[1];
						dollarString = dollarString.replaceAll("$","");
						dollars = parseFloat(dollarString);
						if (!Number.isFinite(dollars)){
							console.log("Invalid Money Amount!");
							return;
						}
						timeToAdd = dollars * ws.dollarTime;
						break;
					case "!addtime":
						let seconds = 0;
						if (mSplit.length < 2){
							console.log("Not Enough Parameters!");
							return;
						}
						seconds = parseInt(mSplit[1],10);
						if (!Number.isFinite(seconds)){
							console.log("Invalid Time Amount!");
							return;
						}
						timeToAdd = seconds;
						break;
				}
				if (timeToAdd == 0)
					return;
				if (Math.abs(timeToAdd) > chatCmdMaxTime){
					console.log(`Time change would be greater than ${chatCmdMaxTime} seconds!`);
					return;
				}
				addToEndTime(ws, timeToAdd);
			}
		}
	});

	const isAnon = (uname: any) => {
		const upUname = uname.toUpperCase();
		return upUname == "ANANONYMOUSGIFTER";
	}

	const calcTier = (ustate: any) => {
		const plan = ustate["msg-param-sub-plan"] || "";
		const tempTier = plan == "Prime" ? 1 : parseInt(plan) / 1000;
		return tempTier == 3 ? 5 : tempTier;
	}

	client.on("submysterygift",(channel, username, numbOfSubs, methods, userstate) => {
		if (ws.ignoreAnon && isAnon(username))
			return;
		console.log(`TMI - ${username} is gifting ${numbOfSubs} subs!`);
		const tier = calcTier(userstate);
		addToEndTime(ws, tier * ws.subTime * numbOfSubs);
	});

	client.on("subgift",(channel, username, streakMonths, recipient, methods, userstate) => {
		if (userstate.hasOwnProperty("msg-param-community-gift-id")) // Mass subgifts are handled in submysterygift
			return;
		if (ws.ignoreAnon && isAnon(username))
			return;
		console.log(`TMI - subgift from ${username} to ${recipient}`)
		const tier = calcTier(userstate);
		addToEndTime(ws, tier * ws.subTime);
	});

	client.on("anongiftpaidupgrade", (_channel, _username, userstate) => {
		console.log(`TMI - anongiftpaidupgrade from ${_username}`)
		const tier = calcTier(userstate);
		addToEndTime(ws, tier * ws.subTime);
	});

	client.on("giftpaidupgrade", (_channel, _username, sender, userstate) => {
		console.log(`TMI - giftpaidupgrade from ${_username}`)
		const tier = calcTier(userstate);
		addToEndTime(ws, tier * ws.subTime);
	});

	client.on("resub",(_channel, _username, _months, _message, userstate, _methods) => {
		console.log(`TMI - ${_username} has resubscribed`)
		const tier = calcTier(userstate);
		addToEndTime(ws, tier * ws.subTime);
	});

	client.on("subscription",(_channel, _username, _method, _message, userstate) => {
		console.log(`TMI - ${_username} has subscribed`)
		const tier = calcTier(userstate);
		addToEndTime(ws, tier * ws.subTime);
	});

	client.on("cheer", (_channel, userstate, _message) => {
		var bits: string = userstate["bits"] || "";
		console.log(`TMI - cheer of ${bits} bits from ${userstate["display-name"]}`)
		addDollarToEndTime(ws, parseInt(bits) / 100);
	});
}

function installStreamlabsMerch(ws: wsType){
	console.log(`Getting Streamlabs Merch...`);
	ws.merchValues = {};
	axios
	.get(`https://streamlabs.com/api/v6/user/${ws.name}`, {
	})
	.then((httpRes) => {
		if (Math.floor(httpRes.status / 100)!=2)
			return;
		axios
		.get(`https://streamlabs.com/api/v6/${httpRes.data.token}/merchandise/products`, {
		})
		.then(httpRes2 => {
			if (Math.floor(httpRes2.status / 100)!=2)
				return;
			let merchProducts = httpRes2.data.products;
			merchProducts.map((x: any)=>{
				ws.merchValues[x.name] = x.variants[0].price / 100;
			})
			console.log("Done getting Streamlabs Merch!");
		})
	})
}

function connectStreamlabs(ws: wsType) {
	if (ws.type !== "settings") return 0;

	if (ws.socket) ws.socket.disconnect();

	console.log(`Connecting to ${ws.name}'s Streamlabs...`);

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
		console.log(`Connected to ${ws.name}'s Streamlabs!`);
		installStreamlabsMerch(ws);
		ws.slStatus = true;
		syncTimer(ws);
	});

	ws.socket.on("disconnect", () => {
		ws.slStatus = false;
	});

	ws.socket.on("event", (e: any) => {
		console.log(`Streamlabs Event: ${JSON.stringify(e)}`);
		switch (e.type){
			case "donation":
				addDollarToEndTime(ws, e.message[0].amount);
				break;
			case "merch":
				if (!ws.merchValues[e.message[0].product]){
					console.log(`WARNING! STREAMLABS PRODUCT "${e.message[0].product}" IS NOT IN MERCHVALUES!!`);
					return;
				}
				addDollarToEndTime(ws, ws.merchValues[e.message[0].product]);
				break;
		}
	});
}

async function syncTimer(ws: wsType) {
	ws.send(
		JSON.stringify({
			success: true,
			endTime: ws.endTime,
			subTime: ws.subTime,
			dollarTime: ws.dollarTime,
			slStatus: ws.slStatus,
			cap: ws.shouldCap,
			anon: ws.ignoreAnon,
			merchValues: ws.merchValues
		})
	);
}

async function login(ws: wsType, accessToken: string) {
	ws.slStatus = false;
	if (client_id == ""){
		ws.userId = 1; // Assume there's just one user if this is the case
		ws.name = accessToken;
		if (!allowedUsers.includes(ws.name)) {
			ws.send(
				JSON.stringify({
					success: false,
					error: "Username is not in allowedUsers array. Not allowed.",
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
					shouldCap: false,
					ignoreAnon: false,
				};
				Object.assign(ws, newUser);
				createUser(newUser);
				ws.initialized = true;
				startTMI(ws);
			} else {
				Object.assign(ws, res.dataValues);
				if (res.dataValues.name != accessToken){
					ws.name = accessToken;
					ws.accessToken = accessToken;
				}
				if (ws.slToken)
					connectStreamlabs(ws);
				else syncTimer(ws);
				startTMI(ws);
			}
		});
		return 0;
	}
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
						error: "User was unable to be authorized by Twitch.",
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
						shouldCap: false,
						ignoreAnon: false,
					};
					Object.assign(ws, newUser);
					createUser(newUser);
					ws.initialized = true;
					startTMI(ws);
				} else {
					Object.assign(ws, res.dataValues);
					if (ws.slToken)
						connectStreamlabs(ws);
					else syncTimer(ws);
					startTMI(ws);
				}
			});
		})
		.catch(function (error) {
			sendError(ws, "Failed to login" + error);
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
				shouldCap: ws.shouldCap,
				ignoreAnon: ws.ignoreAnon,
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
	if (ws.type !== "settings"){
		Users.findByPk(ws.userId).then((res: any) => {
			if (res) {
				if (
					ws.subTime !== res.dataValues.subTime ||
					ws.endTime !== res.dataValues.endTime
				) {
					ws.subTime = res.dataValues.subTime;
					ws.endTime = res.dataValues.endTime;
					capTime(ws);
					syncTimer(ws);
				}
			}
		});
	}
}

async function initialize(ws: wsType, intervals: any) {
	intervals.forceSync = setInterval(() => syncTimer(ws), defaultValues.forceSync * 1000);

	switch (ws.type) {
		case "widget":
			syncWidget(ws);
			intervals.syncWidgetInterval = setInterval(() => syncWidget(ws), 1000);
			break;
		case "settings":
			ws.shouldLogin = true;
			intervals.tryToCap = setInterval(() => capTime(ws), 1000);
			intervals.forceSyncDb = setInterval(() => pushToDb(ws), 1000);
			break;
	}
	syncTimer(ws);
}

async function closeStuff(ws: wsType, intervals: any) {
	clearInterval(intervals.forceSync);

	switch (ws.type) {
		case "widget":
			clearInterval(intervals.syncWidgetInterval);
			break;
		case "settings":
			clearInterval(intervals.forceSyncDb);
			break;
	}
}

function main() {
	setInterval(() => (now = Math.trunc(Date.now() / 1000)), 1000);

	wss.on("connection", (ws: wsType, req: any) => {
		var intervals: any = {};
		ws.shouldCap = false;
		ws.isAlive = true;
		ws.ignoreAnon = false;
		ws.merchValues = {};
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
				console.log(`Backend received ${urlParams.token} as token!`);
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
					if (data.slToken.length < 1000) ws.slToken = data.slToken;
					connectStreamlabs(ws);
					break;
				case "setSetting":
					updateSetting(ws, data);
					break;
				case "setEndTime":
					ws.endTime = Math.floor(parseInt(data.value) || 0);
					capTime(ws);
					syncTimer(ws);
					break;
				case "setCap":
					ws.shouldCap = Boolean(data.value) || false;
					syncTimer(ws);
					break;
				case "setAnon":
					ws.ignoreAnon = Boolean(data.value) || false;
					syncTimer(ws);
					break;
			}
		};
	});

	const timeout = setInterval(function ping() {
		wss.clients.forEach(function each(ws: any) {
			console.log(`Pinging ${ws.name} on page ${ws.type}`);
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
