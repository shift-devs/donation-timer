# Investigating a Crash — Runbook

How to investigate when the timer goes down, written from the July 2026 stability work.
The single most important rule: **capture evidence before restarting anything.** A reboot
"fixes" the symptom and destroys most of the crime scene. Ten minutes of looking first is
the difference between a diagnosis and another mystery.

## The deployment, in layers

Any of these can be "the crash" — work out which layer died before fixing anything:

```
Windows host machine
└─ VirtualBox VM "timerhost" (Arch Linux, bridged adapter, 192.168.1.254, Tailscale 100.127.109.80)
   └─ systemd user units (user: arch, lingering enabled)
      ├─ donationtimer.service         — runs podman-compose -f dev.yml up --force-recreate
      └─ donationtimer-watchdog.timer  — probes ports 3003/3080 every minute, restarts the unit
   └─ rootless podman containers
      ├─ donation-timer_dev-front_1    — Vite dev server, published on :3080
      ├─ donation-timer_dev-back_1     — node backend + websocket, published on :3003
      └─ donation-timer_postgres_1     — database (timer end time lives here, volume pgdata)
```

Watchdog behavior worth remembering while diagnosing:
- It **never starts an `inactive` unit** (that state means someone stopped it on purpose —
  including "the unit was never enabled and the VM rebooted").
- It gives a fresh start a **10-minute grace window** (`npm install` runs on every boot).
- It needs **3 consecutive failed port probes** (≈3 min) before restarting.

## First five minutes — find the dead layer

Work top-down; each step that *succeeds* rules a layer out.

1. **`ping 192.168.1.254` from the host.**
   - Replies → VM and network are alive; skip to step 3.
   - No reply → network or VM problem; step 2.
2. **Open the VirtualBox console window** (bypasses networking entirely) and log in:
   - Console frozen / OOM messages on screen → **resource exhaustion**; note what it says,
     then check `free -h` if it responds at all.
   - Console fine, `ip addr` shows **no IP on eth0** → DHCP failure: is `dhcpcd` running?
     (`systemctl status dhcpcd`)
   - Console fine, has an IP, but `ping 8.8.8.8` fails → LAN/adapter problem (bridged NIC
     binding in VirtualBox settings, router, AP isolation).
   - Console fine, has a **different IP** than expected → DHCP handed out a new address
     (fix permanently with a router reservation for MAC `08:00:27:88:51:b6`).
3. **`ssh arch@192.168.1.254`**, then check the stack:
   ```bash
   systemctl --user status donationtimer     # active / inactive / failed — read the last log lines
   podman ps -a                              # all three containers? restarting? exited with a code?
   ```
   - Unit `inactive` → nothing will ever restart it (see watchdog note above).
     Before starting it, ask why: `journalctl --user -u donationtimer -e` shows whether it
     was stopped or died. Check `systemctl --user is-enabled donationtimer`.
   - Unit `active` but app dead → the wedged-stack case; container logs (below) are the story.
   - A container missing/cycling in `podman ps -a` → `podman logs --tail 100 <name>`.
4. **Run the evidence collector** (read-only, safe any time — do it even if things look obvious):
   ```bash
   cd ~/donation-timer && ./systemd/collect-diagnostics.sh
   ```
   It writes `~/donationtimer-diag-latest.txt` with: unit definition, linger/session state,
   network config and DHCP state, OOM traces across boots, daily system timers, container
   restart/OOM counts, reboot history, and the last 3 days of unit + watchdog journals —
   including the **previous boot's final log lines** if the VM was already restarted.
   From Windows, `plink-podman/diag.bat` runs it remotely and copies the file back.

## Reading the evidence — what points at what

| Observation | Points at |
|---|---|
| SSH dead but VirtualBox console healthy with IP, no outbound ping | Hypervisor NAT wedge (if on NAT) or LAN/bridge issue |
| Console healthy, eth0 has no IP | DHCP client not running / lease not renewed |
| `journalctl -k` style OOM lines, container `oom=true` in diag output | Memory: check `mem_limit` took effect, VM RAM size |
| Unit `failed`, watchdog journal shows restart attempts | App-level crash — read `podman logs` for the backend |
| Unit `inactive` after a VM reboot | Unit not enabled: `systemctl --user enable donationtimer` |
| Ports dead, unit `active`, containers "Up", watchdog silent | Watchdog broken (is the timer active? script executable?) |
| Everything healthy but browsers can't connect | Client-side: wrong IP (lease changed?), stale browser JS (use incognito), or OBS URLs pointing at an old address |

## Lessons already paid for (don't re-learn these)

- **Container env is locked at creation, not start.** Editing `docker/.env` does nothing
  until containers are *recreated* (`podman-compose -f docker/dev.yml down` — **never with
  `-v`**, that wipes the database — then start the unit). `--force-recreate` in the unit
  covers this on normal restarts, but images are a separate matter: env/config baked into
  an image survives recreation and needs a rebuild (`podman rmi` the image, then start).
- **The websocket URL cannot be misconfigured anymore** (as of `6d87e3f` it is always
  same-origin `/ws`) — if browsers show websocket failures, look at server/network layers,
  not config.
- **Scripts can lose their exec bit** when committed from Windows checkouts — if a systemd
  unit or the watchdog "does nothing", check `ls -l` before anything else (fixed once in
  `68f080c` via `git update-index --chmod=+x`).
- **`git pull` on the VM only helps running code via the mounted `front/`/`back/` volumes.**
  Compose file or Dockerfile changes need the unit stopped/started (recreation); dependency
  changes need the `npm install` boot cycle to finish (watch for the backend's
  `Connection has been established successfully to the database!` line).
- **The previous boot's journal is gold** — `journalctl -b -1 -e` shows what the machine
  logged right before a restart "fixed" it. Requires persistent journald (see
  FUTURE_IMPROVEMENTS.md item 8) — confirm it's enabled before the next incident, not after.

## Open history (as of 2026-07-15)

The original failure — stack dead roughly every 24h **and SSH dead with it**, VM restart
curing both — occurred under VirtualBox **NAT** and was never conclusively diagnosed; the
leading suspect was the NAT engine wedging under connection churn (the app previously opened
a fresh TLS connection to Fourthwall every 5s; fixed with keep-alive in `b935232`). The VM
has since moved to a **bridged adapter**, which removes that suspect entirely. If a daily
death recurs on the bridged setup, the NAT theory is dead — prioritize the OOM and DHCP
rows above, and grab the diagnostics dump before rebooting.

## After recovery — close the loop

1. Save the diag file with the incident date: `cp ~/donationtimer-diag-latest.txt ~/diag-$(date +%F).txt`
2. Note what layer failed and what actually fixed it (not just "rebooted it").
3. If the fix was a restart with no diagnosis, schedule the console-check for next time —
   an undiagnosed crash always comes back.
