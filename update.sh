#!/bin/bash
# Update for the podman + systemd setup (the `donationtimer` user unit running docker/dev.yml).
# Stops the stack, pulls, and starts it again — migrations and npm install run on startup.
# For the docker setup use docker/lscripts/patch.sh (live) or update.sh (full teardown) instead.
cd "$(dirname "$0")"

echo "Stopping donationtimer..."
systemctl --user stop donationtimer

echo "Pulling latest code..."
if ! git pull --ff-only; then
    # bring the timer back up on the old code rather than leaving it down, but say so loudly
    systemctl --user start donationtimer
    echo ""
    echo "!! git pull FAILED — the stack was restarted on the OLD code."
    echo "!! Fix the pull (usually uncommitted local changes: try 'git status' / 'git stash') and rerun."
    exit 1
fi

echo "Installing/refreshing the watchdog..."
if ! ./systemd/install-watchdog.sh; then
    echo "!! watchdog install failed — the stack will still start, but auto-restart may be stale"
fi

echo "Starting donationtimer..."
systemctl --user start donationtimer

echo ""
echo "Deployed: $(git log --oneline -1)"
echo "Containers (may take a minute to finish npm install on first boot):"
podman ps --format "{{.Names}}\t{{.Status}}"
