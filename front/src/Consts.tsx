// same-origin by default: nginx (pro) / the vite dev server (dev) proxy /ws to the backend.
// VITE_WEBSOCKET_URL remains as an override for topologies without a proxy in front.
export const WS_URL = import.meta.env.VITE_WEBSOCKET_URL ||
	`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
export const CLIENT_ID = import.meta.env.VITE_CLIENT_ID;
export const REDIRECT_URL = import.meta.env.VITE_REDIRECT_URL;
export const BASE_URL = import.meta.env.VITE_BASE_URL;
