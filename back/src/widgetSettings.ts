// per-user widget appearance, synced to /widget clients. this file owns validating untrusted client input.
// align drives the timer's justification on both the /widget source and the dashboard's own timer, so the
// two always look the same. left matches what /widget has always rendered.
export const DEFAULT_WIDGET_SETTINGS = { bgColor: "#00FF00", align: "left" }; // chroma green

const HEX = /^#[0-9a-fA-F]{6}$/;
const ALIGNS = ["left", "center", "right"];

export function normalizeWidgetSettings(raw: any): { bgColor: string, align: string } {
    const bgColor = raw && typeof raw.bgColor === "string" && HEX.test(raw.bgColor)
        ? raw.bgColor
        : DEFAULT_WIDGET_SETTINGS.bgColor;
    const align = raw && typeof raw.align === "string" && ALIGNS.includes(raw.align)
        ? raw.align
        : DEFAULT_WIDGET_SETTINGS.align;
    return { bgColor, align };
}
