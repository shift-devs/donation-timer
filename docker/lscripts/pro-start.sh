#!/bin/bash
shdir=$(dirname "$0")
docker compose -f "$shdir/../pro.yml" up -d
read -rsp $'Press any key to continue...\n' -n 1