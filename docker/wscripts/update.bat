@echo off

docker compose -f "%~dp0/../dev.yml" down --rmi all
docker compose -f "%~dp0/../pro.yml" down --rmi all
cd "%~dp0/../../"
git pull
pause