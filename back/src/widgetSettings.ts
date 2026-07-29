// per-user widget appearance, synced to /widget clients. this file owns validating untrusted client input.
// align drives the timer's justification on both the /widget source and the dashboard's own timer, so the
// two always look the same. left matches what /widget has always rendered.
// alertBgColor is the /fwalert purchase-alert source's fill, kept separate from the timer's bgColor so the
// two browser sources can be keyed on different colors. it also accepts "transparent", which lets obs
// composite the alert straight over the scene with no color key at all.
export const DEFAULT_WIDGET_SETTINGS = { bgColor: "#00FF00", align: "left", alertBgColor: "#00FF00" }; // chroma green

const HEX = /^#[0-9a-fA-F]{6}$/;
const ALIGNS = ["left", "center", "right"];
const TRANSPARENT = "transparent";

export function normalizeWidgetSettings(raw: any): { bgColor: string, align: string, alertBgColor: string } {
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
    return { bgColor, align, alertBgColor };
}
