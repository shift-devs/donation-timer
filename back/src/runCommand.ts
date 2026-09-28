// run one command line exactly the way the dashboard terminal does, from anywhere on the server. the terminal
// itself goes through here, and so does a mystery box prize that runs a command, so the two can't drift.

import { TimerUserSession } from "./types";
import { emitSync } from "./bus";
import { CHAT_CMD_MAX_TIME } from "./config";
import { parseCommand } from "./commands";
import { handle } from "./events";
import { isStoppedAtZero } from "./timer";
import { setTextBoxText } from "./textBoxes";
import { runFiresaleCommand } from "./firesale";
import { runRaffleCommand } from "./raffle";
import { runMysteryBoxCommand } from "./mysterybox";
import { runBoxBoardCommand } from "./boxBoard";
import { runDropCommand } from "./drops";

// `from` is tacked onto a time command's log label, so the audit log says where it came from
export function runCommandLine(session: TimerUserSession, text: string, from = ""): { ok: boolean, message: string } {
    const parsed = parseCommand(text);
    if (parsed.help)
        return { ok: true, message: parsed.help };
    if (parsed.text){
        // a text command changes no time, so it reports itself and skips the timer path entirely
        const res = setTextBoxText(session, parsed.text.box, parsed.text.text);
        if (res.ok)
            emitSync(session.userId); // pushes the new words to that box's browser source(s)
        return res;
    }
    // drives the giveaway overlay; grants no time, so it reports itself and stops here
    if (parsed.firesale)
        return runFiresaleCommand(session, parsed.firesale);
    if (parsed.raffle)
        return runRaffleCommand(session, parsed.raffle);
    if (parsed.board)
        return runBoxBoardCommand(session, parsed.board);
    if (parsed.drop)
        return runDropCommand(session, parsed.drop);
    if (parsed.mb){
        // the mystery box: hand out / take back boxes, open one on someone's behalf, rehearse a prize. a
        // prize's effect may well add time, but that goes through handle() itself, so there's nothing to
        // measure here.
        const res = runMysteryBoxCommand(session, parsed.mb);
        emitSync(session.userId); // the ledger may have moved
        return res;
    }
    if (parsed.error || !parsed.event)
        return { ok: false, message: parsed.error || "Invalid command." };
    if (from)
        parsed.event.label = `${parsed.event.label} (${from})`;
    const before = session.endTime;
    const wasStopped = isStoppedAtZero(session); // handle() returns early in that case
    handle(session, parsed.event); // applies rates + cap, adds time, writes the log entry
    const added = Math.round((session.endTime - before) / 1000);
    const message = added !== 0
        ? `+${added}s — ${parsed.event.label}`
        : wasStopped
            ? `no time added — the timer is at 0 and "stop at zero" is on`
            : `no time added — rate is 0 or over the ${CHAT_CMD_MAX_TIME / 3600}h command cap`;
    return { ok: added !== 0, message };
}
