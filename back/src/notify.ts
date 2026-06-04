import axios from "axios";
import { WH_PATH } from "./config";

export function whSend(msg: string){
    const aSnowflake = "305454678316154900";
    if (WH_PATH == ""){
        console.log("WH_PATH is not valid! Not sending hook!");
        return;
    }
    axios.post(`https://discord.com/api/webhooks/${WH_PATH}`,
    JSON.stringify(
        {
            "content": `<@${aSnowflake}> ${msg}`,
            "allowed_mentions": {
                "users": [aSnowflake]
            }
        }
    ),{headers: {
        "Content-Type": "application/json"
    }}).then(()=>{
        console.log("Sent a webhook!");
    }).catch((err)=>{
        console.log("Failed to send a webhook!");
        console.log(err);
    });
}
