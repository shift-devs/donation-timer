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
    // in-flight device-code authorization: the streamer has a code to type in. transient — a device code is
    // only good for ~30 min, so there's nothing worth reloading after a restart. deviceCode never leaves the
    // server; the ui only needs the short user code and the url.
    twitchSubsPending?: { deviceCode: string, userCode: string, verificationUri: string, expiresAt: number, interval: number }
    twitchSubsLogin?: string
    // the bot account's live state. the credentials themselves live on connections.twitchBot; these are the
    // transient halves — whether it last worked, and an authorization the operator is mid-way through.
    twitchBotError?: string
    twitchBotPending?: { deviceCode: string, userCode: string, verificationUri: string, expiresAt: number, interval: number }
    // ms timestamp of the last genuine (non-command) event we received per platform — proof data is actually flowing
    lastEventAt?: { [platform: string]: number }
    rates: any
    connections: any
    timerEvents: any
    // named /events browser sources ({id,name}[]); an event's layerId picks one. "" = the default source.
    eventLayers: any
    // mod-editable /text browser sources: one entry per source, carrying its look and its current words
    textBoxes: any
    // how the /firesale browser source looks and behaves (persisted config — see firesale.ts)
    firesaleSettings: any
    // the giveaway currently on screen: phase, entrants, winner. transient — never persisted, because a
    // giveaway that finished while the process was down must not come back up with it.
    firesale?: any
    // how the /mysterybox browser source looks, and the prize list with each prize's rarity and effect
    // (persisted config — see mysterybox.ts)
    mysteryBoxSettings: any
    // the ledger: { [twitch login]: { name, count } } — who is holding how many unopened boxes. earned by
    // putting an item up for firesale, spent with "!mb open". persisted: a box is a debt owed to a viewer.
    mysteryBoxes: any
    // the same again for unfired ray gun charges, won from a box and spent with "!raygun <name>"
    rayguns: any
    // the box being opened right now: the reel, who is opening it, which prize it lands on. transient, like
    // the firesale run above — a spin that was interrupted by a restart must not come back with it.
    mysterybox?: any
    // a prize's after-effect that is still running but keeps no state of its own (a nuke's timeouts, a text
    // box holding its words). the freezes and the bonfire sale are visible in timerPause/timeBoost instead.
    // what it's for: knowing whether the last box is still playing out, so the next one can't start on top.
    mbEffect?: { until: number, what: string }
    // who has spoken in twitch chat lately, for the prizes that act on chat (see chat.ts). transient:
    // a restart empties it and the next few minutes of chat fill it back in.
    chatters?: { [login: string]: { name: string, t: number, mod: boolean } }
    // set while a prize has every contribution granting more time than its rate says (the "bonfire sale").
    // `factor` is what a contribution's seconds are multiplied by, `until` is when it lapses. the rates
    // themselves are never touched — see timer.ts.
    timeBoost?: { until: number, factor: number, reason: string }
    // set while a prize is holding the countdown still. `until` is when it resumes and `remainingMs` is the
    // time being held — that one is authoritative, and endTime is re-derived from it by the tick in timer.ts.
    // `rollMs` marks a ROLLING pause (the timebomb): every contribution pushes `until` back out to this far
    // ahead, so the freeze lasts as long as chat keeps feeding it. 0/absent = a plain pause that just expires.
    timerPause?: { until: number, reason: string, remainingMs: number, rollMs: number }
    merchValues: any
    fwProductBonuses: any
    fwProductSounds: any
    // { [offerId]: false } for products whose on-stream purchase alert is turned off; absent = on
    fwProductAlerts: any
    // { [offerId]: banner filename } shown behind the alert's name panel; absent = the default purple panel
    fwProductBanners: any
    // { [offerId]: true } for products whose alert name draws a drop shadow (readability over a banner)
    fwProductShadows: any
    // { [offerId]: label } shown on stream in place of the shop's product name; absent = fourthwall's name
    fwProductNames: any
    widgetSettings: any
    fwActivity: any
    // { [offerId]: all-time units sold } from the fourthwall units-sold report, driving the /fwprogress bars.
    // transient: re-derived from the api each poll, never persisted.
    fwUnitsSold?: { [id: string]: number }
    // small product photos harvested from the product list, so the on-stream surfaces don't load the full-size
    // originals an order line carries. byImage is keyed by image id (an order's primaryImage resolves to the
    // compressed copy of that exact photo), byOffer is the per-product fallback. transient, like above.
    fwThumbs?: { byImage: { [id: string]: string }, byOffer: { [id: string]: string } }
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
    // for page=events only: which browser-source layer this client is. "" = the default source.
    layer?: string
    // for page=text only: which text box this source shows
    box?: string
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
    // a whole gift bomb arrives as one event, so count is how many subs the one gifter gave at once
    gifted?: boolean
    gifter?: string
    // a fourthwall order's product lines, so an event trigger can fire on a specific product being bought.
    // the time an order grants comes off its total (and the per-product bonuses), not from these.
    fwOffers?: { id: string, qty: number }[]
    manual?: boolean
    label: string
}
