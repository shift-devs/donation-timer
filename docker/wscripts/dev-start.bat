@echo off

if not exist "%~dp0/../.env" copy "%~dp0/../.env_template" "%~dp0/../.env"
docker compose --env-file "%~dp0/../.env" -f "%~dp0/../dev.yml" up --build %*
