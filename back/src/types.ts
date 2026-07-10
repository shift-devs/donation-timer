import { Sequelize, ModelStatic } from "sequelize";
import tmi from "tmi.js";
import WebSocket from "ws";

export interface TimerState {
    sequelize: Sequelize
    usersModel: ModelStatic<any>
    logsModel: ModelStatic<any>
    userSessions: Array<TimerUserSession>
}

export interface TimerUserSession {
    userId: number
    name: string
    accessToken: string
    subTime: number
    dollarTime: number
    slToken?: string
    endTime: number
    shouldCap: boolean
    ignoreAnon: boolean
    slStatus: boolean
    slError?: string
    twitchStatus: boolean
    twitchError?: string
    fourthwallStatus: boolean
    fourthwallError?: string
    fourthwallLastOkAt?: number
    // ms timestamp of the last genuine (non-command) event we received per platform — proof data is actually flowing
    lastEventAt?: { [platform: string]: number }
    rates: any
    connections: any
    timerEvents: any
    merchValues: any
    fwProductBonuses: any
    fwProductSounds: any
    loggedOut?: boolean
    conTMI?: tmi.Client
    conSL?: any
    conFW?: any
}

export interface TimerWebSocket extends WebSocket {
    userId: number
    page?: string
    isAlive: boolean
    isReady: boolean
    forceSyncInterval: NodeJS.Timeout | number
    hbInterval: NodeJS.Timeout | number
    msgTokens: number
    msgLast: number
    msgWarnAt: number
}

// normalized event a platform adapter emits; the central handler turns it into time
export interface TimerEvent {
    platform: "twitch" | "streamlabs" | "youtube" | "kick" | "fourthwall"
    kind: "sub" | "bits" | "money" | "member" | "time"
    tier?: number
    count?: number
    bits?: number
    usd?: number
    unit?: string
    seconds?: number
    anonymous?: boolean
    manual?: boolean
    label: string
}
