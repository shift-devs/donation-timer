import React, { useEffect, useRef, useState } from "react";
import * as consts from "../Consts";
import { parseYouTube } from "../youtube";

// the OBS browser source for events. add this page as a Browser Source; the backend pushes {playEvent} messages
// (scheduled or via the dashboard Test button) and we play the clip here. the page is a solid #00FF00 fill that OBS
// keys out (color key filter), so only the clip shows over the scene. mirrors Widget.tsx's connect/reconnect lifecycle.

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

interface PlayItem {
	id: string;
	name: string;
	kind: "audio" | "video" | "youtube";
	src: string;
	volume: number;
	// optional trim, seconds into the media. null = the media's own start/end.
	startSec: number | null;
	endSec: number | null;
	// monotonically increasing so the same clip fired twice still remounts and replays
	nonce: number;
}

// youtube's iframe player api, fetched once and shared by every clip. we use the api rather than a plain
// autoplay iframe because only it gives us the volume setting and an end-of-video event to clear the source.
let ytApi: Promise<any> | null = null;
function loadYtApi(): Promise<any> {
	if (!ytApi)
		ytApi = new Promise((resolve, reject) => {
			const w = window as any;
			if (w.YT && w.YT.Player) {
				resolve(w.YT);
				return;
			}
			// the api calls this global once it's live; chain any existing one so we don't stomp it
			const prev = w.onYouTubeIframeAPIReady;
			w.onYouTubeIframeAPIReady = () => {
				if (typeof prev === "function") prev();
				resolve(w.YT);
			};
			const tag = document.createElement("script");
			tag.src = "https://www.youtube.com/iframe_api";
			tag.onerror = () => reject(new Error("could not load the youtube iframe api"));
			document.head.appendChild(tag);
		});
	return ytApi;
}

// turn captions off for good. cc_load_policy only governs whether youtube forces them ON; a video whose owner
// published a caption track still burns them over the clip, which on a chroma-keyed source lands as a subtitle
// bar sitting in the scene. unloading the module is what actually stops that. both names are tried because the
// html5 player calls it "captions" and the older one called it "cc", and neither is documented — so this stays
// best-effort by design: it must never take the clip down with it if the api drops the module.
function killCaptions(player: any) {
	for (const mod of ["captions", "cc"]) {
		try {
			player.unloadModule(mod);
		} catch {}
	}
}

// one youtube clip. keyed by nonce upstream, so a fire = a fresh mount = a fresh player.
const YouTubeClip: React.FC<{ item: PlayItem; onDone: () => void }> = ({ item, onDone }) => {
	const hostRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const parsed = parseYouTube(item.src);
		if (!parsed) {
			onDone();
			return;
		}
		// the event's own start wins; a link with no start box set still honors its ?t=
		const start = item.startSec != null ? item.startSec : parsed.start;
		let player: any = null;
		let stopTimer: any = null;
		let dead = false;
		loadYtApi()
			.then((YT: any) => {
				if (dead || !hostRef.current)
					return;
				// the api REPLACES the element it's given with the iframe, so hand it a child we made ourselves —
				// react must not own that node or unmounting would fight the player over it
				const mount = document.createElement("div");
				hostRef.current.appendChild(mount);
				player = new YT.Player(mount, {
					width: "100%",
					height: "100%",
					videoId: parsed.id,
					playerVars: {
						autoplay: 1,
						controls: 0,
						disablekb: 1,
						fs: 0,
						rel: 0,
						playsinline: 1,
						modestbranding: 1,
						iv_load_policy: 3,
						// captions off. this only keeps youtube from forcing them on — a video the owner
						// published captions for still shows them, so killCaptions does the actual work.
						cc_load_policy: 0,
						start: Math.round(start),
						// youtube stops at `end` and reports ENDED, which clears the source like a natural finish
						...(item.endSec != null ? { end: Math.ceil(item.endSec) } : {}),
					},
					events: {
						onReady: (e: any) => {
							killCaptions(e.target);
							const frame = e.target.getIframe();
							if (frame) {
								frame.style.width = "100%";
								frame.style.height = "100%";
								frame.style.border = "0";
								frame.style.pointerEvents = "none"; // belt and braces with the host's rule above
							}
							e.target.setVolume(Math.round(item.volume * 100));
							e.target.playVideo();
						},
						onStateChange: (e: any) => {
							// the captions module loads along with playback, so onReady alone can be too early
							killCaptions(e.target);
							if (e.data === YT.PlayerState.ENDED)
								onDone();
							// watchdog for a trimmed clip: if `end` is ignored for any reason, clear the source
							// anyway rather than leave a frozen frame sitting on the stream
							if (e.data === YT.PlayerState.PLAYING && item.endSec != null && !stopTimer)
								stopTimer = setTimeout(onDone, (Math.max(0, item.endSec - start) * 1000) + 2000);
						},
						// unplayable or embedding-disabled video: clear the source instead of parking on an error card
						onError: () => onDone(),
					},
				});
			})
			.catch(() => onDone());

		return () => {
			dead = true;
			clearTimeout(stopTimer);
			if (player && player.destroy)
				try { player.destroy(); } catch {}
			if (hostRef.current)
				hostRef.current.innerHTML = "";
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [item.nonce]);

	// the player paints its own black backdrop, so keep the box at the video's aspect: on a 16:9 canvas it fills
	// edge to edge and no black bars land inside the green that OBS keys out.
	// pointer-events off is what keeps the youtube chrome away: the title/channel bar, the share and watch-later
	// buttons, the "watch on youtube" link and the pause overlay are all hover-triggered, and a source nobody
	// clicks can't trigger them. it costs nothing here — obs never interacts with the page.
	return <div ref={hostRef} style={{ width: "100%", maxWidth: "calc(100vh * 16 / 9)", aspectRatio: "16 / 9", pointerEvents: "none" }} />;
};

