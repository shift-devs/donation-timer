import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as consts from "../Consts";
import { TRANSPARENT_BODY_CSS } from "../textEffect";
import { canonFiresale, countdown, STAGE_W, STAGE_H } from "../firesale";

// the OBS browser source for a Fourthwall giveaway: /firesale?token=… . add it as a Browser Source and size it
// 4:3 (it's meant to sit on the stream like a CRT). the backend pushes the whole run — phase, entrants, winner —
// and this draws it: FIRESALE rocking in the middle over the looping music, every chatter who typed !enter
// bouncing around like a DVD logo, then the winner held in the centre at the end.
//
// between giveaways the page draws nothing at all, so the source can live in the scene permanently.
//
// everything is laid out inside a fixed 1000x750 stage that's scaled as a unit to fit the source, so the type
// and the bounce speed stay in proportion whatever size the source is. mirrors TextBox.tsx's connect/reconnect
// lifecycle.

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// how soon after a run begins the announcer may still fire. a source that connects into a giveaway already in
// progress gets the state on its first sync, which would otherwise look exactly like a fresh start to it —
// this is what tells the two apart, so reloading the source mid-firesale doesn't re-blast the stinger.
const ANNOUNCE_WINDOW = 8000;
const SPEED = 145;        // logical px/sec — a DVD-logo drift, not a race
const MAX_DT = 0.05;      // s; OBS throttles a hidden source, and a resumed tab must not teleport everything

// how big each bouncing name is drawn, from how many are on screen at once. a packed frame needs smaller type
// or the names spend the whole giveaway wedged against each other with nowhere to move; a quiet one can afford
// to be big and readable. 120 (the default cap) lands at 16px, which fills the frame snugly and still leaves
// room to drift. anything between the two ends scales linearly.
function nameFontSize(count: number): number {
	if (count <= 40) return 30;
	if (count >= 120) return 16;
	return Math.round(30 - ((count - 40) / 80) * 14);
}

interface Bouncer {
	name: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	w: number;
	h: number;
	hue: number;
}

// classic DVD behaviour: every wall (and every collision) kicks the colour on
const rehue = (b: Bouncer) => { b.hue = (b.hue + 47 + Math.random() * 60) % 360; };

// the winner's name, sized to fit the frame on one line. 0.55em is about the average glyph width of the
// display face; the cap keeps a short name from looking comical and the floor keeps a 25-character one legible.
function winnerFontSize(name: string): number {
	const len = Math.max(1, String(name || "").length);
	return Math.max(52, Math.min(130, Math.floor((STAGE_W - 120) / (len * 0.55))));
}

const CSS = `
@keyframes fs-rock {
	0%   { transform: rotate(-5deg) scale(1); }
	50%  { transform: rotate(5deg) scale(1.07); }
	100% { transform: rotate(-5deg) scale(1); }
}
@keyframes fs-flash {
	0%, 49%   { opacity: 1; filter: brightness(1.35); }
	50%, 100% { opacity: 0.92; filter: brightness(0.7); }
}
@keyframes fs-pop {
	0%   { transform: scale(0.5); opacity: 0; }
	60%  { transform: scale(1.12); opacity: 1; }
	100% { transform: scale(1); opacity: 1; }
}
@keyframes fs-pulse {
	0%, 100% { opacity: 1; }
	50%      { opacity: 0.55; }
}
`;

