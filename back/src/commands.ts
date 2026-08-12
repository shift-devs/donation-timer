import { TimerEvent } from "./types";

// the command taxonomy mirrors the Time Per Action rate keys, one entry per triggerable unit.
// grammar: "<platform> <action> [qty]"  |  "time <seconds>"  |  "help"
type Kind = "sub" | "bits" | "money" | "member";
const SPEC: { [platform: string]: { [action: string]: Kind } } = {
    twitch: { sub_t1: "sub", sub_t2: "sub", sub_t3: "sub", bits: "bits" },
    streamlabs: { donation: "money", merch: "money" },
    youtube: {
        superchat: "money", supersticker: "money",
        membership_enjoyer: "member", membership_full: "member", membership_quickster: "member",
        membership_gift_enjoyer: "member", membership_gift_full: "member", membership_gift_quickster: "member",
    },
    fourthwall: { order: "money", donation: "money", membership: "member" },
    kick: { subscription: "member", gift: "member" },
};

// text-box commands don't grant time at all — they set the words on a /text browser source — but they ride this
// same parser so chat and the terminal keep one grammar and one place that decides what a command means.
const TEXT_VERBS = ["changetext", "settext"];

// twitch chat lowercases and strips non-ascii before parsing, which is right for "<platform> <action> <qty>" and
// wrong for prose a mod typed — the adapter asks this first so it knows to take a text command off the raw line.
export function isTextCommand(text: string): boolean {
    return TEXT_VERBS.includes((text || "").trim().split(/\s+/)[0].toLowerCase());
}

// pull one argument off the front: a "quoted phrase" if it opens with a quote, else the next word.
function takeArg(s: string): { arg: string, rest: string } {
    const t = s.trimStart();
    if (t.startsWith('"')){
        const end = t.indexOf('"', 1);
        if (end !== -1)
            return { arg: t.slice(1, end).trim(), rest: t.slice(end + 1).trimStart() };
    }
    const sp = t.search(/\s/);
    if (sp === -1)
        return { arg: t, rest: "" };
    return { arg: t.slice(0, sp), rest: t.slice(sp + 1).trimStart() };
}

// the text itself is the whole rest of the line, so quotes around it are optional — they only matter when it
// has leading/trailing spaces worth keeping
function unquote(s: string): string {
    const t = s.trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

export function commandHelp(): string {
    const lines = ["Commands:  <platform> <action> [qty]   |   time <seconds>   |   changetext <box> \"text\"   |   help"];
    for (const p of Object.keys(SPEC))
        lines.push(`  ${p}: ${Object.keys(SPEC[p]).join(", ")}`);
    lines.push("  qty = dollars for money, count for subs/bits/members (subs & members default to 1)");
    lines.push("  changetext puts words on a /text browser source, e.g. changetext topic \"speedruns all night\"");
    return lines.join("\n");
}

// parse a command line into a manual TimerEvent (so it shares rates + the cap with chat), a text-box change, or
// an error/help.
export function parseCommand(text: string): { event?: TimerEvent; text?: { box: string, text: string }; error?: string; help?: string } {
    const raw = (text || "").trim();
    if (!raw)
        return { error: "Empty command. Type 'help'." };
    const parts = raw.split(/\s+/);
    const head = parts[0].toLowerCase();
    const label = `Command: ${raw}`;

    if (head === "help")
        return { help: commandHelp() };

    if (TEXT_VERBS.includes(head)){
        // phone keyboards autocorrect quotes into curly ones — take those for the quotes the mod meant, rather
        // than leaving a stray “ on stream
        const { arg: box, rest } = takeArg(raw.slice(parts[0].length).replace(/[“”]/g, '"'));
        if (!box)
            return { error: `Usage: ${head} <box name> "text here"` };
        return { text: { box, text: unquote(rest) } };
    }

    if (head === "time") {
        const seconds = Number(parts[1]);
        if (!Number.isFinite(seconds))
            return { error: "Usage: time <seconds>" };
        return { event: { platform: "twitch", kind: "time", seconds, manual: true, label } };
    }

    const platform = head;
    const action = (parts[1] || "").toLowerCase();
    const spec = SPEC[platform];
    if (!spec)
        return { error: `Unknown platform "${platform}". Try: ${Object.keys(SPEC).join(", ")}, or time / help.` };
    const kind = spec[action];
    if (!kind)
        return { error: `Unknown ${platform} action "${action}". Try: ${Object.keys(spec).join(", ")}.` };

    const qtyGiven = parts[2] !== undefined;
    const qty = Number(parts[2]);

    if (kind === "sub") {
        const tier = parseInt(action.slice("sub_t".length), 10);
        const count = qtyGiven ? qty : 1;
        if (!Number.isFinite(count))
            return { error: `Usage: ${platform} ${action} [count]` };
        return { event: { platform: platform as any, kind: "sub", tier, count, manual: true, label } };
    }
    if (kind === "member") {
        const count = qtyGiven ? qty : 1;
        if (!Number.isFinite(count))
            return { error: `Usage: ${platform} ${action} [count]` };
        return { event: { platform: platform as any, kind: "member", unit: action, count, manual: true, label } };
    }
    if (kind === "bits") {
        if (!qtyGiven || !Number.isFinite(qty))
            return { error: `Usage: ${platform} bits <amount>` };
        return { event: { platform: platform as any, kind: "bits", bits: qty, manual: true, label } };
    }
    // money
    if (!qtyGiven || !Number.isFinite(qty))
        return { error: `Usage: ${platform} ${action} <dollars>` };
    return { event: { platform: platform as any, kind: "money", unit: action, usd: qty, manual: true, label } };
}
