import tmi from "tmi.js";
import { TimerUserSession, TimerEvent } from "../types";
import { emitSync } from "../bus";
import { parseCommand } from "../commands";

// chat keeps its !addsub/!addmoney/!addtime sugar, but everything resolves to one canonical command string ->
// parseCommand, so chat and the terminal share the exact same logic. unknown verbs pass through as-is, so a mod can
// also type the canonical grammar directly (e.g. "!youtube superchat 10").
function chatToCommand(body: string): string | null {
    const parts = body.trim().split(/\s+/);
    const verb = parts[0];
    if (verb === "" || verb === "nop")
        return null;
    if (verb === "addsub"){
        let tier = 1, count = 1;
        for (let i = 1; i < parts.length; i++){
            if (/^t\d+$/.test(parts[i]))
                tier = parseInt(parts[i].slice(1), 10);
            else if (parts[i] !== "" && Number.isFinite(Number(parts[i])))
                count = Number(parts[i]);
        }
        return `twitch sub_t${tier} ${count}`;
    }
    if (verb === "addmoney") // legacy: adds a donation's worth of time
        return `streamlabs donation ${(parts[1] || "").replaceAll("$", "")}`;
    if (verb === "addtime")
        return `time ${parts[1] || ""}`;
    return body.trim();
}

// translates twitch chat/sub/cheer events into normalized TimerEvents; knows nothing about rates/timer/db
export function connectTwitch(session: TimerUserSession, emit: (e: TimerEvent) => void){
    const channel = session.connections.twitch.channel;

    const client = new tmi.Client({
        connection: {
            reconnect: true,
            reconnectInterval: 5000,
        },
        channels: [channel]
    });

    client.connect().catch((err)=>{
        console.log(`TMI - Unable to connect: ${session.name} and ${session.accessToken}`);
    });

    function l(event) {
        return function(){
            console.log(event, arguments);
        }
    }

    client.on("connecting", l(`Connecting to ${channel}'s Twitch Chat...`));
    client.on("connected", () => {
        console.log(`Connected to ${channel}'s Twitch Chat!`);
        session.twitchStatus = true;
        emitSync(session.userId);
    });
    client.on("disconnected", () => {
        console.log(`Disconnected from ${channel}'s Twitch Chat!`);
        session.twitchStatus = false;
        emitSync(session.userId);
    });

    const isAnon = (uname: any) => {
        const upUname = uname.toUpperCase();
        return upUname == "ANANONYMOUSGIFTER";
    }

    const calcTier = (ustate: any) => {
        const plan = ustate["msg-param-sub-plan"] || "1000";
        return plan == "Prime" ? 1 : parseInt(plan,10) / 1000;
    }

    client.on("message", (ch, tags, message, self) => {
        const filterMessage = message.toLowerCase().replaceAll(/[^ -~]/g,"").trim();
        console.log(`(${session.name}) TWITCH MESSAGE - ${tags.username}: ${filterMessage}`);
        if (!tags.username)
            return;
        if (!(tags.mod || tags.username.toLowerCase() == channel.toLowerCase()))
            return;
        if (filterMessage.charAt(0) !== "!") // only mod/broadcaster ! commands
            return;
        const command = chatToCommand(filterMessage.slice(1));
        if (!command)
            return;
        const parsed = parseCommand(command);
        if (parsed.error || !parsed.event){
            console.log(`(${session.name}) chat command "${filterMessage}" rejected: ${parsed.error || "no event"}`);
            return;
        }
        parsed.event.label = `Chat: ${filterMessage} (${tags.username})`; // keep who ran it in the audit log
        emit(parsed.event);
    });

    client.on("submysterygift",(ch, username, numbOfSubs, methods, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${session.name}) TMI - ${username} is gifting ${numbOfSubs} tier ${tier} subs!`);
        emit({ platform: "twitch", kind: "sub", tier, count: numbOfSubs, anonymous: isAnon(username), label: `${numbOfSubs}x Tier ${tier} gift sub from ${username}` });
    });

    client.on("subgift",(ch, username, streakMonths, recipient, methods, userstate) => {
        if (userstate["msg-param-community-gift-id"]) // mass subgifts are handled in submysterygift
            return;
        const tier = calcTier(userstate);
        console.log(`(${session.name}) TMI - subgift from ${username} to ${recipient} of tier ${tier}!`);
        emit({ platform: "twitch", kind: "sub", tier, count: 1, anonymous: isAnon(username), label: `Tier ${tier} gift sub from ${username} -> ${recipient}` });
    });

    client.on("anongiftpaidupgrade", (_ch, _username, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${session.name}) TMI - anongiftpaidupgrade from ${_username} to tier ${tier}!`);
        emit({ platform: "twitch", kind: "sub", tier, count: 1, label: `Gift sub upgrade (anon) Tier ${tier}` });
    });

    client.on("giftpaidupgrade", (_ch, _username, sender, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${session.name}) TMI - giftpaidupgrade from ${_username} to tier ${tier}!`);
        emit({ platform: "twitch", kind: "sub", tier, count: 1, label: `Gift sub upgrade from ${_username} Tier ${tier}` });
    });

    client.on("resub",(_ch, _username, _months, _message, userstate, _methods) => {
        const tier = calcTier(userstate);
        console.log(`(${session.name}) TMI - ${_username} has resubscribed with tier ${tier}!`);
        emit({ platform: "twitch", kind: "sub", tier, count: 1, label: `Tier ${tier} resub (${_username})` });
    });

    client.on("subscription",(_ch, _username, _method, _message, userstate) => {
        const tier = calcTier(userstate);
        console.log(`(${session.name}) TMI - ${_username} has subscribed with tier ${tier}!`);
        emit({ platform: "twitch", kind: "sub", tier, count: 1, label: `Tier ${tier} sub (${_username})` });
    });

    client.on("cheer", (_ch, userstate, _message) => {
        var bits: string = userstate["bits"] || "0";
        console.log(`(${session.name}) TMI - cheer of ${bits} bits from ${userstate["display-name"]}`);
        emit({ platform: "twitch", kind: "bits", bits: parseInt(bits,10), label: `Cheer ${bits} bits (${userstate["display-name"]})` });
    });

    return client;
}