const Firesale: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");

	const [run, setRun] = useState<any>(null);
	// the nonce of the run whose announcer has already been fired, so it plays exactly once per giveaway no
	// matter how many state pushes arrive (one lands on every !enter)
	// which runs have already had their announcer fired, so it plays exactly once per giveaway no matter how
	// many state pushes arrive (one lands on every !enter)
	const announced = useRef<{ [runId: string]: boolean }>({});
	const [announcing, setAnnouncing] = useState(0);
	// same, for the win sound: which runs have already had theirs played
	const won = useRef<{ [runId: string]: boolean }>({});
	const [winning, setWinning] = useState(0);
	// re-rendered once a second purely to move the countdown on; the bouncing is done outside react entirely
	const [, setTick] = useState(0);

	const wrapRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);

	const bouncers = useRef<Bouncer[]>([]);
	// name -> its element. kept apart from the bouncer array because react fills this in during commit, which
	// is BEFORE the effect that creates the bouncer — holding the node on the bouncer itself would leave every
	// newly entered name without one, and so never moved by the loop below.
	const els = useRef<{ [name: string]: HTMLDivElement | null }>({});

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=firesale`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			// the same payload arrives two ways: pushed the moment anything changes (a new entrant, a phase
			// turning over) and carried on the periodic sync, which is what recovers a source that reconnected
			// in the middle of a giveaway.
			if ("firesale" in response && response.firesale)
				setRun(response.firesale);
			else if ("error" in response)
				console.log(`error: ${response.error}`);
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

	// scale the 4:3 stage to fill the source, letterboxing whatever doesn't match. OBS reports its real size
	// here, so a 1920x1080 source (16:9) still gets a correct 4:3 stage, centred.
	useEffect(() => {
		const fit = () => {
			const el = wrapRef.current;
			if (!el)
				return;
			const w = el.clientWidth || window.innerWidth;
			const h = el.clientHeight || window.innerHeight;
			setScale(Math.max(0.05, Math.min(w / STAGE_W, h / STAGE_H)));
		};
		fit();
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
		if (ro && wrapRef.current)
			ro.observe(wrapRef.current);
		window.addEventListener("resize", fit);
		return () => {
			if (ro) ro.disconnect();
			window.removeEventListener("resize", fit);
		};
	}, []);

	const cfg = canonFiresale(run || {});
	// several giveaways can be open at once, so the payload carries a list. the bouncing field is the union of
	// everyone entered in any of them (the server already merged it); these split the list by what each run is
	// doing, because a resolved giveaway and one still taking entries share the screen.
	const runs: any[] = (run && Array.isArray(run.runs) ? run.runs : []);
	const winners = runs.filter((r) => r.phase === "winner");
	const openRuns = runs.filter((r) => r.phase !== "winner");
	const anyRunning = runs.some((r) => r.phase === "running");
	const allDrawing = openRuns.length > 0 && openRuns.every((r) => r.phase === "drawing");
	// exactly one giveaway on screen: the overlay draws what it always drew for a single firesale. every
	// concession to fitting several in (compact rows, per-run counts, smaller type) is gated on this being false,
	// so the common case is untouched by the multi-giveaway support.
	const solo = runs.length === 1;
	const active = !!(run && run.active);
	const names: string[] = (run && Array.isArray(run.names) ? run.names : []);
	const namesKey = names.join(" ");
	// the type size for this many names, and the outline that goes with it — both derived, so the look stays
	// proportional whether four names are bouncing or a hundred and twenty
	const nameFs = nameFontSize(names.length);
	const ring = Math.max(1, Math.round(nameFs / 15));

	// keep the physics array in step with the names the server sent. a name that's still entered keeps its
	// position and heading — the list is re-sent in full on every push, and respawning everyone each time
	// would make the whole field jump.
	// layout effect, not a plain one: it runs after the commit but before the browser paints, so a name that
	// just appeared is placed where it belongs on its very first frame instead of flashing in the corner.
	useLayoutEffect(() => {
		const want = new Set(names);
		bouncers.current = bouncers.current.filter((b) => want.has(b.name));
		for (const name of Object.keys(els.current))
			if (!want.has(name))
				delete els.current[name];
		const have = new Set(bouncers.current.map((b) => b.name));
		for (const name of names) {
			if (have.has(name))
				continue;
			// a fresh entrant enters at a random spot heading in a random direction, kept off the very edge so
			// it doesn't spend its first frame resolving a wall collision
			const ang = Math.random() * Math.PI * 2;
			// assumed size until the element has been measured for real, kept in step with the type size so a
			// packed frame doesn't spawn everything as if it were still 170px wide
			const spawnW = nameFs * 6;
			const spawnH = nameFs * 1.5;
			bouncers.current.push({
				name,
				x: 20 + Math.random() * Math.max(1, STAGE_W - spawnW - 40),
				y: 20 + Math.random() * Math.max(1, STAGE_H - spawnH - 40),
				vx: Math.cos(ang) * SPEED,
				vy: Math.sin(ang) * SPEED,
				w: spawnW,
				h: spawnH,
				hue: Math.floor(Math.random() * 360),
			});
		}
		// place everyone straight away. react never writes these transforms itself (they're not in the style
		// prop), so a re-render can't yank a name back to where it was when it entered.
		for (const b of bouncers.current) {
			const el = els.current[b.name];
			if (!el)
				continue;
			el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
			el.style.color = `hsl(${b.hue}, 95%, 62%)`;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [namesKey]);

	// the animation loop. it runs off refs and writes transforms straight onto the DOM nodes, so 40 names
	// bouncing at 60fps costs no react renders at all — the countdown below is the only thing re-rendering,
	// once a second.
	useEffect(() => {
		let raf = 0;
		let last = 0;
		const step = (t: number) => {
			raf = requestAnimationFrame(step);
			const dt = last ? Math.min(MAX_DT, (t - last) / 1000) : 0;
			last = t;
			const arr = bouncers.current;
			if (!dt || !arr.length)
				return;

			for (const b of arr) {
				// measure once the element is really on screen; until then the spawn guess is used, which is
				// only ever wrong for a frame or two
				const el = els.current[b.name];
				if (el && el.offsetWidth) {
					b.w = el.offsetWidth;
					b.h = el.offsetHeight;
				}
				b.x += b.vx * dt;
				b.y += b.vy * dt;
				// walls
				if (b.x <= 0) { b.x = 0; b.vx = Math.abs(b.vx); rehue(b); }
				else if (b.x + b.w >= STAGE_W) { b.x = STAGE_W - b.w; b.vx = -Math.abs(b.vx); rehue(b); }
				if (b.y <= 0) { b.y = 0; b.vy = Math.abs(b.vy); rehue(b); }
				else if (b.y + b.h >= STAGE_H) { b.y = STAGE_H - b.h; b.vy = -Math.abs(b.vy); rehue(b); }
			}

			// names bouncing off each other. O(n²), but n is the bouncer cap (40 by default, 200 at the very
			// most), so it's a few thousand comparisons a frame — far cheaper than the layout work of drawing them.
			for (let i = 0; i < arr.length; i++) {
				for (let j = i + 1; j < arr.length; j++) {
					const a = arr[i], c = arr[j];
					const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
					const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
					if (ox <= 0 || oy <= 0)
						continue;
					// separate along whichever axis they're least buried in, and only swap the velocities on
					// that axis if they're actually closing — otherwise a pair that's already parting gets
					// caught and the two stick together vibrating
					if (ox < oy) {
						const dir = a.x + a.w / 2 < c.x + c.w / 2 ? -1 : 1;
						a.x += (ox / 2) * dir;
						c.x -= (ox / 2) * dir;
						if ((a.vx - c.vx) * (c.x - a.x) > 0) {
							const t2 = a.vx; a.vx = c.vx; c.vx = t2;
						}
					} else {
						const dir = a.y + a.h / 2 < c.y + c.h / 2 ? -1 : 1;
						a.y += (oy / 2) * dir;
						c.y -= (oy / 2) * dir;
						if ((a.vy - c.vy) * (c.y - a.y) > 0) {
							const t2 = a.vy; a.vy = c.vy; c.vy = t2;
						}
					}
					rehue(a);
					rehue(c);
				}
			}

			for (const b of arr) {
				const el = els.current[b.name];
				if (!el)
					continue;
				el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
				el.style.color = `hsl(${b.hue}, 95%, 62%)`;
			}
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, []);

	// fire the announcer once per giveaway. tracked by run id rather than a single flag, because a second
	// giveaway opening while the first is still on screen is its own announcement — and the pushes that arrive
	// on every !enter must not retrigger either of them. the startedAt check is what keeps a source that loaded
	// into a giveaway already in progress quiet: it joins the music without blasting the stinger.
	useEffect(() => {
		if (!active || !cfg.announcer)
			return;
		for (const r of runs){
			if (r.phase !== "running" || announced.current[r.id])
				continue;
			announced.current[r.id] = true;
			if (r.startedAt && Date.now() - r.startedAt < ANNOUNCE_WINDOW)
				setAnnouncing((n) => n + 1);
		}
		// forget ids that have left, so the map can't grow across a long stream
		for (const id of Object.keys(announced.current))
			if (!runs.some((r) => r.id === id))
				delete announced.current[id];
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active, runs.map((r) => `${r.id}:${r.phase}`).join(","), cfg.announcer]);

	// the win sound, once per giveaway that resolves. mirrors the announcer exactly, including the recency
	// check — a source that loads while a winner is already up joins silently instead of re-firing the sting.
	useEffect(() => {
		if (!active || !cfg.winSound)
			return;
		for (const r of runs){
			if (r.phase !== "winner" || won.current[r.id])
				continue;
			won.current[r.id] = true;
			if (r.wonAt && Date.now() - r.wonAt < ANNOUNCE_WINDOW)
				setWinning((n) => n + 1);
		}
		for (const id of Object.keys(won.current))
			if (!runs.some((r) => r.id === id))
				delete won.current[id];
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active, runs.map((r) => `${r.id}:${r.phase}`).join(","), cfg.winSound]);

	// the entry countdown. only ticks while entries are open AND the clock is actually on screen — with it
	// turned off there's nothing on the page that changes per second, so there's nothing to re-render for.
	useEffect(() => {
		if (!anyRunning || !cfg.showCountdown)
			return;
		const id = setInterval(() => setTick((n) => n + 1), 250);
		return () => clearInterval(id);
	}, [anyRunning, cfg.showCountdown]);

	if (!token || !active)
		return <style>{TRANSPARENT_BODY_CSS}</style>;

	const display = cfg.bgColor === "transparent";

	// the stage sits centred in the source; the wrapper is the only thing that paints a fill, so a transparent
	// setup composites straight over the scene with no colour key at all
	const wrap: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		margin: 0,
		overflow: "hidden",
		background: cfg.bgColor,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	};

	const stage: React.CSSProperties = {
		position: "relative",
		width: STAGE_W,
		height: STAGE_H,
		flex: "0 0 auto",
		transform: `scale(${scale})`,
		transformOrigin: "center center",
		overflow: "hidden",
		fontFamily: "'Staatliches', cursive",
	};

	// centred over the bouncers, and never in the way of them: nothing here takes pointer events and the whole
	// block is a fixed height, so the names keep the full frame to move in
	const centre: React.CSSProperties = {
		position: "absolute",
		inset: 0,
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		zIndex: 3,
		pointerEvents: "none",
		textAlign: "center",
	};

	return (
		<div style={wrap} ref={wrapRef}>
			{display && <style>{TRANSPARENT_BODY_CSS}</style>}
			<style>{CSS}</style>

			{/* the looping bed, keyed on the nonce so a back-to-back giveaway restarts it from the top rather
			    than carrying on mid-track.
			    it stops the moment there's nothing left taking entries or waiting on a draw — unmounting the
			    element ends playback — so a winner reveal lands in the clear with only the win sound on it.
			    with several giveaways open it keeps going until the LAST one resolves: cutting the music while
			    chat is still entering another would leave the overlay silent mid-firesale. */}
			{cfg.music && openRuns.length > 0 && (
				<audio
					key={`m${run.nonce}`}
					src={`/media/${encodeURIComponent(cfg.music)}`}
					autoPlay
					loop
					ref={(el) => { if (el) el.volume = cfg.volume; }}
				/>
			)}

			{/* the win sound, once per giveaway that resolves. same two guards as the announcer: keyed on a
			    counter the effect bumps, so entrant pushes can't replay it, and gated on wonAt being recent so a
			    source loading while a winner is already on screen stays quiet. */}
			{cfg.winSound && winning > 0 && (
				<audio
					key={`w${winning}`}
					src={`/media/${encodeURIComponent(cfg.winSound)}`}
					autoPlay
					ref={(el) => { if (el) el.volume = cfg.winVolume; }}
				/>
			)}

			{/* the one-shot announcer, over the top of the bed. mounted only once the effect above says this
			    run has just started, and keyed on that run so it can never replay for the same giveaway. */}
			{cfg.announcer && announcing > 0 && (
				<audio
					key={`a${announcing}`}
					src={`/media/${encodeURIComponent(cfg.announcer)}`}
					autoPlay
					ref={(el) => { if (el) el.volume = cfg.announcerVolume; }}
				/>
			)}

			<div style={stage}>
				{/* every entrant, bouncing. positioned by the rAF loop above, never by react. */}
				{names.map((name) => (
					<div
						key={name}
						ref={(el) => { els.current[name] = el; }}
						style={{
							position: "absolute",
							top: 0,
							left: 0,
							willChange: "transform",
							whiteSpace: "nowrap",
							fontFamily: "'Roboto', sans-serif",
							fontWeight: 700,
							fontSize: nameFs,
							lineHeight: 1.25,
							padding: `${Math.max(1, Math.round(nameFs * 0.07))}px ${Math.max(3, Math.round(nameFs * 0.33))}px`,
							letterSpacing: "0.02em",
							// a hard black edge so a name stays readable wherever it drifts over the scene
							textShadow: `${ring}px ${ring}px 0 #000, -${ring}px ${ring}px 0 #000, ${ring}px -${ring}px 0 #000, -${ring}px -${ring}px 0 #000, 0 0 ${ring * 6}px rgba(0,0,0,0.85)`,
							// a winner is the thing to read, so the field drops back behind it — but only once
							// every giveaway has resolved. dimming while another is still taking entries would
							// mute the names of people who are actively entering it.
							opacity: winners.length > 0 && !openRuns.length ? 0.35 : 1,
							transition: "opacity 400ms linear",
							// no transform here on purpose — position belongs to the layout effect and the rAF
							// loop, and a value in this style prop would fight them on every re-render
						}}
					>
						{name}
					</div>
				))}

				<div style={centre}>
					{/* a resolved giveaway takes the headline; FIRESALE holds it the rest of the time. with a winner up
					    there is no room for both, and WINNER is the thing to read. */}
					{winners.length === 0 ? (
						<div style={{ animation: "fs-rock 700ms ease-in-out infinite" }}>
							<div
								style={{
									animation: "fs-flash 420ms steps(1, end) infinite",
									color: cfg.titleColor,
									// a second giveaway adds another line below, so the title gives up some height for it
									fontSize: openRuns.length >= 2 ? 116 : 148,
									lineHeight: 0.95,
									letterSpacing: "0.03em",
									WebkitTextStrokeWidth: "6px",
									WebkitTextStrokeColor: "#000",
									paintOrder: "stroke fill",
									textShadow: "0 0 40px rgba(255,60,0,0.9), 0 8px 0 rgba(0,0,0,0.55)",
								}}
							>
								FIRESALE
							</div>
						</div>
					) : (
						winners.map((w) => (
							<div key={w.id} style={{ animation: "fs-pop 500ms cubic-bezier(.2,1.4,.4,1) both", marginBottom: 6 }}>
								<div
									style={{
										fontSize: winners.length > 1 ? 52 : 78,
										color: "#ffe600",
										WebkitTextStrokeWidth: "5px",
										WebkitTextStrokeColor: "#000",
										paintOrder: "stroke fill",
									}}
								>
									WINNER
								</div>
								<div
									style={{
										// twitch names run to 25 characters, and at a fixed size a long one wraps in the
										// middle of itself and runs off both edges. size it to the name instead, then scale
										// that down again when it has to share the screen.
										fontSize: Math.round(winnerFontSize(w.winner) * (winners.length > 1 ? 0.55 : openRuns.length ? 0.72 : 1)),
										lineHeight: 1.05,
										whiteSpace: "nowrap",
										color: cfg.nameColor,
										WebkitTextStrokeWidth: "6px",
										WebkitTextStrokeColor: "#000",
										paintOrder: "stroke fill",
										textShadow: "0 0 45px rgba(255,230,0,0.85)",
									}}
								>
									{w.winner}
								</div>
								{/* WHICH prize was won. never optional when more than one giveaway is in play — a bare
								    name would leave viewers guessing which one they just won. */}
								{w.prize && (
									<div
										style={{
											marginTop: 4,
											fontSize: winners.length > 1 ? 28 : 40,
											color: "#fff",
											WebkitTextStrokeWidth: "4px",
											WebkitTextStrokeColor: "#000",
											paintOrder: "stroke fill",
											maxWidth: STAGE_W - 120,
										}}
									>
										{w.prize}
									</div>
								)}
							</div>
						))
					)}

					{/* every giveaway still in play, one line each: prize, who gifted it, and its OWN entry count —
					    those differ between overlapping runs, because someone who entered before the later one opened
					    isn't in it. a run that's closed says so here instead of showing a count. */}
					{openRuns.length > 0 && (
						<div style={{ marginTop: winners.length ? 10 : 6, display: "flex", flexDirection: "column", gap: 2 }}>
							{openRuns.map((r) => (
								<div
									key={r.id}
									style={{
										// a winner card above eats the space these rows would otherwise have, so they go
										// compact whenever one is up — not only when several giveaways are listed
										fontSize: winners.length || openRuns.length >= 2 ? 30 : 38,
										lineHeight: 1.15,
										color: "#fff",
										WebkitTextStrokeWidth: "4px",
										WebkitTextStrokeColor: "#000",
										paintOrder: "stroke fill",
										maxWidth: solo ? STAGE_W - 200 : STAGE_W - 160,
										overflowWrap: "break-word",
									}}
								>
									{r.prize || "GIVEAWAY"}
									{/* the gifter drops to its own smaller line when this is the only giveaway on
									    screen — there's room for it, and it's the layout a single firesale has
									    always had. sharing the screen, it goes inline to save the height. */}
									{r.gifter && (solo
										? <div style={{ fontSize: 28, opacity: 0.85 }}>from {r.gifter}</div>
										: <span style={{ opacity: 0.8 }}> — {r.gifter}</span>)}
									{/* the per-run count and status only exist to tell several giveaways apart. with
									    one on screen the big "N ENTERED" / "DRAWING…" below already says it, and
									    printing it twice was just noise. */}
									{!solo && (
										<span style={{ color: r.phase === "drawing" ? "#ffe600" : cfg.nameColor }}>
											{r.phase === "drawing"
												? "  ·  DRAWING…"
												: `  ·  ${r.total} in${cfg.showCountdown && r.endsAt ? ` · ${countdown(r.endsAt - Date.now())}` : ""}`}
										</span>
									)}
								</div>
							))}
						</div>
					)}

					{/* the call to action, once for the whole overlay — !enter carries no way to name a giveaway, so
					    one of these covers every run that's open. */}
					{anyRunning && (
						<div
							style={{
								marginTop: 14,
								fontSize: winners.length || openRuns.length >= 2 ? 48 : 62,
								color: "#ffe600",
								WebkitTextStrokeWidth: "5px",
								WebkitTextStrokeColor: "#000",
								paintOrder: "stroke fill",
							}}
						>
							TYPE !{cfg.command.toUpperCase()}
							{cfg.showCountdown && openRuns.length === 1 && openRuns[0].endsAt
								? ` — ${countdown(openRuns[0].endsAt - Date.now())}`
								: ""}
						</div>
					)}

					{/* nothing is taking entries any more and nothing has been won yet */}
					{!anyRunning && allDrawing && winners.length === 0 && (
						<div
							style={{
								marginTop: 14,
								fontSize: 62,
								color: "#ffe600",
								WebkitTextStrokeWidth: "5px",
								WebkitTextStrokeColor: "#000",
								paintOrder: "stroke fill",
								animation: "fs-pulse 900ms ease-in-out infinite",
							}}
						>
							DRAWING…
						</div>
					)}

					{/* the union across every open giveaway — the same people the field is bouncing */}
					{openRuns.length > 0 && (
						<div
							style={{
								marginTop: 8,
								fontSize: winners.length || openRuns.length >= 2 ? 34 : 44,
								color: cfg.nameColor,
								WebkitTextStrokeWidth: "4px",
								WebkitTextStrokeColor: "#000",
								paintOrder: "stroke fill",
							}}
						>
							{run.total} ENTERED
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default Firesale;
