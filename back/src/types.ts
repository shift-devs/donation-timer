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
    capSeconds: number // max timer length in seconds; 0 = no cap
    // when on, a timer that reaches 0 stays there — later events add nothing until it's set by hand
    stopAtZero: boolean
    ignoreAnon: boolean
    slStatus: boolean
    slError?: string
    twitchStatus: boolean
    twitchError?: string
    fourthwallStatus: boolean
    fourthwallError?: string
    fourthwallLastOkAt?: number
    // live active-sub snapshot from helix (see platforms/twitchSubs.ts). transient: re-read every poll,
    // never persisted, because a stale "active" number is worse than none.
    twitchSubsStatus: boolean
    twitchSubsError?: string
    twitchSubsLastOkAt?: number
    subsActive?: number
    subsPoints?: number
    // ms timestamp of the last genuine (non-command) event we received per platform — proof data is actually flowing
    lastEventAt?: { [platform: string]: number }
    rates: any
    connections: any
    timerEvents: any
    merchValues: any
    fwProductBonuses: any
    fwProductSounds: any
    // { [offerId]: false } for products whose on-stream purchase alert is turned off; absent = on
    fwProductAlerts: any
    // { [offerId]: banner filename } shown behind the alert's name panel; absent = the default purple panel
    fwProductBanners: any
    // { [offerId]: true } for products whose alert name draws a drop shadow (readability over a banner)
    fwProductShadows: any
    widgetSettings: any
    fwActivity: any
    // { [offerId]: all-time units sold } from the fourthwall units-sold report, driving the /fwprogress bars.
    // transient: re-derived from the api each poll, never persisted.
    fwUnitsSold?: { [id: string]: number }
    // all-time per-service sub tallies driving the /subcount browser sources
    subCountTwitch: number
    subCountYoutube: number
    subCountKick: number
    loggedOut?: boolean
    conTMI?: tmi.Client
    conSL?: any
    conTwitchSubs?: any
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
