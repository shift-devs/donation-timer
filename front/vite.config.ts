import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
	server: {
		host: "0.0.0.0",
		port: 5173,
		hmr: {
			clientPort: 3080,
		},
		proxy: {
			// same-origin websocket in dev, mirroring nginx's /ws proxy in production
			"/ws": {
				target: "http://dev-back:3003",
				ws: true,
			},
		},
	},
	plugins: [react()],
});
