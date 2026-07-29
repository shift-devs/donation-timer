import React, { useEffect, useRef, useState } from "react";
import * as consts from "../Consts";
import { TRANSPARENT_BODY_CSS } from "../textEffect";

// OBS browser source for fourthwall purchase alerts (SHIFT slide-in template). the page is a solid
// #00FF00 fill for chroma keying; the backend pushes {fwAlert} messages for real orders and for
// dashboard-simulated ones (thumbnail clicks), and alerts queue so back-to-back purchases all play.
// mirrors EventSource.tsx's connect/reconnect lifecycle.

const WS_URL = consts.WS_URL;
let ws: WebSocket;
let reconnectTimer: any;

const SHOW_MS = 6000; // on-screen time before the slide-out (the template's original 6s delay)
const EXIT_MS = 600;  // slide-out animation duration + small buffer

interface AlertItem {
	name: string;
	message: string;
	image: string;
	sound: string; // bare filename under /fwsounds/, "" = silent
	volume: number; // 0..1
	banner: string; // bare filename under /banners/, "" = the template's purple panel
	shadow: boolean; // draw a drop shadow behind the name so it reads over a busy banner
	nonce: number;
	leaving?: boolean;
}

// template css, adapted for this page:
// - font falls back when 'Normative Pro' isn't installed on the obs machine
// - .alertShift gets its own stacking context (position:relative;z-index:0) so .secondBox's
//   z-index:-100 layers inside the alert instead of vanishing behind the green fill
// - .firstBox is position:relative so the logo anchors to its box, not the viewport
// - the original's 6s animation-delay + undefined slide-out class are replaced by js timing
const CSS = `
${TRANSPARENT_BODY_CSS}
.alertShift {
  color: white;
  font-family: 'Normative Pro', 'Arial Black', Arial, sans-serif;
  position: relative;
  z-index: 0;
}
.firstBox {
  background-color: #0b0b0b;
  height: 125px;
  width: 125px;
  float: left;
  position: relative;
}
.logo {
  position: absolute;
  top: 25px;
  left: 22px;
  height: 71px;
  width: 88px;
}
.tagsystem1 {
  float: left;
  animation-delay: .3s !important;
}
.tag1 {
  background-color: white;
  width: 7px;
  height: 125px;
  float: left;
}
.imagetag {
  padding-top: 54px;
  float: left;
}
.secondBox {
  background-color: #624381;
  height: 125px;
  display: inline-block;
  margin-left: 0px;
  float: left;
  position: relative;
  z-index: -100;
}
.entryBox2 {
  animation-delay: .6s !important;
}
.tagsystem2 {
  float: left;
  animation-delay: .9s !important;
}
.innerBox {
  background-color: #131313;
  height: 40px;
  display: inline-block;
  text-transform: uppercase;
  font-size: 16px;
  font-weight: 500;
  margin-right: 55px;
}
#alert-message {
  font-size: 16px !important;
  font-weight: 500 !important;
  text-transform: uppercase !important;
  color: white;
}
.nameShift {
  font-size: 200%;
  font-weight: 900;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 31px 25px;
}
/* opt-in per product: a tight dark outline plus a soft drop, so the white name survives a busy banner */
.nameShadow {
  text-shadow:
    0 0 2px rgba(0,0,0,.95),
    0 0 4px rgba(0,0,0,.9),
    0 0 8px rgba(0,0,0,.7),
    2px 2px 5px rgba(0,0,0,.85);
}
.messageTextBoy {
  padding: 14px 35px 20px 35px;
}
.tag2 {
  background-color: #0b0b0b;
}
.wholeBox {
  white-space: nowrap;
}
#alert-image {
  float: left;
}
#alert-image img {
  max-height: 125px;
}
.slide-in-leftSHIFT { animation: slide-in-leftSHIFT .5s cubic-bezier(.25,.46,.45,.94) both; }
.slide-out-leftSHIFT { animation: slide-out-leftSHIFT .5s cubic-bezier(.55,.085,.68,.53) both; }
@keyframes slide-out-leftSHIFT { 0% { transform: translateX(0); opacity: 1; } 100% { transform: translateX(-1000px); opacity: 0; } }
@keyframes slide-in-leftSHIFT { 0% { transform: translateX(-50px); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
`;

