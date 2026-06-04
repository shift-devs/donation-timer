import { CLIENT_ID, DB_UPDATE_TIME } from "./config";
import { connectDb, dbUpdate, usersModel } from "./db";
import { whSend } from "./notify";
import { sessions, loginUser } from "./session";
import { startApi } from "./api";

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

    setInterval(() => dbUpdate(sessions), DB_UPDATE_TIME);
}

main();
