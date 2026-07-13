import axios from "axios";
import io from "socket.io-client";
import { TimerUserSession, TimerEvent } from "../types";
import { MERCH_UPDATE_TIME, WS_FORCE_SYNC_TIME } from "../config";
import { emitSync, reportError } from "../bus";
import { whSend } from "../notify";
// youtube + kick events ride this same socket; each platform owns its own translation in its file
import { handleYoutubeStreamlabsEvent } from "./youtube";
import { handleKickStreamlabsEvent } from "./kick";

// parse a money amount that may arrive as a number or a formatted string ("5.00", "$5") -> finite number
function parseMoney(v: any): number {
    return Number(typeof v === "string" ? v.replace(/[^0-9.-]/g, "") : v) || 0;
}

function slInstallMerch(session: TimerUserSession){
    const newMerchValues = {};
    // the merch catalog belongs to the streamer we're watching (their twitch handle), not the operator account that
    // logged in — session.name is just the login. keying on the channel pulls the right products to match purchases.
    const watching = session.connections.twitch.channel || session.name;
    console.log(`Getting New Streamlabs Merch For ${watching}...`);
    axios
    .get(`https://streamlabs.com/api/v6/user/${watching}`, {
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
            console.log(`Done Getting ${watching}'s Streamlabs Merch!`);
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
    // label logs by the streamer we're watching (their twitch channel), not the operator account that logged in
    const watching = session.connections.twitch.channel || session.name;
    const socket = io(`https://sockets.streamlabs.com?token=${session.connections.streamlabs.token}`, {
        transports: ["websocket"],
    });

    socket.on("connect", () => {
        try {
            console.log(`Connected to ${watching}'s Streamlabs!`);
            session.slStatus = true;
            session.slError = "";
            emitSync(session.userId);
            slInstallMerch(session);
            if (merchInterval == 0)
                merchInterval = setInterval(()=>slInstallMerch(session), MERCH_UPDATE_TIME);
        } catch (err) {
            console.log(`(${watching}) Streamlabs connect handler error:`, err);
        }
    });

    socket.on("disconnect", () => {
        console.log(`Disconnected from ${watching}'s Streamlabs!`);
        session.slStatus = false;
        if (!session.slError) // don't clobber a more specific token-rejected reason
            session.slError = "Disconnected from Streamlabs — reconnecting…";
        emitSync(session.userId);
        if (merchInterval != 0){
            clearInterval(merchInterval);
            merchInterval = 0;
        }
    });

    // a websocket that opens isn't proof the token is good: streamlabs refuses a bad token with connect_error.
    // surface that as the badge reason instead of letting the connection sit silently grey/never-green.
    socket.on("connect_error", (err: any) => {
        session.slStatus = false;
        session.slError = `Couldn't connect to Streamlabs (${(err && err.message) || "check the socket token"}).`;
        emitSync(session.userId);
    });
    socket.on("error", (err: any) => {
        session.slStatus = false;
        session.slError = `Streamlabs socket error (${(err && err.message) || err || "unknown"}).`;
        emitSync(session.userId);
    });

    // watchdog: socket.io can silently diverge from reality (missed disconnect, half-open transport). reconcile the
    // badge against the library's own connection flag every sync tick so green always means "the socket is live now".
    const live = setInterval(() => {
        const connected = !!socket.connected;
        if (session.slStatus !== connected){
            session.slStatus = connected;
            if (!connected && !session.slError)
                session.slError = "Streamlabs socket went quiet — reconnecting…";
            if (connected)
                session.slError = "";
            emitSync(session.userId);
        }
    }, WS_FORCE_SYNC_TIME);

    socket.on("event", (e: any) => {
      try {
        console.log(`(${watching}) Streamlabs Event: ${JSON.stringify(e)}`);
        // streamlabs payloads are message[], but keep-alives / new shapes can omit it — guard before any access
        const m = Array.isArray(e.message) ? e.message[0] : e.message;
        if (!m)
            return;
        switch (e.type){
            case "donation": {
                const usd = parseMoney(m.amount);
                console.log(`(${watching}) STREAMLABS - Adding $${usd} to timer!`);
                emit({ platform: "streamlabs", kind: "money", usd, unit: "donation", label: `Donation $${usd} from ${m.from}` });
                break;
            }
            case "merch": {
                console.log(`Received merch purchase! Product name: "${m.product}"`);
                const merchHookData = `From: \`${m.from}\`\nProduct: \`${m.product}\`\nMessage: \`${m.message}\``;
                let merchValue = session.merchValues[m.product];
                if (!merchValue){
                    console.log(`WARNING! STREAMLABS PRODUCT "${m.product}" IS NOT IN MERCHVALUES!! Trying a fuzzier search...!`);
                    const mvEntries = Object.entries(session.merchValues);
                    const lowercaseProduct = m.product.toLowerCase();
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
                console.log(`(${watching}) - STREAMLABS - Adding $${merchValue} to timer!`);
                whSend(`**MERCH SUCCESS!**\n${merchHookData}`);
                emit({ platform: "streamlabs", kind: "money", usd: merchValue as number, unit: "merch", label: `Merch: ${m.product} ($${merchValue})` });
                break;
            }
            // youtube + kick ride this socket but own their translation in their own adapter files; let them claim it
            default:
                if (handleYoutubeStreamlabsEvent(session, e, m, emit))
                    break;
                handleKickStreamlabsEvent(session, e, m, emit);
                break;
        }
      } catch (err) {
        // donations/merch plus the relayed youtube/kick subs all land here — surface the failure on the terminal
        reportError(session.userId, `streamlabs event (${watching})`, err);
      }
    });

    // callers only ever call .disconnect(); wrap so we also stop the watchdog (and merch loop) on teardown
    return {
        disconnect(){
            clearInterval(live);
            if (merchInterval != 0){
                clearInterval(merchInterval);
                merchInterval = 0;
            }
            socket.disconnect();
            session.slStatus = false;
        }
    };
}
