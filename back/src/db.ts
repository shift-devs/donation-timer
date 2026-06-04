import { Sequelize, DataTypes, ModelStatic } from "sequelize";
import { TimerUserSession } from "./types";

export const USER_TABLE = {
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    accessToken: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    subTime: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 70
    },
    dollarTime: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 14
    },
    slToken: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    endTime: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0
    },
    shouldCap: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    ignoreAnon: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    rates: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    connections: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    }
}

export const LOG_TABLE = {
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    action: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    oldMs: {
        type: DataTypes.BIGINT,
        allowNull: false,
    },
    newMs: {
        type: DataTypes.BIGINT,
        allowNull: false,
    },
    addedMs: {
        type: DataTypes.BIGINT,
        allowNull: false,
    }
}

let sequelize: Sequelize;
export let usersModel: ModelStatic<any>;
export let logsModel: ModelStatic<any>;

export async function connectDb(){
    sequelize = new Sequelize(
        process.env.DB_SCHEMA || "postgres",
        process.env.DB_USER || "postgres",
        process.env.DB_PASSWORD || "",
        {
            host: process.env.DB_HOST || "postgres",
            port: parseInt(process.env.DB_PORT || "5432", 10),
            dialect: "postgres",
            dialectOptions: {
                ssl: process.env.DB_SSL == "true",
                rejectUnauthorized: false,
            },
            logging: false,
        }
    );
    usersModel = sequelize.define("User", USER_TABLE);
    logsModel = sequelize.define("Log", LOG_TABLE, { updatedAt: false });
    await sequelize.authenticate();
    await usersModel.sync();
}

export async function dbCreate(inObj: Object){
    const lvObj = Object.assign({}, inObj) as TimerUserSession;
    await usersModel.create({
        userId: lvObj.userId,
        name: lvObj.name,
        accessToken: lvObj.accessToken,
        subTime: lvObj.subTime,
        dollarTime: lvObj.dollarTime,
        slToken: lvObj.slToken,
        endTime: lvObj.endTime,
        shouldCap: lvObj.shouldCap,
        ignoreAnon: lvObj.ignoreAnon,
        rates: lvObj.rates,
        connections: lvObj.connections
    });
}

export function dbUpdate(sessions: TimerUserSession[]){
    for (let i = 0; i < sessions.length; i++){
        const curSession = sessions[i];
        usersModel.update(
            {
                name: curSession.name,
                accessToken: curSession.accessToken,
                subTime: curSession.subTime,
                dollarTime: curSession.dollarTime,
                slToken: curSession.slToken,
                endTime: Math.round(curSession.endTime),
                shouldCap: curSession.shouldCap,
                ignoreAnon: curSession.ignoreAnon,
                rates: curSession.rates,
                connections: curSession.connections,
            },
            {
                where: {
                    userId: curSession.userId,
                },
            }
        ).catch((err: any)=>{
            console.log("Failed to update user in DB:", err);
        });
    }
}
