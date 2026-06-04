import { Op } from "sequelize";
import WebSocket from "ws";
import { TimerUserSession, TimerWebSocket } from "./types";
import { LOG_PAGE } from "./config";
import { logsModel } from "./db";
import { emitLog } from "./bus";

export function logTimerEvent(session: TimerUserSession, action: string, oldEndTime: number, newEndTime: number){
    if (session.userId == 0)
        return;
    const nowMs = Date.now();
    const oldMs = Math.max(Math.round(oldEndTime) - nowMs, 0);
    const newMs = Math.max(Math.round(newEndTime) - nowMs, 0);
    const entry = { t: nowMs, action, oldMs, newMs, addedMs: newMs - oldMs };
    logsModel.create({ userId: session.userId, action, oldMs, newMs, addedMs: entry.addedMs }).catch((err: any)=>{
        console.log("Failed to write log:", err);
    });
    emitLog(session.userId, entry);
}

export function sendLogPage(ws: TimerWebSocket, before: any){
    if (!ws.isReady)
        return;
    if (ws.readyState !== WebSocket.OPEN)
        return;
    const where: any = { userId: ws.userId };
    if (Number.isFinite(before))
        where.id = { [Op.lt]: before };
    logsModel.findAll({ where, order: [["id", "DESC"]], limit: LOG_PAGE }).then((rows: any[]) => {
        if (ws.readyState !== WebSocket.OPEN)
            return;
        const page = rows.reverse().map((r: any) => ({
            id: r.dataValues.id,
            t: new Date(r.dataValues.createdAt).getTime(),
            action: r.dataValues.action,
            oldMs: Number(r.dataValues.oldMs),
            newMs: Number(r.dataValues.newMs),
            addedMs: Number(r.dataValues.addedMs),
        }));
        ws.send(JSON.stringify({ logPage: page, hasMore: rows.length === LOG_PAGE, before: Number.isFinite(before) ? before : null }));
    }).catch((err: any) => {
        console.log("Failed to load log page:", err);
    });
}
