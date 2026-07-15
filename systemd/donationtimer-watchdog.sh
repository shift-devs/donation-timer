#!/bin/bash
# Watchdog for the podman + systemd setup: fired every minute by donationtimer-watchdog.timer.
# Probes the published app ports and restarts the `donationtimer` user unit when the app is down
# or wedged (unit "active" but nothing answering). A manual `systemctl --user stop` is respected —
# an inactive unit is never touched, only a failed one is brought back.
# Logs go to the journal: journalctl --user -u donationtimer-watchdog

UNIT=donationtimer
PORTS="3003 3080"            # backend WS + frontend; either one dead means the stack needs a kick
FAILS_BEFORE_RESTART=3       # consecutive failed probes (1/min) before restarting — rides out blips
STARTUP_GRACE_SEC=600        # after a (re)start, npm install/vite boot can take a while; don't judge yet

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/donationtimer-watchdog"
mkdir -p "$STATE_DIR"
FAIL_FILE="$STATE_DIR/consecutive-failures"

ok() { echo 0 > "$FAIL_FILE"; exit 0; }

state=$(systemctl --user is-active "$UNIT")

# crashed past its own restart limits -> clear the failure and bring it back
if [ "$state" = "failed" ]; then
    echo "$UNIT is in a failed state — starting it"
    systemctl --user reset-failed "$UNIT"
    systemctl --user start "$UNIT"
    ok
fi

# inactive = someone stopped it on purpose (stop.bat / update.sh mid-pull); activating = already starting
[ "$state" != "active" ] && ok

# inside the startup grace window the containers may still be installing/compiling — don't probe yet
started_at=$(systemctl --user show "$UNIT" -p ActiveEnterTimestamp --value)
if [ -n "$started_at" ]; then
    started=$(date -d "$started_at" +%s 2>/dev/null || echo 0)
    [ "$started" -gt 0 ] && [ $(( $(date +%s) - started )) -lt "$STARTUP_GRACE_SEC" ] && ok
fi

down=""
for port in $PORTS; do
    timeout 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" 2>/dev/null || down="$down $port"
done
[ -z "$down" ] && ok

fails=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$FAIL_FILE"
echo "port(s)$down not answering ($fails/$FAILS_BEFORE_RESTART)"

if [ "$fails" -ge "$FAILS_BEFORE_RESTART" ]; then
    echo "restarting $UNIT (port(s)$down down for $FAILS_BEFORE_RESTART checks)"
    echo 0 > "$FAIL_FILE"
    systemctl --user restart "$UNIT"
fi
