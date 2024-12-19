@echo off
plink -P 30022 127.0.0.1 -l arch -pw arch podman container logs donation-timer_dev-back_1 ^| tee ~/donation-timer-back-log.txt && ^
plink -P 30022 127.0.0.1 -l arch -pw arch podman container logs donation-timer_dev-front_1 ^| tee ~/donation-timer-front-log.txt && ^
pscp -l arch -pw arch -P 30022 127.0.0.1:/home/arch/donation-timer-back-log.txt ./donation-timer-back-log.txt && ^
pscp -l arch -pw arch -P 30022 127.0.0.1:/home/arch/donation-timer-front-log.txt ./donation-timer-front-log.txt
pause