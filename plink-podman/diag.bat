@echo off
plink -P 30022 127.0.0.1 -l arch -pwfile .pwfile -m cmdlists/diag
pscp -l arch -pwfile .pwfile -P 30022 127.0.0.1:/home/arch/donationtimer-diag-latest.txt ./donationtimer-diag-latest.txt
pause
