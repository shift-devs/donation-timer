import { extendTheme, ColorModeProviderProps } from "@chakra-ui/react";

type StorageManager = NonNullable<ColorModeProviderProps["colorModeManager"]>;

// the dashboard is dark; the OBS browser sources are not touched by this at all.
//
// chakra's colour mode is global — it paints the body and sets every component's defaults — so it can't
// simply be "dark" everywhere: a browser source that leans on an inherited text colour would change on
// stream. so the mode is decided by the URL the page was opened at, once, and never stored. the overlay
// routes keep the light mode they've always had (they paint their own transparent/chroma fill over it);
// everything else — the dashboard and the login — is dark. a stored mode would also leak between the two
// whenever somebody previews an overlay in the same browser as the dashboard.
const OVERLAY_PATHS = [
	"/widget", "/events", "/fwalert", "/fwactivity", "/subcount", "/subprogress", "/fwprogress",
	"/text", "/firesale", "/mysterybox", "/raffle", "/boxboard",
];

function isOverlay(): boolean {
	const path = typeof window !== "undefined" ? window.location.pathname.replace(/\/+$/, "") : "";
	return OVERLAY_PATHS.includes(path);
}

export const colorModeManager: StorageManager = {
	type: "localStorage",
	get: () => (isOverlay() ? "light" : "dark"),
	set: () => {}, // never persisted: see above
};

// the dashboard's text and panel colours, by what they're FOR rather than which grey they happen to be, so
// the same prop reads right in both modes. the light values are what the code hard-coded before, so an
// overlay or anything else still in light mode looks exactly as it did.
export const theme = extendTheme({
	config: {
		initialColorMode: isOverlay() ? "light" : "dark",
		useSystemColorMode: false,
	},
	styles: {
		// a native <select>'s open list is drawn by the OS, and on windows it keeps a white background while
		// inheriting dark mode's white text — every dropdown on the dashboard would open blank
		global: (props: { colorMode: string }) => (props.colorMode === "dark"
			? { "select option, select optgroup": { background: "#2D3748", color: "#F7FAFC" } }
			: {}),
	},
	semanticTokens: {
		colors: {
			muted: { _light: "gray.600", _dark: "gray.300" },   // secondary text: labels, explanations
			subtle: { _light: "gray.500", _dark: "gray.400" },  // tertiary text: hints, small print
			faint: { _light: "gray.400", _dark: "gray.500" },   // placeholder-ish text
			panel: { _light: "gray.50", _dark: "whiteAlpha.100" }, // a slightly raised box (art wells, off cards)
			surface: { _light: "white", _dark: "gray.800" },    // opaque page colour, for sticky bars over content
			line: { _light: "gray.200", _dark: "whiteAlpha.300" },
			danger: { _light: "red.600", _dark: "red.300" },
			warn: { _light: "orange.500", _dark: "orange.300" },
			dangerBg: { _light: "red.50", _dark: "rgba(254, 178, 178, 0.12)" },
			dangerLine: { _light: "red.200", _dark: "red.700" },
		},
	},
});
