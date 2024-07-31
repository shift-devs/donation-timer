@echo off

docker compose -f "%~dp0/../pro.yml" down
pause