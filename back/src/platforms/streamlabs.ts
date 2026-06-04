import axios from "axios";
import io from "socket.io-client";
import { TimerUserSession, TimerEvent } from "../types";
import { MERCH_UPDATE_TIME } from "../config";
import { emitSync } from "../bus";
import { whSend } from "../notify";

// temporary diagnostic: client's youtube membership levels are enjoyer / full membership / quickster.
// streamlabs doesn't document which field carries the level, so scan the raw payload for these known strings
// to pinpoint the exact key. remove once we know the field and wire per-tier rates.
const KNOWN_YT_LEVELS = ["enjoyer", "full membership", "quickster"];
function probeLevelField(obj: any, path: string){
    if (obj && typeof obj === "object"){
        for (const k of Object.keys(obj))
            probeLevelField(obj[k], path ? `${path}.${k}` : k);
    } else if (typeof obj === "string"){
        const low = obj.toLowerCase();
        if (KNOWN_YT_LEVELS.some((l) => low.includes(l)))
            console.log(`YT-LEVEL-FIELD-FOUND at "${path}" = ${JSON.stringify(obj)}`);
    }
}

// youtube super chat / super sticker. streamlabs relays the amount in micros (x1,000,000), e.g. "2000000" = $2.00
function emitSuperChat(e: any, unit: "superchat" | "supersticker", emit: (ev: TimerEvent) => void){
    const m = e.message[0];
    const usd = (Number(m.amount) || 0) / 1000000;
    const who = m.name || "someone";
    const shown = m.displayString || `$${usd}`;
    emit({ platform: "youtube", kind: "money", usd, unit, label: `Super ${unit === "supersticker" ? "Sticker" : "Chat"} ${shown} from ${who}` });
}

function slInstallMerch(session: TimerUserSession){
    const newMerchValues = {};
    console.log(`Getting New Streamlabs Merch For ${session.name}...`);
    axios
    .get(`https://streamlabs.com/api/v6/user/${session.name}`, {
    })
    .then((httpRes) => {
        if (Math.trunc(httpRes.status / 100)!=2)
            return;
        axios
        .get(`https://streamlabs.com/api/v6/${httpRes.data.token}/merchandise/products`, {
        })
        .then(httpRes2 => {
            if (Math.trunc(httpRes2.status / 100)!=2)
                return;
            let merchProducts = httpRes2.data.products;
            merchProducts.map((x: any)=>{
                newMerchValues[x.name] = x.variants[0].price / 100;
            });
            session.merchValues = Object.assign({}, newMerchValues);
            console.log(`Done Getting ${session.name}'s Streamlabs Merch!`);
        }).catch(()=>{
            console.log(`Could not get new streamlabs merch at this time! Try again later!`);
        });
    }).catch(()=>{
        console.log(`Could not get new streamlabs merch at this time! Try again later!`);
    });
}

// translates streamlabs donation/merch events into normalized TimerEvents
export function connectStreamlabs(session: TimerUserSession, emit: (e: TimerEvent) => void){
    let merchInterval: NodeJS.Timeout | number = 0;
    const socket = io(`https://sockets.streamlabs.com?token=${session.connections.streamlabs.token}`, {
        transports: ["websocket"],
    });

    socket.on("connect", () => {
        console.log(`Connected to ${session.name}'s Streamlabs!`);
        session.slStatus = true;
        emitSync(session.userId);
        slInstallMerch(session);
        if (merchInterval == 0)
            merchInterval = setInterval(()=>slInstallMerch(session), MERCH_UPDATE_TIME);
    });

    socket.on("disconnect", () => {
        console.log(`Disconnected from ${session.name}'s Streamlabs!`);
        session.slStatus = false;
        emitSync(session.userId);
        if (merchInterval != 0){
            clearInterval(merchInterval);
            merchInterval = 0;
        }
    });

    socket.on("event", (e: any) => {
        console.log(`(${session.name}) Streamlabs Event: ${JSON.stringify(e)}`);
        switch (e.type){
            case "donation":
                console.log(`(${session.name}) STREAMLABS - Adding $${e.message[0].amount} to timer!`);
                emit({ platform: "streamlabs", kind: "money", usd: e.message[0].amount, unit: "donation", label: `Donation $${e.message[0].amount} from ${e.message[0].from}` });
                break;
            case "merch": {
                console.log(`Received merch purchase! Product name: "${e.message[0].product}"`);
                const merchHookData = `From: \`${e.message[0].from}\`\nProduct: \`${e.message[0].product}\`\nMessage: \`${e.message[0].message}\``;
                let merchValue = session.merchValues[e.message[0].product];
                if (!merchValue){
                    console.log(`WARNING! STREAMLABS PRODUCT "${e.message[0].product}" IS NOT IN MERCHVALUES!! Trying a fuzzier search...!`);
                    const mvEntries = Object.entries(session.merchValues);
                    const lowercaseProduct = e.message[0].product.toLowerCase();
                    for (var i = 0; i < mvEntries.length; i++){
                        if (mvEntries[i][0].toLowerCase().includes(lowercaseProduct)){
                            console.log(`Found "${mvEntries[i][0]}" as a close enough match!`);
                            merchValue = mvEntries[i][1];
                            break;
                        }
                    }
                }
                if (!merchValue){
                    console.log(`Definitely couldn't find a valid matching product!!! Tell Aaron! :^(`);
                    whSend(`**MERCH FAILURE!**\n${merchHookData}`);
                    return;
                }
                console.log(`(${session.name}) - STREAMLABS - Adding $${merchValue} to timer!`);
                whSend(`**MERCH SUCCESS!**\n${merchHookData}`);
                emit({ platform: "streamlabs", kind: "money", usd: merchValue as number, unit: "merch", label: `Merch: ${e.message[0].product} ($${merchValue})` });
                break;
            }
            // youtube super chats & memberships are relayed on this same socket (see "via streamlabs" in NOTES)
            case "superchat":
                emitSuperChat(e, "superchat", emit);
                break;
            case "supersticker":
                emitSuperChat(e, "supersticker", emit);
                break;
            case "subscription": {
                if (e.for !== "youtube_account") // twitch subs come through tmi; don't double-count them here
                    break;
                // tagged so the real payload is easy to grep out of a live stream's logs (checking for a tier/level field)
                console.log(`YT-MEMBERSHIP-PAYLOAD ${JSON.stringify(e)}`);
                probeLevelField(e, ""); // logs YT-LEVEL-FIELD-FOUND with the exact path holding the level name
                const m = e.message[0];
                // youtube membership tiers are arbitrary creator-named levels; surface whatever level field SL sends
                // (undocumented) in the log so we can confirm if per-tier rates are even possible. flat rate for now.
                const level = m.membershipLevelName || m.membership_level_name || m.levelName || m.level || m.tier;
                const lvl = level ? ` [${level}]` : "";
                const gifter = m.gifter || m.gifterName || m.gifter_username;
                if (m.gifted || m.isGift || gifter) {
                    let count = Number(m.amount) || Number(m.gift_count) || Number(m.quantity) || 1;
                    count = Math.min(Math.max(Math.trunc(count), 1), 100); // guard against a misread field inflating time
                    emit({ platform: "youtube", kind: "member", unit: "membership_gift", count, label: `YouTube: ${count}x gift membership${lvl} from ${gifter || m.name}` });
                } else {
                    emit({ platform: "youtube", kind: "member", unit: "membership", count: 1, label: `YouTube membership${lvl} from ${m.name}` });
                }
                break;
            }
        }
    });

    return socket;
}
