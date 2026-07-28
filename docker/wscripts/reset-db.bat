@echo off
REM wipe the local dev database (drops the pgdata volume) — start fresh next `docker compose up`

docker compose -f "%~dp0/../dev.yml" down --rmi all -v
pause