const EventSource: React.FC = () => {
	const token = new URLSearchParams(window.location.search).get("token");
	const [item, setItem] = useState<PlayItem | null>(null);
	const nonceRef = useRef(0);

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=events`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			// this page only cares about play commands; the settings sync payload is ignored
			if ("playEvent" in response && response.playEvent && response.playEvent.src) {
				const p = response.playEvent;
				nonceRef.current += 1;
				setItem({
					id: p.id,
					name: p.name,
					kind: p.kind === "video" ? "video" : p.kind === "youtube" ? "youtube" : "audio",
					src: p.src,
					volume: typeof p.volume === "number" ? p.volume : 1,
					startSec: typeof p.startSec === "number" ? p.startSec : null,
					endSec: typeof p.endSec === "number" ? p.endSec : null,
					nonce: nonceRef.current,
				});
			}
		};

		ws.onclose = (event) => {
			console.log(`socket closed, attempting reconnect in 5 seconds... (${event.reason})`);
			clearTimeout(reconnectTimer);
			reconnectTimer = setTimeout(connectWs, 5000);
		};

		ws.onerror = (event) => {
			console.error(`socket encountered error: ${event} - closing socket`);
			ws.close();
		};
	};

	useEffect(() => {
		connectWs();
		return () => {
			clearTimeout(reconnectTimer);
			if (ws) {
				ws.onclose = ws.onmessage = ws.onerror = null;
				ws.close();
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// full-viewport chroma key fill: #00FF00 is keyed out in OBS (color key filter) so only the clip shows
	const wrap: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		margin: 0,
		background: "#00FF00",
		overflow: "hidden",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	};

	if (!token)
		return <div style={wrap} />;

	const clear = () => setItem(null);

	// the clip trim for a media-folder file: seek to the start once the duration is known, and stop at the end.
	// timeupdate fires ~4x a second, so the cut can land up to a frame or two late — close enough for a clip.
	const trim = (it: PlayItem) => ({
		onLoadedMetadata: (ev: React.SyntheticEvent<HTMLMediaElement>) => {
			if (it.startSec)
				try { ev.currentTarget.currentTime = it.startSec; } catch {}
		},
		onTimeUpdate: (ev: React.SyntheticEvent<HTMLMediaElement>) => {
			if (it.endSec != null && ev.currentTarget.currentTime >= it.endSec)
				clear();
		},
	});

	return (
		<div style={wrap}>
			{item && item.kind === "video" && (
				<video
					key={item.nonce}
					src={item.src}
					autoPlay
					playsInline
					style={{ width: "100%", height: "100%", objectFit: "contain" }}
					ref={(el) => { if (el) el.volume = item.volume; }}
					onEnded={clear}
					onError={clear}
					{...trim(item)}
				/>
			)}
			{item && item.kind === "audio" && (
				<audio
					key={item.nonce}
					src={item.src}
					autoPlay
					ref={(el) => { if (el) el.volume = item.volume; }}
					onEnded={clear}
					onError={clear}
					{...trim(item)}
				/>
			)}
			{item && item.kind === "youtube" && <YouTubeClip key={item.nonce} item={item} onDone={clear} />}
		</div>
	);
};

export default EventSource;
