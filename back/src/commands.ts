import { TimerEvent } from "./types";

// the command taxonomy mirrors the Time Per Action rate keys, one entry per triggerable unit.
// grammar: "<platform> <action> [qty]"  |  "time <seconds>"  |  "help"
type Kind = "sub" | "bits" | "money" | "member";
const SPEC: { [platform: string]: { [action: string]: Kind } } = {
    twitch: { sub_t1: "sub", sub_t2: "sub", sub_t3: "sub", bits: "bits" },
    streamlabs: { donation: "money", merch: "money" },
    youtube: { superchat: "money", supersticker: "money", membership: "member", membership_gift: "member" },
    fourthwall: { order: "money", donation: "money", membership: "member" },
    kick: { subscription: "member", gift: "member" },
};

export function commandHelp(): string {
    const lines = ["Commands:  <platform> <action> [qty]   |   time <seconds>   |   help"];
    for (const p of Object.keys(SPEC))
        lines.push(`  ${p}: ${Object.keys(SPEC[p]).join(", ")}`);
    lines.push("  qty = dollars for money, count for subs/bits/members (subs & members default to 1)");
    return lines.join("\n");
}

// parse a command line into a manual TimerEvent (so it shares rates + the cap with chat), or return an error/help.
export function parseCommand(text: string): { event?: TimerEvent; error?: string; help?: string } {
    const raw = (text || "").trim();
    if (!raw)
        return { error: "Empty command. Type 'help'." };
    const parts = raw.split(/\s+/);
    const head = parts[0].toLowerCase();
    const label = `Command: ${raw}`;

    if (head === "help")
        return { help: commandHelp() };

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
