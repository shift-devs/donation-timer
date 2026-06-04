import tmi from "tmi.js";
import { TimerUserSession, TimerEvent } from "../types";
import { emitSync } from "../bus";

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
        let filterMessage = message.toLowerCase().replaceAll(/[^ -~]/g,"").trim();
        var mSplit = filterMessage.split(" ");
        console.log(`(${session.name}) TWITCH MESSAGE - ${tags.username}: ${filterMessage}`);
        if (!tags.username)
            return;
        if (!(tags.mod || tags.username.toLowerCase() == channel.toLowerCase()))
            return;
        const label = `Chat: ${filterMessage} (${tags.username})`;
        switch (mSplit[0]) {
            case "!nop":
                console.log("No operation!");
                break;
            case "!addsub": {
                var subs = 1, tier = 1, ptr = 1;
                while (ptr < mSplit.length){
                    if (mSplit[ptr].charAt(0) == "t"){
                        tier = parseInt(mSplit[ptr].slice(1),10);
                        if (!(tier >= 1 && tier <= 3)){
                            console.log("Invalid Tier!");
                            return;
                        }
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
                emit({ platform: "twitch", kind: "sub", tier, count: subs, manual: true, label });
                break;
            }
            case "!addmoney": {
                if (mSplit.length < 2){
                    console.log("Not Enough Parameters!");
                    return;
                }
                let dollarString = mSplit[1].replaceAll("$","");
                const dollars = parseFloat(dollarString);
                if (!Number.isFinite(dollars)){
                    console.log("Invalid Money Amount!");
                    return;
                }
                emit({ platform: "twitch", kind: "money", usd: dollars, unit: "donation", manual: true, label });
                break;
            }
            case "!addtime": {
                if (mSplit.length < 2){
                    console.log("Not Enough Parameters!");
                    return;
                }
                const seconds = parseInt(mSplit[1],10);
                if (!Number.isFinite(seconds)){
                    console.log("Invalid Time Amount!");
                    return;
                }
                emit({ platform: "twitch", kind: "time", seconds, manual: true, label });
                break;
            }
        }
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
