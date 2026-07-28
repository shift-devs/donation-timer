// Single fixed deployment: the app is served from one static LAN address, so the base URL is a
// hardcoded constant instead of an env var. Change this one line if the host ever moves — every
// widget/source/socket URL derives from it. The socket scheme tracks the base (http→ws, https→wss);
// the vite dev server proxies /ws to the backend.
const CLIENT_BASE_URL = "http://192.168.1.5:3080";

// Local dev opens the app at localhost, which can't reach the client's LAN address, so derive the
// base from the current origin instead. Production is opened at the LAN address (hostname isn't
// localhost), so it keeps using CLIENT_BASE_URL unchanged.
const isLocalDev = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
export const BASE_URL = isLocalDev ? `${window.location.protocol}//${window.location.host}` : CLIENT_BASE_URL;
export const WS_URL = `${BASE_URL.replace(/^http/, "ws")}/ws`;
