// per-user widget appearance, synced to /widget clients. this file owns validating untrusted client input.
// align drives the timer's justification on both the /widget source and the dashboard's own timer, so the
// two always look the same. left matches what /widget has always rendered.
// alertBgColor is the /fwalert purchase-alert source's fill, kept separate from the timer's bgColor so the
// two browser sources can be keyed on different colors. it also accepts "transparent", which lets obs
// composite the alert straight over the scene with no color key at all.
// peakHour is the highest whole hour the timer has ever shown (299 once it has read 299:xx:xx), kept here
// because every timer source already receives this blob. while the timer is back inside that hour, the digits
// pulse peakColor — if peakEnabled. it only goes up (see notePeakHour in timer.ts) or is reset by hand.
export const DEFAULT_WIDGET_SETTINGS = { bgColor: "#00FF00", align: "left", alertBgColor: "#00FF00", peakEnabled: false, peakColor: "#ff3b3b", peakHour: 0 }; // chroma green

const HEX = /^#[0-9a-fA-F]{6}$/;
const ALIGNS = ["left", "center", "right"];
const TRANSPARENT = "transparent";

export function normalizeWidgetSettings(raw: any): { bgColor: string, align: string, alertBgColor: string, peakEnabled: boolean, peakColor: string, peakHour: number } {
    const bgColor = raw && typeof raw.bgColor === "string" && HEX.test(raw.bgColor)
        ? raw.bgColor
        : DEFAULT_WIDGET_SETTINGS.bgColor;
    const align = raw && typeof raw.align === "string" && ALIGNS.includes(raw.align)
        ? raw.align
        : DEFAULT_WIDGET_SETTINGS.align;
    const alertBgColor = raw && typeof raw.alertBgColor === "string"
        && (raw.alertBgColor === TRANSPARENT || HEX.test(raw.alertBgColor))
        ? raw.alertBgColor
        : DEFAULT_WIDGET_SETTINGS.alertBgColor;
    const peakEnabled = !!(raw && raw.peakEnabled);
    const peakColor = raw && typeof raw.peakColor === "string" && HEX.test(raw.peakColor)
        ? raw.peakColor
        : DEFAULT_WIDGET_SETTINGS.peakColor;
    const ph = Number(raw && raw.peakHour);
    const peakHour = Number.isFinite(ph) ? Math.max(0, Math.min(100000, Math.trunc(ph))) : 0;
    return { bgColor, align, alertBgColor, peakEnabled, peakColor, peakHour };
}
