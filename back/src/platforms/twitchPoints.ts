import axios from "axios";
import WebSocket from "ws";
import { TimerUserSession } from "../types";
import { FW_HTTP_TIMEOUT } from "../config";
import { emitSync, emitTerminal, reportError } from "../bus";
import { diag } from "../diag";
import { freshAccessToken, TWITCH_POINTS_SCOPE } from "./twitchSubs";
import { creditChannelPoints } from "../mysterybox";

// channel points redemptions, heard live over twitch's EventSub websocket. the only use today is the mystery
// box: redeeming the reward named on the Mystery Box tab puts boxes in the redeemer's wallet.
//
// it rides the BROADCASTER's authorization — the one the active sub count already uses (twitchSubs.ts) —
// because twitch only tells a channel's own token about its redemptions. that authorization now asks for
// channel:read:redemptions as well; a token granted before it did simply doesn't carry the scope, and this
// says so on the tab (re-authorize) rather than failing in the dark.
//
// websocket rather than polling helix: helix only lists redemptions of rewards the SAME twitch app created,
// and the streamer makes theirs on twitch's own dashboard. the socket hears every reward.
//
// the protocol, briefly: connect, twitch says welcome with a session id, we subscribe that session within ten
// seconds, then notifications arrive. twitch sends a keepalive when it has nothing else to say — silence past
// keepalive_timeout_seconds means the socket is dead and we start again. a session_reconnect hands us a new
// url to move to; the old socket stays up until the new one is welcomed, and the subscription moves with it.
const EVENTSUB_WS = "wss://eventsub.wss.twitch.tv/ws";
const HELIX = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";
const REDEMPTION = "channel.channel_points_custom_reward_redemption.add";
// how long to wait before connecting again after the socket dies, by how many times in a row it has
const RETRY_MS = [5000, 15000, 60000, 300000];
// slack on top of twitch's own keepalive timeout before the socket is called dead
const KEEPALIVE_SLACK_MS = 5000;

