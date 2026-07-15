#!/bin/bash
# Read-only diagnostics for the podman + systemd deployment. Run it on the VM as the deploy user
# and send back the output file it names — it changes nothing, so it's always safe to run:
#   cd ~/donation-timer && git pull && ./systemd/collect-diagnostics.sh
# Built to answer "why does the stack die daily and stay down": it captures the unit definition,
# linger/session state, OOM traces, daily system timers, and the journals around recent deaths.

OUT="$HOME/donationtimer-diag-$(date +%Y%m%d-%H%M%S).txt"
exec > >(tee "$OUT") 2>&1

section() { echo; echo "===== $1 ====="; }

section "BASICS"
date -Is
uptime
uname -a
echo "user: $(id)"
echo "XDG_RUNTIME_DIR: ${XDG_RUNTIME_DIR:-<unset>}"
ls -ld "/run/user/$(id -u)" 2>&1

section "MEMORY / DISK"
free -h
df -h / /home 2>/dev/null
swapon --show

section "LINGER / SESSION (user units die with the session unless Linger=yes)"
loginctl show-user "$USER" -p Linger -p State 2>&1
loginctl list-sessions 2>&1

section "UNIT DEFINITION (donationtimer is hand-made on the VM — this is our only view of it)"
systemctl --user cat donationtimer 2>&1
systemctl --user show donationtimer -p Type -p Restart -p RemainAfterExit -p ExecStart \
    -p ActiveState -p SubState -p Result -p NRestarts \
    -p ActiveEnterTimestamp -p InactiveEnterTimestamp 2>&1

section "UNIT STATUS"
systemctl --user --no-pager -l status donationtimer 2>&1
systemctl --user --no-pager -l status donationtimer-watchdog.timer 2>&1
systemctl --user is-enabled donationtimer-watchdog.timer 2>&1

section "USER TIMERS"
systemctl --user list-timers --all --no-pager 2>&1

section "SYSTEM DAILY TIMERS (something firing every 24h is the prime suspect)"
systemctl list-timers --all --no-pager 2>&1

section "CONTAINERS"
podman ps -a 2>&1
for c in $(podman ps -aq 2>/dev/null); do
    podman inspect "$c" --format 'name={{.Name}} restarts={{.RestartCount}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}} finished={{.State.FinishedAt}} started={{.State.StartedAt}}' 2>&1
done
echo "-- rootless plumbing processes (pasta/slirp4netns/conmon should be alive) --"
pgrep -a -u "$USER" 'pasta|slirp4netns|conmon|podman' 2>&1

section "PODMAN TEMP/RUN DIRS (tmpfiles-clean nuking these kills rootless containers)"
podman info --format 'runRoot={{.Store.RunRoot}} tmpDir={{.Host.OS}}' 2>/dev/null
podman info 2>/dev/null | grep -iE 'runroot|tmpdir|graphroot'
ls -ld /tmp/podman-run-* /tmp/containers-user-* 2>/dev/null

section "NETWORK CONFIG (SSH dies with the app -> guest-wide network loss is a suspect)"
ip addr 2>&1
ip route 2>&1
echo "-- who manages the network? nothing enabled = DHCP lease silently expires ~24h after boot --"
systemctl list-unit-files --no-pager 2>/dev/null | grep -iE 'dhcpcd|networkd|NetworkManager|connman|iwd|netctl'
networkctl status --no-pager 2>/dev/null
resolvectl status --no-pager 2>/dev/null | head -15
echo "-- socket pressure (a guest-side leak shows up here long before things die) --"
ss -s 2>&1
cat /proc/sys/net/netfilter/nf_conntrack_count /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null

section "REBOOTS (did the VM itself go down?)"
journalctl --list-boots --no-pager 2>&1 | tail -10

section "OOM / KERNEL KILLS (all boots — journalctl -k alone only covers the current boot)"
journalctl _TRANSPORT=kernel --no-pager --since "7 days ago" 2>/dev/null | grep -iE 'out of memory|oom|killed process' | tail -40
echo "(empty = no OOM kills in the kernel log for 7 days, or no permission to read it)"

section "PREVIOUS BOOT — LAST GASP (what the VM logged right before the restart that 'fixed' it)"
journalctl -b -1 --no-pager 2>/dev/null | tail -120
echo "(empty = no previous boot in the journal, or journal not persistent — check /var/log/journal exists)"

section "PREVIOUS BOOT — NETWORK/DHCP EVENTS"
journalctl -b -1 --no-pager 2>/dev/null | grep -iE 'dhcp|lease|carrier|link (up|down)|eth0|enp|network' | tail -60

section "DONATIONTIMER JOURNAL (last 3 days, tail)"
journalctl --user -u donationtimer --no-pager --since "3 days ago" 2>&1 | tail -300

section "WATCHDOG JOURNAL (last 3 days, tail)"
journalctl --user -u donationtimer-watchdog --no-pager --since "3 days ago" 2>&1 | tail -100

section "USER MANAGER JOURNAL AROUND DEATHS (stopped/killed/failed lines, 3 days)"
journalctl --user --no-pager --since "3 days ago" 2>&1 | grep -iE 'stopp|kill|fail|oom|shut' | tail -80

echo
echo "===== DONE — send back: $OUT ====="
# fixed-name copy so remote tooling (plink-podman/diag.bat) can fetch it without knowing the timestamp
cp "$OUT" "$HOME/donationtimer-diag-latest.txt"
