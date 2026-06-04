import axios from "axios";
import io from "socket.io-client";
import { TimerUserSession, TimerEvent } from "../types";
import { MERCH_UPDATE_TIME } from "../config";
import { emitSync } from "../bus";
import { whSend } from "../notify";

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
        }
    });

    return socket;
}
