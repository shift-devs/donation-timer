import { CLIENT_ID, DB_UPDATE_TIME, LOG_RETENTION_MS, LOG_PRUNE_TIME, EVENT_TICK_TIME } from "./config";
import { connectDb, dbUpdate, dbPruneLogs, usersModel } from "./db";
import { whSend } from "./notify";
import { sessions, loginUser } from "./session";
import { startApi } from "./api";
import { tickTimerEvents } from "./scheduler";

async function main(){
    process.on("unhandledRejection", (reason) => {
        console.log("Unhandled rejection:", reason);
    });
    process.on("uncaughtException", (err) => {
        console.log("Uncaught exception:", err);
    });
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

    users.forEach(async (user: any) => {
        if ((CLIENT_ID == "" && user.dataValues.userId != 1) || (CLIENT_ID != "" && user.dataValues.userId == 1)){
            console.log(`Removing bad user with userId ${user.dataValues.userId} from the DB!`)
            await user.destroy();
            return;
        }
        loginUser(user.dataValues);
    });

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
