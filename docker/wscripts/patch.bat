@echo off
REM Live update: pulls and rebuilds while the old containers keep serving,
REM then swaps only the services whose image changed (seconds of downtime).
REM Volumes are untouched, so the timer keeps its end time.

cd "%~dp0/../../"
git pull
docker compose -f docker/pro.yml up -d --build
pause
