@echo off

docker compose -f "%~dp0/../dev.yml" down
pause