// mod-editable text boxes. a box is one /text browser source: the dashboard sets how it looks, mods set what it
// says with "!changetext <box> <text>" in chat (the same command works in the dashboard terminal), and a source
// picks its box off ?box= in the url.
// the words are LIVE state, not config: setTextBoxes (the dashboard's structure/appearance save) never carries
// them, so an operator nudging a font size can't put back the text a mod replaced a second ago.
// stored per-user as an array (mirrors eventLayers); this file owns validating untrusted client input.

import { TimerUserSession } from "./types";

const MAX_BOXES = 50;         // bound the array so a bad client can't blow up the json column
const MAX_NAME = 100;
export const MAX_TEXT = 500;  // one line of on-stream text, not an essay
const MAX_FONT_SIZE = 400;
const MAX_EFFECT_WIDTH = 20;  // px; past this the outline swallows the glyphs (mirrors textEffect.ts)

const FONTS = ["sans", "display", "mono"];
const ALIGNS = ["left", "center", "right"];
const VALIGNS = ["top", "middle", "bottom"];
const EFFECTS = ["none", "stroke", "shadow"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const TRANSPARENT = "transparent";

// a new box is white text centred on nothing, which composites over a scene with no color key at all
export const DEFAULT_TEXT_BOX = {
    name: "",
    text: "",
    font: "sans",
    fontSize: 64,
    color: "#ffffff",
    bgColor: TRANSPARENT,
    align: "center",
    valign: "middle",
    bold: false,
    effect: "none",
    effectColor: "#000000",
    effectWidth: 4,
};

// `extra` lets one non-hex keyword through, e.g. the fill's "transparent"
function hexOr(v: any, fallback: string, extra?: string): string {
    const s = typeof v === "string" ? v.trim() : "";
    if (extra && s === extra)
        return s;
    return HEX.test(s) ? s : fallback;
}

function numIn(v: any, min: number, max: number, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function normalizeOne(raw: any, i: number): any | null {
    if (!raw || typeof raw !== "object")
        return null;
    const d = DEFAULT_TEXT_BOX;
    return {
        id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 100) : `b${i + 1}`,
        // what mods type after !changetext. blank is allowed (the box is still addressable by id) but useless,
        // so the dashboard names every box it creates.
        name: typeof raw.name === "string" ? raw.name.slice(0, MAX_NAME).trim() : "",
        text: typeof raw.text === "string" ? raw.text.slice(0, MAX_TEXT) : "",
        font: FONTS.includes(raw.font) ? raw.font : d.font,
        fontSize: numIn(raw.fontSize, 8, MAX_FONT_SIZE, d.fontSize),
        color: hexOr(raw.color, d.color),
        bgColor: hexOr(raw.bgColor, d.bgColor, TRANSPARENT),
        align: ALIGNS.includes(raw.align) ? raw.align : d.align,
        valign: VALIGNS.includes(raw.valign) ? raw.valign : d.valign,
        bold: !!raw.bold,
        effect: EFFECTS.includes(raw.effect) ? raw.effect : d.effect,
        effectColor: hexOr(raw.effectColor, d.effectColor),
        effectWidth: numIn(raw.effectWidth, 0, MAX_EFFECT_WIDTH, d.effectWidth),
    };
}

export function normalizeTextBoxes(raw: any): any[] {
    if (!Array.isArray(raw))
        return [];
    const out: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length && out.length < MAX_BOXES; i++){
        const box = normalizeOne(raw[i], i);
        if (!box)
            continue;
        if (seen.has(box.id)) // ids must be unique: a source url names one, and duplicates would fight over it
            box.id = `${box.id}_${i}`;
        seen.add(box.id);
        out.push(box);
    }
    return out;
}

// the dashboard's appearance save. an existing box keeps the words already on stream: the client's copy of the
// array is as old as its last sync, so honouring the text it sends back would undo whatever a mod typed in
// between. new boxes have no previous text to keep, so theirs stands (the dashboard creates them blank).
export function mergeTextBoxes(prev: any, raw: any): any[] {
    const boxes = normalizeTextBoxes(raw);
    const prevText: { [id: string]: string } = {};
    for (const b of (Array.isArray(prev) ? prev : []))
        if (b && typeof b.id === "string")
            prevText[b.id] = typeof b.text === "string" ? b.text : "";
    for (const b of boxes)
        if (b.id in prevText)
            b.text = prevText[b.id];
    return boxes;
}

// mods type a name, not an id — match on that first (case- and space-insensitive), then fall back to the id so
// a source url (which carries the id) resolves through here too.
export function findTextBox(session: TimerUserSession, key: any): any | null {
    const boxes = Array.isArray(session.textBoxes) ? session.textBoxes : [];
    const want = String(key || "").trim();
    if (!want)
        return null;
    const lower = want.toLowerCase();
    return boxes.find((b: any) => String(b.name || "").trim().toLowerCase() === lower)
        || boxes.find((b: any) => String(b.id) === want)
        || null;
}

// the one place text changes. returns a line for whoever asked (terminal reply / chat feedback) — a mod
// mistyping a box name has to be able to see that nothing happened.
export function setTextBoxText(session: TimerUserSession, key: any, text: any): { ok: boolean, message: string } {
    const boxes = Array.isArray(session.textBoxes) ? session.textBoxes : [];
    const want = String(key || "").trim();
    if (!boxes.length)
        return { ok: false, message: `No text boxes exist yet — add one on the Text Boxes tab.` };
    const box = findTextBox(session, want);
    if (!box)
        return { ok: false, message: `No text box called "${want}". Try: ${boxes.map((b: any) => b.name || b.id).join(", ")}.` };
    box.text = String(text == null ? "" : text).slice(0, MAX_TEXT);
    const label = box.name || box.id;
    return { ok: true, message: box.text ? `${label} = "${box.text}"` : `${label} cleared` };
}
