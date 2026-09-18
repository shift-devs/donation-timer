import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// alert sounds / timer-event media live in public/; a static site can't list a folder at
// runtime, so the lists are read here and baked in. adding a file needs a dev-server restart
// (dev) or a rebuild (pro) — and the dev server, which is what production runs too, restarts
// ITSELF when one lands (see refreshMediaLists below), so a sound dropped into the folder or
// pulled in by update.sh turns up in the pickers without anyone touching the stack.
const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));
const listPublic = (dir: string, re: RegExp) => {
	try {
		return fs
			.readdirSync(path.join(PUBLIC_DIR, dir))
			.filter((f) => re.test(f))
			.sort();
	} catch {
		return [];
	}
};
// one regex per folder, so a new extension only has to be added in one place. these are what the
// pickers on the dashboard offer, so anything a browser can play belongs here.
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i;
const MEDIA_RE = /\.(mp4|webm|mov|m4v|mp3|wav|ogg|oga|m4a|aac|flac)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const LISTS: { dir: string; re: RegExp }[] = [
	{ dir: "fwsounds", re: AUDIO_RE },
	{ dir: "media", re: MEDIA_RE },
	{ dir: "banners", re: IMAGE_RE },
	{ dir: "prizes", re: IMAGE_RE },
];
const fwSounds = listPublic("fwsounds", AUDIO_RE);
const mediaFiles = listPublic("media", MEDIA_RE);
const banners = listPublic("banners", IMAGE_RE);
const prizes = listPublic("prizes", IMAGE_RE);

// the lists above are fixed when this file is evaluated, which is once per server start. so when a
// file that belongs on one of them appears or disappears, restart the server: the config is read
// again, the constants are rebuilt, and the vite client in every open dashboard sees the
// connection drop and reloads the page once it's back — so the new sound is simply there.
// debounced, because an upload of ten files is ten events and one restart.
function refreshMediaLists(): Plugin {
	let pending: NodeJS.Timeout | undefined;
	return {
		name: "refresh-media-lists",
		apply: "serve",
		configureServer(server) {
			const listed = (file: string) => {
				const rel = path.relative(PUBLIC_DIR, file);
				if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
					return false;
				const parts = rel.split(path.sep);
				const list = LISTS.find((l) => l.dir === parts[0]);
				return !!list && parts.length === 2 && list.re.test(parts[1]);
			};
			const bump = (file: string) => {
				if (!listed(file))
					return;
				clearTimeout(pending);
				pending = setTimeout(() => {
					server.config.logger.info(`media folder changed (${path.basename(file)}) — restarting so the pickers see it`);
					server.restart().catch((err) => server.config.logger.error(`restart after media change failed: ${err}`));
				}, 1500);
			};
			server.watcher.add(LISTS.map((l) => path.join(PUBLIC_DIR, l.dir)));
			server.watcher.on("add", bump);
			server.watcher.on("unlink", bump);
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig({
	define: {
		__FW_SOUNDS__: JSON.stringify(fwSounds),
		__MEDIA_FILES__: JSON.stringify(mediaFiles),
		__BANNERS__: JSON.stringify(banners),
		__PRIZES__: JSON.stringify(prizes),
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
	plugins: [react(), refreshMediaLists()],
});
