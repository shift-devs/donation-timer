// always same-origin: nginx (pro) / the vite dev server (dev) proxy /ws to the backend. Derived
// from the page origin only — deliberately no env override, so stale config on a host can never
// point the socket at a dead address (VITE_WEBSOCKET_URL from any source is ignored).
export const WS_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
export const CLIENT_ID = import.meta.env.VITE_CLIENT_ID;
export const REDIRECT_URL = import.meta.env.VITE_REDIRECT_URL;
