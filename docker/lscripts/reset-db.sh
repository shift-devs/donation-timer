#!/bin/bash
# wipe the local dev database (drops the pgdata volume) — start fresh next `docker compose up`
shdir=$(dirname "$0")
docker compose -f "$shdir/../dev.yml" down --rmi all -v
read -rsp $'Press any key to continue...\n' -n 1