export function connectTwitchPoints(session: TimerUserSession){
    const watching = (session.connections.twitch && session.connections.twitch.channel) || session.name;
    let stopped = false;
    let sock: WebSocket | null = null;
    let keepalive: any;
    let retry: any;
    let failures = 0;
    // twitch delivers at least once, so a redemption can arrive twice; its message id says so
    const seen: string[] = [];

    const status = (ok: boolean, error: string) => {
        if (session.twitchPointsStatus === ok && (session.twitchPointsError || "") === error)
            return;
        session.twitchPointsStatus = ok;
        session.twitchPointsError = error;
        emitSync(session.userId);
    };

    const later = () => {
        if (stopped)
            return;
        clearTimeout(retry);
        const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
        failures++;
        retry = setTimeout(() => open(EVENTSUB_WS, false), wait);
    };

    // subscribe this socket's session to redemptions. false = the token can't, and trying again won't help
    // until the streamer re-authorizes — which builds a fresh connection anyway.
    async function subscribe(sessionId: string): Promise<boolean> {
        const t = session.connections.twitchSubs;
        const token = await freshAccessToken(session);
        const v = await axios.get(`${OAUTH}/validate`, {
            headers: { Authorization: `OAuth ${token}` },
            timeout: FW_HTTP_TIMEOUT,
        });
        const scopes: string[] = (v.data && v.data.scopes) || [];
        if (!scopes.includes(TWITCH_POINTS_SCOPE)){
            status(false, "This Twitch authorization predates channel points. Re-authorize \"Twitch active subs\" on the Connections tab to turn them on.");
            return false;
        }
        await axios.post(`${HELIX}/eventsub/subscriptions`, {
            type: REDEMPTION,
            version: "1",
            condition: { broadcaster_user_id: t.broadcasterId },
            transport: { method: "websocket", session_id: sessionId },
        }, {
            headers: { Authorization: `Bearer ${token}`, "Client-Id": t.clientId, "Content-Type": "application/json" },
            timeout: FW_HTTP_TIMEOUT,
        });
        return true;
    }

    function redeemed(ev: any){
        const login = String((ev && ev.user_login) || "");
        const name = String((ev && ev.user_name) || login);
        const title = String((ev && ev.reward && ev.reward.title) || "");
        // every redemption heard goes in the diag file, credited or not, so "it never arrived" and "it arrived
        // and didn't match" can be told apart after the fact
        diag(`TWITCHPOINTS ${watching}: ${login || "(no login)"} redeemed "${title}"`);
        try {
            creditChannelPoints(session, login, name, title);
        } catch (err) {
            reportError(session.userId, "crediting a channel points redemption", err);
        }
    }

    function open(url: string, moving: boolean){
        if (stopped)
            return;
        const me = new WebSocket(url);
        const previous = sock;
        sock = me;
        const arm = (seconds: number) => {
            clearTimeout(keepalive);
            keepalive = setTimeout(() => {
                if (sock === me){
                    diag(`TWITCHPOINTS ${watching}: no keepalive in ${seconds}s, reconnecting`);
                    me.terminate();
                }
            }, seconds * 1000 + KEEPALIVE_SLACK_MS);
        };
        let keepaliveSec = 10;
        me.on("message", (data: WebSocket.RawData) => {
            if (sock !== me)
                return;
            let msg: any;
            try {
                msg = JSON.parse(String(data));
            } catch {
                return;
            }
            const type = msg && msg.metadata && msg.metadata.message_type;
            arm(keepaliveSec);
            if (type === "session_welcome"){
                const s = (msg.payload && msg.payload.session) || {};
                keepaliveSec = Math.max(10, Number(s.keepalive_timeout_seconds) || 10);
                arm(keepaliveSec);
                if (moving){
                    // a reconnect carries the subscription over; the old socket can go now
                    if (previous)
                        previous.close();
                    failures = 0;
                    status(true, "");
                    return;
                }
                subscribe(String(s.id || "")).then((ok) => {
                    if (!ok){
                        stopped = true;
                        me.close();
                        return;
                    }
                    failures = 0;
                    status(true, "");
                    console.log(`Listening for ${watching}'s channel point redemptions!`);
                }).catch((err: any) => {
                    const r = err && err.response;
                    diag(`TWITCHPOINTS ${watching}: subscribe failed: ${r ? `${r.status} ${JSON.stringify(r.data)}` : (err && err.message)}`);
                    status(false, r ? `Twitch refused the channel points subscription (${r.status}${r.data && r.data.message ? ` — ${r.data.message}` : ""}).` : "Couldn't reach Twitch for channel points.");
                    me.close();
                });
                return;
            }
            if (type === "session_reconnect"){
                const next = msg.payload && msg.payload.session && msg.payload.session.reconnect_url;
                if (next)
                    open(String(next), true);
                return;
            }
            if (type === "notification"){
                const id = String(msg.metadata.message_id || "");
                if (id && seen.includes(id))
                    return;
                if (id){
                    seen.push(id);
                    if (seen.length > 100)
                        seen.shift();
                }
                if (msg.metadata.subscription_type === REDEMPTION)
                    redeemed(msg.payload && msg.payload.event);
                return;
            }
            if (type === "revocation"){
                const why = (msg.payload && msg.payload.subscription && msg.payload.subscription.status) || "revoked";
                emitTerminal(session.userId, `Twitch stopped sending channel point redemptions (${why}). Re-authorize "Twitch active subs" on the Connections tab.`);
                status(false, `Twitch revoked the channel points subscription (${why}). Re-authorize to turn it back on.`);
            }
        });
        me.on("error", (err: any) => diag(`TWITCHPOINTS ${watching}: socket error: ${err && err.message}`));
        me.on("close", () => {
            // only the CURRENT socket going down is news. an old one closed after a move is the move working.
            if (sock !== me)
                return;
            clearTimeout(keepalive);
            sock = null;
            if (stopped)
                return;
            status(false, session.twitchPointsError || "Lost the connection to Twitch; reconnecting.");
            later();
        });
    }

    open(EVENTSUB_WS, false);

    return {
        disconnect(){
            stopped = true;
            clearTimeout(retry);
            clearTimeout(keepalive);
            const s = sock;
            sock = null;
            if (s)
                s.close();
            session.twitchPointsStatus = false;
        }
    };
}
