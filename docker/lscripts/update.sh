#!/bin/bash
shdir=$(dirname "$0")
docker compose -f "$shdir/../dev.yml" down --rmi all
docker compose -f "$shdir/../pro.yml" down --rmi all
cd "$shdir/../../"
git pull
read -rsp $'Press any key to continue...\n' -n 1