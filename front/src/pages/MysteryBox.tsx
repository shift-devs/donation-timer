import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as consts from "../Consts";
import { TRANSPARENT_BODY_CSS } from "../textEffect";
import { canonMysteryBox, prizeImageSrc, countdown, STAGE_W, STAGE_H } from "../mysterybox";

// the OBS browser source for the mystery box: /mysterybox?token=… . add it as a Browser Source and size it
// 4:3, the same as the firesale source. when a viewer spends a box with "!mb open" the backend pushes the
// whole open — who is opening it, the reel, and which prize it lands on — and this draws it: the prize art
// scrolling past like a slot machine, decelerating, and stopping dead on the prize they won.
//
// between opens the page draws nothing at all, so the source can live in the scene permanently.
//
// THE SERVER DECIDES THE PRIZE, not this page. the reel it sends already ends on the winner, so the animation
// here is only ever playing back a result that's already been drawn — and the effect that prize triggers fires
// on the backend at the same instant, whether or not anybody has this source open.
//
// everything is laid out inside a fixed 1000x750 stage scaled as a unit to fit the source, mirroring
// Firesale.tsx's layout and connect/reconnect lifecycle.

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

// how recently the reel must have landed for the prize sound to still be worth playing. a source that opens
// (or reloads) while a prize is already on screen picks up the state on its first sync, which would otherwise
// look exactly like a fresh landing to it.
const LAND_WINDOW = 4000;

const CARD = 240;   // one prize tile, logical px
const GAP = 24;
const STEP = CARD + GAP;

// slot-machine deceleration: fast off the line, crawling by the end. a linear spin reads like a slideshow,
// and the whole tension of the thing is in the last second.
function easeOut(t: number): number {
	const c = Math.min(1, Math.max(0, t));
	return 1 - Math.pow(1 - c, 3);
}

const CSS = `
@keyframes mb-pop {
	0%   { transform: scale(0.6); opacity: 0; }
	60%  { transform: scale(1.1);  opacity: 1; }
	100% { transform: scale(1);    opacity: 1; }
}
@keyframes mb-glow {
	0%, 100% { box-shadow: 0 0 30px 6px rgba(255,212,0,0.55); }
	50%      { box-shadow: 0 0 60px 18px rgba(255,212,0,0.95); }
}
@keyframes mb-beat {
	0%, 100% { transform: scale(1); }
	50%      { transform: scale(1.06); }
}
@keyframes mb-panic {
	0%, 100% { transform: scale(1);    opacity: 1; }
	50%      { transform: scale(1.22); opacity: 0.75; }
}
@keyframes mb-rock {
	0%   { transform: rotate(-4deg) scale(1); }
	50%  { transform: rotate(4deg) scale(1.06); }
	100% { transform: rotate(-4deg) scale(1); }
}
@keyframes mb-flash {
	0%, 49%   { opacity: 1; filter: brightness(1.35); }
	50%, 100% { opacity: 0.92; filter: brightness(0.7); }
}
@keyframes mb-pulse {
	0%, 100% { opacity: 1; }
	50%      { opacity: 0.72; }
}
@keyframes mb-bob {
	0%, 100% { transform: translateY(0) rotate(-2deg); }
	50%      { transform: translateY(-10px) rotate(2deg); }
}
`;

