#!/bin/bash
shdir=$(dirname "$0")
docker compose -f "$shdir/../pro.yml" down
read -rsp $'Press any key to continue...\n' -n 1