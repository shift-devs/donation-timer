// Single fixed deployment: the app is served from one static LAN address, so the base URL is a
// hardcoded constant instead of an env var. Change this one line if the host ever moves — every
// widget/source/socket URL derives from it. The socket scheme tracks the base (http→ws, https→wss);
// nginx (pro) / the vite dev server (dev) proxy /ws to the backend.
export const BASE_URL = "http://192.168.1.5:3080";
export const WS_URL = `${BASE_URL.replace(/^http/, "ws")}/ws`;
