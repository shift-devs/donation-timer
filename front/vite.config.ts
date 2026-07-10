import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import { fileURLToPath } from "url";

// alert sounds live in public/fwsounds; a static site can't list a folder at runtime, so the
// list is read here and baked in as __FW_SOUNDS__. adding a file needs a dev-server restart
// (dev) or a rebuild (pro) — same lifecycle as the /media folder.
const fwSounds = (() => {
	try {
		return fs
			.readdirSync(fileURLToPath(new URL("./public/fwsounds", import.meta.url)))
			.filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f))
			.sort();
	} catch {
		return [];
	}
})();

// https://vitejs.dev/config/
export default defineConfig({
	define: {
		__FW_SOUNDS__: JSON.stringify(fwSounds),
	},
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