const FwAlert: React.FC = () => {
	const token = new URLSearchParams(window.location.search).get("token");
	const [alert, setAlert] = useState<AlertItem | null>(null);
	const [bgColor, setBgColor] = useState("#00FF00"); // chroma green until the sync says otherwise
	const queueRef = useRef<AlertItem[]>([]);
	const busyRef = useRef(false);
	const nonceRef = useRef(0);

	const advance = () => {
		const next = queueRef.current.shift();
		if (!next) {
			busyRef.current = false;
			setAlert(null);
			return;
		}
		busyRef.current = true;
		setAlert(next);
		window.setTimeout(() => {
			// flip to the slide-out; guard on nonce so a late timer can't touch a newer alert
			setAlert((a) => (a && a.nonce === next.nonce ? { ...a, leaving: true } : a));
			window.setTimeout(advance, EXIT_MS);
		}, SHOW_MS);
	};

	const connectWs = () => {
		// tear down any prior socket so handlers/reconnects can't stack
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
			try { ws.close(); } catch {}
		}
		ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || "")}&page=fwalert`);

		ws.onmessage = (event: any) => {
			const response = JSON.parse(event.data);
			// the sync payload is otherwise ignored here — only the alert fill is read off it
			if (response.widgetSettings && typeof response.widgetSettings.alertBgColor === "string")
				setBgColor(response.widgetSettings.alertBgColor);
			if ("fwAlert" in response && response.fwAlert) {
				const a = response.fwAlert;
				nonceRef.current += 1;
				queueRef.current.push({
					name: typeof a.name === "string" && a.name ? a.name : "Someone",
					message: typeof a.message === "string" && a.message ? a.message : "made a purchase",
					image: typeof a.image === "string" ? a.image : "",
					sound: typeof a.sound === "string" ? a.sound : "",
					volume: typeof a.volume === "number" ? Math.min(1, Math.max(0, a.volume)) : 1,
					banner: typeof a.banner === "string" ? a.banner : "",
					shadow: a.shadow === true,
					nonce: nonceRef.current,
				});
				// a purchase flood queues faster than alerts drain (one every SHOW+EXIT ms) — during a
				// big rush, showing the 50 most recent beats replaying hours of backlog on stream
				if (queueRef.current.length > 50)
					queueRef.current.splice(0, queueRef.current.length - 50);
				if (!busyRef.current) advance();
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

	// full-viewport chroma key fill (color set in the dashboard's Settings tab; #00FF00 default) — OBS keys
	// it out with a color key filter so only the alert shows
	const wrap: React.CSSProperties = {
		position: "fixed",
		inset: 0,
		margin: 0,
		background: bgColor,
		overflow: "hidden",
		padding: "24px",
	};

	// a chosen banner covers the template's purple panel; no banner leaves the purple as-is
	const bannerStyle: React.CSSProperties = alert && alert.banner
		? {
			backgroundImage: `url("/banners/${encodeURIComponent(alert.banner)}")`,
			backgroundSize: "cover",
			backgroundPosition: "center",
			backgroundRepeat: "no-repeat",
		}
		: {};

	return (
		<div style={wrap}>
			<style>{CSS}</style>
			{token && alert && (
				<div key={alert.nonce} className={`alertShift ${alert.leaving ? "slide-out-leftSHIFT" : ""}`}>
					{alert.sound && (
						<audio
							src={`/fwsounds/${encodeURIComponent(alert.sound)}`}
							autoPlay
							ref={(el) => { if (el) el.volume = alert.volume; }}
						/>
					)}
					{/* FIRST BOX */}
					<div className='entryBox slide-in-leftSHIFT'>
						<div className='firstBox exitBox'>
							<img className='logo' src='http://livespace.se/clients/shift/logo-white.png' />
						</div>
					</div>
					<div className='tagsystem1 slide-in-leftSHIFT'>
						<div className='tag1'></div>
						<img className='imagetag' src='http://livespace.se/clients/shift/white-tag.png' />
					</div>
					{/* END FIRST BOX */}
					{alert.image && (
						<div id='alert-image' className='slide-in-leftSHIFT'>
							<img src={alert.image} />
						</div>
					)}
					<div className='wholeBox'>
						{/* SECOND BOX */}
						<div className='entryBox2 slide-in-leftSHIFT'>
							<div className='secondBox exitBox2' style={bannerStyle}>
								<div className='innerBox'>
									<div id='alert-message' className='messageTextBoy'>{alert.message}</div>
								</div>
								<div className={`nameShift ${alert.shadow ? "nameShadow" : ""}`}>{alert.name}</div>
							</div>
						</div>
						<div className='tagsystem2 slide-in-leftSHIFT'>
							<div className='tag1 tag2'></div>
							<img className='imagetag' src='http://livespace.se/clients/shift/black-tag.png' />
						</div>
						{/* END SECOND BOX */}
						{/* THIRD BOX (amount) — kept disabled, as in the original template */}
					</div>
				</div>
			)}
		</div>
	);
};

export default FwAlert;
