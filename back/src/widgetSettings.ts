// per-user widget appearance, synced to /widget clients. this file owns validating untrusted client input.
export const DEFAULT_WIDGET_SETTINGS = { bgColor: "#00FF00" }; // chroma green

const HEX = /^#[0-9a-fA-F]{6}$/;

export function normalizeWidgetSettings(raw: any): { bgColor: string } {
    const bgColor = raw && typeof raw.bgColor === "string" && HEX.test(raw.bgColor)
        ? raw.bgColor
        : DEFAULT_WIDGET_SETTINGS.bgColor;
    return { bgColor };
}
