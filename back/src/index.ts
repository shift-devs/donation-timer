import http from "http";
import https from "https";
import axios from "axios";
import { CLIENT_ID, DB_UPDATE_TIME, LOG_RETENTION_MS, LOG_PRUNE_TIME, EVENT_TICK_TIME } from "./config";
import { connectDb, dbUpdate, dbPruneLogs, usersModel } from "./db";
import { emitTerminal } from "./bus";
import { whSend } from "./notify";
import { sessions, loginUser } from "./session";
import { startApi } from "./api";
import { tickTimerEvents } from "./scheduler";

// reuse TCP connections for every outbound API call (all modules share the default axios instance).
// Node 18's default agent opens a fresh TLS connection per request; at the 5s fourthwall polling
// cadence that's ~17k connections/day of NAT churn — enough to wedge VirtualBox's NAT engine.
axios.defaults.httpAgent = new http.Agent({ keepAlive: true });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });

async function main(){
    // last-resort nets: anything that slipped every local containment is logged (with stack) and echoed to
    // each logged-in user's dashboard terminal — the process itself never dies to a recoverable error.
    let reporting = false; // re-entrancy guard: a throw inside the reporter must not recurse into itself
    const reportGlobal = (kind: string, err: any) => {
        console.log(`${new Date().toISOString()} ${kind}:`, (err && err.stack) || err);
        if (reporting)
            return;
        reporting = true;
        try {
            for (const s of sessions)
                emitTerminal(s.userId, `SERVER ${kind} (recovered): ${(err && err.message) || err}`);
        } catch {}
        reporting = false;
    };
    process.on("unhandledRejection", (reason) => reportGlobal("unhandled rejection", reason));
    process.on("uncaughtException", (err) => reportGlobal("uncaught exception", err));
    console.log(`Running in ${CLIENT_ID==""?"Una":"A"}uthorized Mode!`);
    whSend("**TIMER STARTED**");

    try {
        await connectDb();
        console.log("Connection has been established successfully to the database!");
    } catch (error) {
        console.error("Unable to connect to the database:", error);
        return;
    }

    const users = await usersModel.findAll();

    // per-user containment: one corrupt row (bad jsonb, connector blowing up) must not block the other logins
    for (const user of users){
        try {
            if ((CLIENT_ID == "" && user.dataValues.userId != 1) || (CLIENT_ID != "" && user.dataValues.userId == 1)){
                console.log(`Removing bad user with userId ${user.dataValues.userId} from the DB!`)
                await user.destroy();
                continue;
            }
            loginUser(user.dataValues);
        } catch (err) {
            console.log(`Failed to log in userId ${user.dataValues && user.dataValues.userId} from the DB:`, err);
        }
    }

    startApi();

    // self-scheduling so a slow/stalled DB can never stack overlapping write batches (no setInterval pileup)
    const dbLoop = async () => {
        try {
            await dbUpdate(sessions);
        } catch (err) {
            console.log("dbUpdate batch failed:", err);
        }
        setTimeout(dbLoop, DB_UPDATE_TIME);
    };
    dbLoop();

    // self-scheduling tick that fires due timer events (separate from the db loop so a slow write can't delay playback)
    const eventLoop = () => {
        try {
            tickTimerEvents();
        } catch (err) {
            console.log("timer-event tick failed:", err);
        }
        setTimeout(eventLoop, EVENT_TICK_TIME);
    };
    eventLoop();

    // periodically prune old audit-log rows so the Logs table stays bounded over a weeks-long run
    const pruneLoop = async () => {
        try {
            await dbPruneLogs(LOG_RETENTION_MS);
        } catch (err) {
            console.log("Log prune failed:", err);
        }
        setTimeout(pruneLoop, LOG_PRUNE_TIME);
    };
    pruneLoop();
}

main();
