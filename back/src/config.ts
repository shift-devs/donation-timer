export const WSS_PORT = 3003;
export const WS_FORCE_SYNC_TIME = 5 * 1000;
export const WS_HB_TIME = 10 * 1000;
export const CHAT_CMD_MAX_TIME = 100 * 3600;
export const MERCH_UPDATE_TIME = 60 * 1000;
export const DB_UPDATE_TIME = 5 * 1000;
export const EVENT_TICK_TIME = 5 * 1000;  // how often the timer-event scheduler checks triggers (minute-granular)
export const LOG_PAGE = 50;
export const WS_MSG_BURST = 40;   // per-connection message burst allowance
export const WS_MSG_RATE = 20;    // sustained messages/sec before dropping (FE-loop guard)
export const CLIENT_ID: string = process.env.CLIENT_ID || "";
export const WH_PATH: string = process.env.WH_PATH || "";
export const FW_POLL_TIME = 5 * 1000;     // how often we poll the fourthwall api for new orders/donations/members
export const FW_UNITS_POLL_TIME = 5 * 1000; // units-sold report poll for the /fwprogress bars — same cadence as the order poll so the bars move right away
export const FW_HTTP_TIMEOUT = 15 * 1000; // give up on a single fourthwall request so cycles can't hang/stack
// active-sub/sub-point snapshot poll: the resolution at which a lapsed sub shows up on stream. one cheap
// helix call, and 60 requests/min is a fraction of twitch's per-client budget. what makes this cadence
// affordable on our side is that the poller only broadcasts when the numbers actually move (see
// platforms/twitchSubs.ts) — otherwise every tick would push the whole settings payload to every open
// browser source.
export const TWITCH_SUBS_POLL_TIME = 1 * 1000;
// consecutive failures back off instead of retrying every 5s forever: over a months-long marathon a dead
// credential would otherwise be ~17k failed token requests a day, which is noisy and invites throttling.
// indexed by consecutive failure count, and it stays at the last entry from there on. the early steps are
// deliberately short — a counter advertised as live within 5s shouldn't go half a minute stale over one
// dropped request — and the cap is 5m rather than longer because it doubles as the recovery latency: an
// outage that heals on its own (twitch down and back) isn't noticed until the next attempt. 5m still cuts a
// dead credential to ~288 requests a day from ~17k, and a re-authorize restarts the poller immediately
// rather than waiting out the backoff.
export const TWITCH_SUBS_FAIL_BACKOFF_MS = [5 * 1000, 10 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];
// how many consecutive failures before the operator gets pinged. counted rather than timed, so it lands ~2min
// in with the ladder above: long enough that a blip stays quiet, short enough that a credential which died at
// 3am on day 40 doesn't go unnoticed.
export const TWITCH_SUBS_ALERT_AFTER = 5;
export const LOG_RETENTION_MS = 30 * 24 * 3600 * 1000; // keep ~30 days of audit-log rows, prune older
export const LOG_PRUNE_TIME = 6 * 3600 * 1000;         // how often to prune old log rows
export const ALLOWED_USERS: Array<String> = ["shift", "aaronrules5", "darkrta", "the_ivo_robotnik", "yoman47", "lobomfz"];
