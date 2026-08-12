import { Sequelize, DataTypes, ModelStatic, Op } from "sequelize";
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
    capSeconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    stopAtZero: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
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
    },
    timerEvents: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    },
    // named /events browser sources an event can render to (see migration add-event-layers)
    eventLayers: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    },
    // mod-editable /text browser sources: appearance plus the words currently on stream (see add-text-boxes)
    textBoxes: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    },
    fwProductBonuses: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    fwProductSounds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    fwProductAlerts: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    fwProductBanners: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    fwProductShadows: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    fwProductNames: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    widgetSettings: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    fwActivity: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    },
    // all-time per-service sub tallies backing the /subcount browser sources (see migration add-sub-counts)
    subCountTwitch: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    subCountYoutube: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    subCountKick: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
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
        capSeconds: lvObj.capSeconds,
        stopAtZero: lvObj.stopAtZero,
        ignoreAnon: lvObj.ignoreAnon,
        rates: lvObj.rates,
        connections: lvObj.connections,
        timerEvents: lvObj.timerEvents,
        eventLayers: lvObj.eventLayers,
        textBoxes: lvObj.textBoxes,
        fwProductBonuses: lvObj.fwProductBonuses,
        fwProductSounds: lvObj.fwProductSounds,
        fwProductAlerts: lvObj.fwProductAlerts,
        fwProductBanners: lvObj.fwProductBanners,
        fwProductShadows: lvObj.fwProductShadows,
        fwProductNames: lvObj.fwProductNames,
        widgetSettings: lvObj.widgetSettings,
        fwActivity: lvObj.fwActivity,
        subCountTwitch: lvObj.subCountTwitch,
        subCountYoutube: lvObj.subCountYoutube,
        subCountKick: lvObj.subCountKick
    });
}

// deletes audit-log rows older than the retention window so the Logs table can't grow without bound over weeks
export async function dbPruneLogs(retentionMs: number){
    const cutoff = new Date(Date.now() - retentionMs);
    const deleted = await logsModel.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
    if (deleted)
        console.log(`Pruned ${deleted} log rows older than ${Math.round(retentionMs / 86400000)}d.`);
}

// awaits all writes so the caller can serialize ticks; a single failure can't reject the whole batch (allSettled)
export async function dbUpdate(sessions: TimerUserSession[]){
    const results = await Promise.allSettled(sessions.map((curSession) =>
        usersModel.update(
            {
                name: curSession.name,
                accessToken: curSession.accessToken,
                subTime: curSession.subTime,
                dollarTime: curSession.dollarTime,
                slToken: curSession.slToken,
                endTime: Math.round(curSession.endTime),
                capSeconds: curSession.capSeconds,
                stopAtZero: curSession.stopAtZero,
                ignoreAnon: curSession.ignoreAnon,
                rates: curSession.rates,
                connections: curSession.connections,
                timerEvents: curSession.timerEvents,
                eventLayers: curSession.eventLayers,
                textBoxes: curSession.textBoxes,
                fwProductBonuses: curSession.fwProductBonuses,
                fwProductSounds: curSession.fwProductSounds,
                fwProductAlerts: curSession.fwProductAlerts,
                fwProductBanners: curSession.fwProductBanners,
                fwProductShadows: curSession.fwProductShadows,
                fwProductNames: curSession.fwProductNames,
                widgetSettings: curSession.widgetSettings,
                fwActivity: curSession.fwActivity,
                subCountTwitch: curSession.subCountTwitch,
                subCountYoutube: curSession.subCountYoutube,
                subCountKick: curSession.subCountKick,
            },
            {
                where: {
                    userId: curSession.userId,
                },
            }
        )
    ));
    for (const r of results)
        if (r.status === "rejected")
            console.log("Failed to update user in DB:", r.reason);
}
