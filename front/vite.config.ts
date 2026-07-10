import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import { fileURLToPath } from "url";

// alert sounds / timer-event media live in public/; a static site can't list a folder at
// runtime, so the lists are read here and baked in. adding a file needs a dev-server restart
// (dev) or a rebuild (pro).
const listPublic = (dir: string, re: RegExp) => {
	try {
		return fs
			.readdirSync(fileURLToPath(new URL(`./public/${dir}`, import.meta.url)))
			.filter((f) => re.test(f))
			.sort();
	} catch {
		return [];
	}
};
const fwSounds = listPublic("fwsounds", /\.(mp3|wav|ogg|m4a)$/i);
const mediaFiles = listPublic("media", /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a)$/i);

// https://vitejs.dev/config/
export default defineConfig({
	define: {
		__FW_SOUNDS__: JSON.stringify(fwSounds),
		__MEDIA_FILES__: JSON.stringify(mediaFiles),
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
