import fs from "fs";

// appends dev diagnostics (raw platform payloads, field probes) to a persistent file in the backend dir.
// bind-mounted to the host in dev (back/diagnostics.log) and git-excluded. also echoed to stdout as a backup.
const DIAG_FILE = "diagnostics.log";

export function diag(line: string){
    console.log(line);
    fs.appendFile(DIAG_FILE, `${new Date().toISOString()} ${line}\n`, (err) => {
        if (err)
            console.log("Failed to write diagnostics file:", err.message);
    });
}
