#!/bin/bash
shdir=$(dirname "$0")
envfile="$shdir/../.env"
if [ ! -f "$envfile" ]; then
    cp "$shdir/../.env_template" "$envfile"
    echo "Created docker/.env from template. Edit it to set CLIENT_ID for authorized mode."
fi
docker compose --env-file "$envfile" -f "$shdir/../dev.yml" up --build "$@"
