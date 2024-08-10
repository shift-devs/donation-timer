@echo off

docker compose -f "%~dp0/../dev.yml" down --rmi all -v
docker compose -f "%~dp0/../pro.yml" down --rmi all -v
pause