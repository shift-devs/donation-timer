import fs from "fs";

// appends dev diagnostics (raw platform payloads, field probes) to a persistent file in the backend dir.
// bind-mounted to the host in dev (back/diagnostics.log) and git-excluded. also echoed to stdout as a backup.
// rotates at DIAG_MAX so the file can't grow without bound over a weeks-long run.
const DIAG_FILE = "diagnostics.log";
const DIAG_MAX = 5 * 1024 * 1024; // 5MB, then rotate to diagnostics.log.1

let diagBytes = 0;
try { diagBytes = fs.statSync(DIAG_FILE).size; } catch { diagBytes = 0; }

export function diag(line: string){
    const out = `${new Date().toISOString()} ${line}\n`;
    console.log(line);
    diagBytes += out.length;
    if (diagBytes > DIAG_MAX){
        try { fs.renameSync(DIAG_FILE, DIAG_FILE + ".1"); } catch {}
        diagBytes = out.length;
    }
    fs.appendFile(DIAG_FILE, out, (err) => {
        if (err)
            console.log("Failed to write diagnostics file:", err.message);
    });
}