const MysteryBox: React.FC = () => {
	const params = new URLSearchParams(window.location.search);
	const token = params.get("token");

	const [state, setState] = useState<any>(null);
	// a bonfire sale outlives the reveal that started it by a long way, so it's tracked apart from the open:
	// the source keeps a banner up for as long as one runs, which is the only way chat learns it's on.
	const [boost, setBoost] = useState<any>(null);
	// a timebomb's countdown is the whole game — chat can only chain contributions if they can see how long
	// they have left. a plain pause gets no banner: nothing they do changes it, and the frozen timer on the
	// widget already says it's frozen.
	const [bomb, setBomb] = useState<any>(null);
	// the quick revive challenge: the operator starts it by hand and chat races the clock for sub points. it
	// has the frame to itself — a box can't be opened while it runs, and it can't start while one is open.
	const [revive, setRevive] = useState<any>(null);
	// which run's result sound has played, keyed on the run's nonce for the same reason landCue is
	const [reviveCue, setReviveCue] = useState("");
	const decided = useRef<{ [nonce: string]: boolean }>({});
	// which open's prize sound has already been played, keyed on the open's nonce. NOT a bare "have i played
	// one" flag: that stays truthy after the overlay goes idle, so the element would remount — and replay —
	// the moment the next box was opened. (the firesale source learned this the hard way.)
	const [landCue, setLandCue] = useState("");
	const landed = useRef<{ [nonce: string]: boolean }>({});

	const wrapRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	// the strip is moved by the rAF loop below, never by react — a re-render mid-spin must not yank it back
	const stripRef = useRef<HTMLDivElement>(null);
	const rafRef = useRef(0);

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=mysterybox`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			// the same payload arrives two ways: pushed the moment the phase turns over, and carried on the
			// periodic sync, which is what recovers a source that reconnected mid-spin
			if ("mysterybox" in response && response.mysterybox)
				setState(response.mysterybox);
			// only the sync carries this, and it carries it every time (null included) — a targeted mysterybox
			// push has no opinion on it, so the key's absence must not read as "the sale ended"
			if ("timeBoost" in response)
				setBoost(response.timeBoost);
			if ("timerPause" in response)
				setBomb(response.timerPause && response.timerPause.rollMs ? response.timerPause : null);
			// pushed the moment the clock starts, a sub lands or it's decided, and carried on the sync as well
			if ("quickRevive" in response && response.quickRevive)
				setRevive(response.quickRevive);
			if (!("mysterybox" in response) && "error" in response)
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

	// scale the 4:3 stage to fill the source, letterboxing whatever doesn't match
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

	const cfg = canonMysteryBox(state || {});
	const active = !!(state && state.active);
	const phase: string = (state && state.phase) || "idle";
	const reel: string[] = state && Array.isArray(state.reel) ? state.reel : [];
	const prizes: any[] = state && Array.isArray(state.prizes) ? state.prizes : [];
	const prize = (state && state.prize) || null;
	const byId: { [id: string]: any } = {};
	for (const p of prizes)
		byId[p.id] = p;
	const nonce = String((state && state.nonce) || "");
	// where the spin starts and where it stops. the tiles outside that span are padding, held either side so
	// there is always art beyond the frame in both directions — a strip that began and ended on the two tiles
	// chat is watching hardest would give the whole thing away as a short filmstrip.
	const startIndex = Number((state && state.startIndex) || 0);
	const landIndex = Number(state && Number.isFinite(state.landIndex) ? state.landIndex : Math.max(0, reel.length - 1));
	const startedAt = Number((state && state.startedAt) || 0);
	const endsAt = Number((state && state.endsAt) || 0);

	// drive the strip. the position comes off the WALL CLOCK (startedAt → endsAt), not off a counter started
	// when this page happened to see the open — that's what lets a source opened halfway through a spin drop
	// straight into the right place instead of replaying it from the beginning.
	useLayoutEffect(() => {
		cancelAnimationFrame(rafRef.current);
		const el = stripRef.current;
		if (!el || !reel.length)
			return;
		// the strip's own left edge starts at the middle of the window, so offsetting by one step per index
		// puts card `pos` dead centre under the marker
		const place = (pos: number) => {
			el.style.transform = `translateX(${-pos * STEP}px)`;
		};
		if (phase !== "spinning" || !endsAt || endsAt <= startedAt){
			place(landIndex); // landed (or nothing to animate): the winner is centre, padding either side
			return;
		}
		const run = () => {
			const t = (Date.now() - startedAt) / (endsAt - startedAt);
			place(startIndex + easeOut(t) * (landIndex - startIndex));
			if (t < 1)
				rafRef.current = requestAnimationFrame(run);
		};
		run();
		return () => cancelAnimationFrame(rafRef.current);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [phase, nonce, reel.length, startIndex, landIndex, startedAt, endsAt]);

	// the prize sound, once per open. same two guards the firesale source uses on its win sound: keyed on the
	// open so a later push can't replay it, and gated on wonAt being recent so a source that loads while a
	// prize is already up stays quiet.
	useEffect(() => {
		if (phase !== "reveal" || !nonce || landed.current[nonce])
			return;
		landed.current[nonce] = true;
		if (state && state.wonAt && Date.now() - state.wonAt < LAND_WINDOW)
			setLandCue(nonce);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [phase, nonce]);

	const reviveActive = !!(revive && revive.active);
	const revivePhase: string = (revive && revive.phase) || "idle";
	const reviveRunning = revivePhase === "running";
	const reviveNonce = String((revive && revive.nonce) || "");

	// re-render once a second purely to move the banner's countdown on
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!boost && !bomb && !reviveRunning)
			return;
		const id = setInterval(() => setTick((n) => n + 1), 250);
		return () => clearInterval(id);
	}, [!!boost, !!bomb, reviveRunning]);

	// the result sound, once per run: keyed on the run, and gated on the decision being recent so a source
	// that loads while the result is already up stays quiet — the same two guards as the prize sound
	useEffect(() => {
		if ((revivePhase !== "won" && revivePhase !== "lost") || !reviveNonce || decided.current[reviveNonce])
			return;
		decided.current[reviveNonce] = true;
		if (revive && revive.resultAt && Date.now() - revive.resultAt < LAND_WINDOW)
			setReviveCue(reviveNonce);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [revivePhase, reviveNonce]);

	useEffect(() => {
		if (revivePhase === "idle"){
			setReviveCue("");
			decided.current = {};
		}
	}, [revivePhase]);

	useEffect(() => {
		if (phase === "idle"){
			setLandCue("");   // let the element unmount, so the next open can mount a fresh one and play
			landed.current = {};
		}
	}, [phase]);

	// a sale keeps the source on screen after the box that granted it has gone, and can bring it back with no
	// box open at all
	const boostLeft = boost ? boost.until - Date.now() : 0;
	const showBoost = !!boost && boostLeft > 0;
	const bombLeft = bomb ? bomb.until - Date.now() : 0;
	const showBomb = !!bomb && bombLeft > 0;
	// full size only when the sale has the frame to itself. with a box being opened underneath it, the reel
	// is what chat is watching and a banner this big would land on top of the title.
	const saleBig = showBoost && !active;
	// the prize's NAME is whatever the operator typed, so the size has to come off its length or a long one
	// would run off both sides of the frame — and the rock below swings it wider still. 0.55em is about the
	// average glyph width of the display face; the firesale source sizes its winner names the same way.
	const saleName = String((boost && boost.reason) || "");
	const saleFs = saleBig
		? Math.max(40, Math.min(116, Math.floor((STAGE_W - 150) / (Math.max(4, saleName.length) * 0.55))))
		: Math.max(28, Math.min(56, Math.floor((STAGE_W - 150) / (Math.max(4, saleName.length) * 0.55))));
	const saleSubFs = saleBig ? 46 : 32;
	// the freeze gets the middle of the frame whenever it isn't sharing it with a reveal
	const bombBig = showBomb && !active;
	const bombName = String((bomb && bomb.reason) || "");
	const bombFs = bombBig
		? Math.max(44, Math.min(104, Math.floor((STAGE_W - 150) / (Math.max(4, bombName.length) * 0.55))))
		: Math.max(28, Math.min(52, Math.floor((STAGE_W - 150) / (Math.max(4, bombName.length) * 0.55))));
	// whole seconds, rounded UP so a freeze with any time left never reads as 0
	const bombSecs = Math.max(0, Math.ceil(bombLeft / 1000));
	// how much room the whole banner takes, so the timebomb's can sit under it rather than through it.
	// a name too long to fit on one line even at the smallest size WRAPS rather than running off the frame,
	// so the line count is part of the height — otherwise a wordy prize name would push the timebomb's
	// banner up underneath its own second line.
	const salePad = saleBig ? 56 : 24;
	const saleLines = Math.max(1, Math.ceil((saleName.length * saleFs * 0.55) / (STAGE_W - 80)));
	const saleH = Math.round(salePad + saleFs * 0.95 * saleLines + 8 + saleSubFs * 1.5 * 1.1);
	// the challenge's own numbers. whole seconds, rounded up, so a clock with any time left never reads 0.
	const reviveLeft = reviveRunning ? Math.max(0, (revive.endsAt || 0) - Date.now()) : 0;
	const reviveSecs = Math.max(0, Math.ceil(reviveLeft / 1000));
	const reviveGoal = Math.max(1, Number((revive && revive.goal) || 1));
	const revivePts = Math.max(0, Number((revive && revive.points) || 0));
	const reviveFill = Math.min(1, revivePts / reviveGoal);
	// a streak just broke: the count flinches red for a moment as it drops, so chat sees WHY it's back at zero
	const reviveFlinch = reviveRunning && revive.resetAt && Date.now() - revive.resetAt < 900;
	const reviveTitle = String((revive && revive.title) || "QUICK REVIVE");
	const reviveRound = Number((revive && revive.round) || 0);
	const reviveRounds = Number((revive && revive.rounds) || 1);
	const reviveTitleFs = Math.max(56, Math.min(110, Math.floor((STAGE_W - 120) / (Math.max(4, reviveTitle.length) * 0.55))));
	const reviveUnit = String((revive && revive.unit) || "SUB POINTS");
	// the instruction line wraps rather than shrinking past legibility, so it only needs a floor
	const reviveSub = String((revive && revive.subtitle) || "");
	const reviveSubFs = Math.max(30, Math.min(46, Math.floor((STAGE_W - 120) / (Math.max(8, reviveSub.length) * 0.55))));
	// the clock is smaller when it shares the frame with an instruction line, so the two fit
	const reviveClockFs = reviveSub ? 150 : 200;
	const reviveResult = revivePhase === "won" ? String(revive.winText || "") : revivePhase === "lost" ? String(revive.failText || "") : "";
	const reviveResultFs = Math.max(56, Math.min(130, Math.floor((STAGE_W - 120) / (Math.max(4, reviveResult.length) * 0.55))));
	const reviveResultSound = revivePhase === "won" ? revive.winSound : revivePhase === "lost" ? revive.failSound : "";
	const reviveResultVolume = revivePhase === "won" ? Number(revive.winVolume) : revive ? Number(revive.failVolume) : 1;
	const lost = revivePhase === "lost";

	if (!token || (!active && !showBoost && !showBomb && !reviveActive))
		return <style>{TRANSPARENT_BODY_CSS}</style>;

	const transparent = cfg.bgColor === "transparent";
	const revealed = phase === "reveal";

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
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		textAlign: "center",
	};

	// a hard black edge on everything, so the overlay stays readable wherever it sits over the scene
	const outline = "2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000, 0 0 24px rgba(0,0,0,0.9)";

	// one tile on the reel. the winning tile grows and glows once the spin has stopped on it.
	const card = (id: string, key: string, isWinner: boolean) => {
		const p = byId[id];
		const src = p ? prizeImageSrc(p.image) : "";
		return (
			<div
				key={key}
				style={{
					width: CARD,
					height: CARD,
					marginRight: GAP,
					flex: "0 0 auto",
					borderRadius: 18,
					background: "rgba(0,0,0,0.55)",
					border: `4px solid ${isWinner ? cfg.titleColor : "rgba(255,255,255,0.35)"}`,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					overflow: "hidden",
					boxSizing: "border-box",
					transform: isWinner ? "scale(1.06)" : "none",
					animation: isWinner ? "mb-glow 900ms ease-in-out infinite" : undefined,
					transition: "transform 250ms ease-out, border-color 250ms linear",
				}}
			>
				{src ? (
					<img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
				) : (
					// a prize with no art still has to be something to look at, so it shows its own name
					<div style={{ color: cfg.nameColor, fontSize: 34, lineHeight: 1.1, padding: 10, textShadow: outline }}>
						{(p && p.name) || "?"}
					</div>
				)}
			</div>
		);
	};

	return (
		<div style={wrap} ref={wrapRef}>
			{transparent && <style>{TRANSPARENT_BODY_CSS}</style>}
			<style>{CSS}</style>

			{/* the spin music, keyed on the open so a back-to-back second box restarts it from the top rather
			    than carrying on mid-track. deliberately NOT looped: it's a stinger the length of one open, and
			    looping it would leave the tail of the last spin playing under the reveal.
			    gated on `active` as well as the setting: a bonfire sale or a timebomb keeps this page on
			    screen with no box open, and without that guard a source reconnecting (or a scene switching
			    back) during one would mount this element fresh and blast the stinger over nothing. */}
			{cfg.music && active && (
				<audio
					key={`m${nonce}`}
					src={`/media/${encodeURIComponent(cfg.music)}`}
					autoPlay
					ref={(el) => { if (el) el.volume = cfg.volume; }}
				/>
			)}

			{/* a sale's own music, looped for exactly as long as it runs. keyed on when the sale STARTED, not
			    on when it ends, so a second sale extending the first carries on playing instead of jumping
			    back to the top of the track — and a source that joins halfway simply comes in mid-loop,
			    which is what a loop is for. */}
			{showBoost && boost.sound && (
				<audio
					key={`b${boost.startedAt}`}
					src={`/media/${encodeURIComponent(boost.sound)}`}
					autoPlay
					loop
					ref={(el) => { if (el) el.volume = boost.volume; }}
				/>
			)}

			{/* the same for a timebomb: looped for as long as the freeze holds, keyed on when the freeze began
			    so every contribution that pushes the deadline out extends the music rather than restarting it */}
			{showBomb && bomb.sound && (
				<audio
					key={`tb${bomb.startedAt}`}
					src={`/media/${encodeURIComponent(bomb.sound)}`}
					autoPlay
					loop
					ref={(el) => { if (el) el.volume = bomb.volume; }}
				/>
			)}

			{/* the challenge's music, looped for exactly as long as the clock runs and keyed on the run so a second
			    start begins it from the top. it stops the moment the run is decided — the result has its own sound
			    and the two would fight. */}
			{reviveRunning && revive.music && (
				<audio
					key={`qr${reviveNonce}`}
					src={`/media/${encodeURIComponent(revive.music)}`}
					autoPlay
					loop
					ref={(el) => { if (el) el.volume = Number(revive.musicVolume); }}
				/>
			)}

			{/* the win or the fail sound, once, as it's decided */}
			{reviveCue && reviveResultSound && (
				<audio
					key={`qrr${reviveCue}`}
					src={`/media/${encodeURIComponent(reviveResultSound)}`}
					autoPlay
					ref={(el) => { if (el) el.volume = Number(reviveResultVolume); }}
				/>
			)}

			{/* the prize's own sound, once, as the reel stops on it */}
			{prize && prize.sound && landCue && active && (
				<audio
					key={`p${landCue}`}
					src={`/media/${encodeURIComponent(prize.sound)}`}
					autoPlay
					ref={(el) => { if (el) el.volume = prize.volume; }}
				/>
			)}

			<div style={stage}>
				{showBomb && (
					<div
						style={bombBig ? {
							// the middle of the frame, which it can have to itself: an open is refused while a
							// freeze is running, so the only time a reel shares the screen with this is the few
							// seconds of the reveal that started it — and that's what the other branch is for.
							position: "absolute",
							inset: 0,
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							zIndex: 5,
						} : {
							// the prize is still being revealed underneath, so stay out of its way
							position: "absolute",
							top: showBoost ? saleH : 0,
							left: 0,
							right: 0,
							padding: "10px 0 14px",
							background: "linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 100%)",
							zIndex: 5,
						}}
					>
						<div style={{ animation: "mb-rock 700ms ease-in-out infinite" }}>
							<div
								style={{
									animation: "mb-flash 420ms steps(1, end) infinite",
									color: cfg.titleColor,
									fontSize: bombFs,
									lineHeight: 0.95,
									letterSpacing: "0.03em",
									WebkitTextStrokeWidth: bombBig ? "6px" : "4px",
									WebkitTextStrokeColor: "#000",
									paintOrder: "stroke fill",
									textShadow: "0 0 44px rgba(120,220,255,0.95), 0 8px 0 rgba(0,0,0,0.55)",
								}}
							>
								{bomb.reason}
							</div>
						</div>
						<div
							style={{
								color: cfg.nameColor,
								fontSize: bombBig ? 44 : 30,
								letterSpacing: "0.12em",
								marginTop: bombBig ? 4 : 0,
								textShadow: outline,
							}}
						>
							TIMER FROZEN
						</div>
						{/* whole seconds. the tenths were a number nobody could read off a moving screen anyway,
						    and they made the one thing chat is watching look busy rather than urgent. */}
						<div
							style={{
								color: bombLeft <= 5000 ? cfg.titleColor : cfg.nameColor,
								fontSize: bombBig ? 190 : 56,
								lineHeight: 0.9,
								WebkitTextStrokeWidth: bombBig ? "7px" : "4px",
								WebkitTextStrokeColor: "#000",
								paintOrder: "stroke fill",
								textShadow: "0 0 50px rgba(120,220,255,0.9), 0 10px 0 rgba(0,0,0,0.5)",
								animation: bombLeft <= 5000
									? "mb-panic 380ms ease-in-out infinite"
									: "mb-beat 1000ms ease-in-out infinite",
							}}
						>
							{bombSecs}
						</div>
					</div>
				)}

				{showBoost && (
					<div
						style={{
							position: "absolute",
							top: 0,
							left: 0,
							right: 0,
							padding: saleBig ? "26px 0 30px" : "10px 0 14px",
							background: "linear-gradient(180deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0) 100%)",
							zIndex: 5,
						}}
					>
						{/* two rhythms, deliberately out of step: a slow rock on the outside and a fast flash on
						    the type itself. that mismatch is most of why the firesale reads as loud rather than
						    as a caption, and this is the same trick at the same speeds. */}
						<div style={{ animation: "mb-rock 700ms ease-in-out infinite" }}>
							<div
								style={{
									animation: "mb-flash 420ms steps(1, end) infinite",
									color: cfg.titleColor,
									fontSize: saleFs,
									lineHeight: 0.95,
									letterSpacing: "0.03em",
									WebkitTextStrokeWidth: saleBig ? "6px" : "4px",
									WebkitTextStrokeColor: "#000",
									paintOrder: "stroke fill",
									textShadow: "0 0 40px rgba(255,140,0,0.9), 0 8px 0 rgba(0,0,0,0.55)",
								}}
							>
								{boost.reason}
							</div>
						</div>
						<div
							style={{
								color: cfg.nameColor,
								fontSize: saleSubFs,
								lineHeight: 1.1,
								marginTop: saleBig ? 6 : 2,
								textShadow: outline,
							}}
						>
							EVERYTHING IS WORTH{" "}
							<span
								style={{
									color: cfg.titleColor,
									fontSize: Math.round(saleSubFs * 1.5),
									WebkitTextStrokeWidth: "3px",
									WebkitTextStrokeColor: "#000",
									paintOrder: "stroke fill",
									textShadow: "0 0 26px rgba(255,140,0,0.95)",
								}}
							>
								x{boost.factor}
							</span>{" "}
							— {countdown(boostLeft)}
						</div>
					</div>
				)}

				{/* over the reel, not instead of it: a chant prize starts its clock the moment the reel lands, so
				    for the few seconds of the reveal this sits on top of the prize that started it — with a
				    backdrop, so the strip underneath doesn't fight the numbers */}
				{reviveActive && (
					<div
						style={{
							position: "absolute",
							inset: 0,
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							background: active ? "rgba(0,0,0,0.72)" : undefined,
							zIndex: 6,
						}}
					>
						<div
							style={{
								color: cfg.titleColor,
								fontSize: reviveTitleFs,
								lineHeight: 1,
								letterSpacing: "0.04em",
								WebkitTextStrokeWidth: "5px",
								WebkitTextStrokeColor: "#000",
								paintOrder: "stroke fill",
								textShadow: "0 0 40px rgba(255,212,0,0.8), 0 6px 0 rgba(0,0,0,0.55)",
								animation: reviveRunning ? "mb-bob 1200ms ease-in-out infinite" : undefined,
							}}
						>
							{reviveTitle}
						</div>
						{/* the instruction, popped in afresh each round (keyed on the round) so a new chant announces
						    itself rather than quietly swapping the words */}
						{revive.subtitle && (
							<div
								key={`sub${reviveNonce}-${reviveRound}`}
								style={{
									color: cfg.nameColor,
									fontSize: reviveSubFs,
									lineHeight: 1.1,
									marginTop: 8,
									padding: "0 40px",
									letterSpacing: "0.04em",
									textShadow: outline,
									animation: reviveRunning ? "mb-pop 420ms ease-out both" : undefined,
								}}
							>
								{reviveRounds > 1 && (
									<span style={{ color: cfg.titleColor, WebkitTextStrokeWidth: "2px", WebkitTextStrokeColor: "#000", paintOrder: "stroke fill", marginRight: 18 }}>
										ROUND {Math.max(1, reviveRound)}/{reviveRounds}
									</span>
								)}
								{revive.subtitle}
							</div>
						)}

						{reviveRunning ? (<>
							{/* the clock is the whole game, so it gets the middle of the frame and the panic beat
							    under five seconds, exactly as the timebomb's does */}
							<div
								style={{
									color: reviveLeft <= 5000 ? "#ff4b4b" : cfg.nameColor,
									fontSize: reviveClockFs,
									lineHeight: 0.9,
									marginTop: 10,
									WebkitTextStrokeWidth: "7px",
									WebkitTextStrokeColor: "#000",
									paintOrder: "stroke fill",
									textShadow: "0 0 50px rgba(255,212,0,0.7), 0 10px 0 rgba(0,0,0,0.5)",
									animation: reviveLeft <= 5000
										? "mb-panic 380ms ease-in-out infinite"
										: "mb-beat 1000ms ease-in-out infinite",
								}}
							>
								{reviveSecs}
							</div>
							<div style={{ color: cfg.nameColor, fontSize: 64, lineHeight: 1, marginTop: 18, textShadow: outline }}>
								<span
									style={{
										display: "inline-block",
										color: reviveFlinch ? "#ff4b4b" : cfg.titleColor,
										WebkitTextStrokeWidth: "3px",
										WebkitTextStrokeColor: "#000",
										paintOrder: "stroke fill",
										animation: reviveFlinch ? "mb-panic 300ms ease-in-out 2" : undefined,
									}}
								>
									{revivePts}
								</span>
								{" / "}{reviveGoal}
							</div>
							<div style={{ color: cfg.nameColor, fontSize: 34, letterSpacing: "0.14em", marginTop: 2, textShadow: outline }}>
								{reviveUnit}
							</div>
							{/* how far along they are, at a glance — what chat reads from across the room */}
							<div
								style={{
									width: 700,
									height: 34,
									marginTop: 18,
									borderRadius: 17,
									border: "4px solid #000",
									background: "rgba(0,0,0,0.6)",
									overflow: "hidden",
									boxSizing: "border-box",
								}}
							>
								<div
									style={{
										width: `${Math.round(reviveFill * 100)}%`,
										height: "100%",
										background: cfg.titleColor,
										boxShadow: "0 0 24px rgba(255,212,0,0.9)",
										transition: "width 300ms ease-out",
									}}
								/>
							</div>
						</>) : (<>
							<div style={{ animation: "mb-pop 420ms ease-out both", marginTop: 20 }}>
								<div
									style={{
										color: lost ? "#ff4b4b" : cfg.titleColor,
										fontSize: reviveResultFs,
										lineHeight: 1,
										WebkitTextStrokeWidth: "5px",
										WebkitTextStrokeColor: "#000",
										paintOrder: "stroke fill",
										textShadow: lost
											? "0 0 50px rgba(255,60,60,0.9), 0 8px 0 rgba(0,0,0,0.55)"
											: "0 0 50px rgba(255,212,0,0.9), 0 8px 0 rgba(0,0,0,0.55)",
										animation: lost ? "mb-pulse 900ms ease-in-out infinite" : "mb-glow 900ms ease-in-out infinite",
										borderRadius: 24,
										padding: "6px 30px",
									}}
								>
									{reviveResult || (lost ? "FAILED" : "REVIVED!")}
								</div>
							</div>
							<div style={{ color: cfg.nameColor, fontSize: 44, marginTop: 22, textShadow: outline }}>
								{revivePts} / {reviveGoal} {reviveUnit}
							</div>
						</>)}
					</div>
				)}

				{active && (<>
				<div
					style={{
						color: cfg.titleColor,
						fontSize: 86,
						lineHeight: 1,
						letterSpacing: "0.04em",
						WebkitTextStrokeWidth: "5px",
						WebkitTextStrokeColor: "#000",
						paintOrder: "stroke fill",
						textShadow: "0 0 40px rgba(255,212,0,0.8), 0 6px 0 rgba(0,0,0,0.55)",
						animation: revealed ? undefined : "mb-bob 1200ms ease-in-out infinite",
					}}
				>
					MYSTERY BOX
				</div>
				<div style={{ color: cfg.nameColor, fontSize: 40, marginBottom: 18, textShadow: outline }}>
					{state.opener}
				</div>

				{/* the reel. a fixed window with the strip sliding under it, and a marker over the middle:
				    with padding either side the strip no longer ends on the winner, so the centre is where
				    the result is and nothing else says so. */}
				<div
					style={{
						position: "relative",
						width: STAGE_W - 60,
						height: CARD + 20,
						overflow: "hidden",
						maskImage: "linear-gradient(90deg, transparent 0, #000 12%, #000 88%, transparent 100%)",
						WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 12%, #000 88%, transparent 100%)",
					}}
				>
					{/* the stop line: two ticks, top and bottom, drawn OVER the tiles. they're taller than the
					    gap the strip leaves, so behind them the last third of each arrow was clipped by the
					    card it was pointing at — and clipped hardest at the reveal, when the winning tile
					    grows. in front they point AT the prize and stay whole, which is the job. the drop
					    shadow is what keeps them legible over the art they now overlap. */}
					{[0, 1].map((edge) => (
						<div
							key={edge}
							style={{
								position: "absolute",
								left: "50%",
								[edge ? "bottom" : "top"]: 0,
								width: 0,
								height: 0,
								marginLeft: -14,
								borderLeft: "14px solid transparent",
								borderRight: "14px solid transparent",
								[edge ? "borderBottom" : "borderTop"]: `18px solid ${cfg.titleColor}`,
								filter: "drop-shadow(0 0 4px rgba(0,0,0,0.9))",
								zIndex: 3,
							}}
						/>
					))}

					<div
						ref={stripRef}
						style={{
							position: "absolute",
							top: 10,
							// the strip's origin is the centre of the window, so a translate of -pos*STEP puts
							// tile `pos` under the marker
							left: (STAGE_W - 60) / 2 - CARD / 2,
							display: "flex",
							willChange: "transform",
							zIndex: 1,
						}}
					>
						{reel.map((id, i) => card(id, `${id}-${i}`, revealed && i === landIndex))}
					</div>
				</div>

				{/* the prize, once it's landed. the reel stays on screen underneath it — seeing what it stopped
				    on is the whole payoff, so nothing covers it. */}
				<div style={{ height: 150, display: "flex", flexDirection: "column", justifyContent: "center" }}>
					{revealed && prize && (
						<div style={{ animation: "mb-pop 420ms ease-out both" }}>
							<div
								style={{
									color: cfg.titleColor,
									fontSize: 72,
									lineHeight: 1,
									WebkitTextStrokeWidth: "4px",
									WebkitTextStrokeColor: "#000",
									paintOrder: "stroke fill",
								}}
							>
								{prize.name || "???"}
							</div>
							{prize.blurb && (
								<div style={{ color: cfg.nameColor, fontSize: 40, marginTop: 6, textShadow: outline }}>
									{prize.blurb}
								</div>
							)}
						</div>
					)}
				</div>
				</>)}
			</div>

			{/* every prize's art, fetched once and never drawn: the first spin of a session would otherwise be
			    the browser loading images one tile at a time as they scroll into view */}
			<div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0 }}>
				{prizes.map((p) => (p.image ? <img key={p.id} src={prizeImageSrc(p.image)} alt="" /> : null))}
			</div>
		</div>
	);
};

export default MysteryBox;
