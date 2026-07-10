#!/bin/bash
# Live update: pulls and rebuilds while the old containers keep serving,
# then swaps only the services whose image changed (seconds of downtime).
# Volumes are untouched, so the timer keeps its end time.
shdir=$(dirname "$0")
cd "$shdir/../../"
git pull
docker compose -f docker/pro.yml up -d --build
read -rsp $'Press any key to continue...\n' -n 1
