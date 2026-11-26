@echo off
REM Wrapper: chay destroy.ps1 voi ExecutionPolicy phu hop, khong can go tay.
REM Noi dung that nam trong destroy.ps1 (cmd.exe khong render duoc tieng Viet co dau).
REM Vi du: destroy.cmd -DryRun        (chi in ra viec se lam, khong chay lenh that)
REM        destroy.cmd -Mode state    (giu VM, don ben trong)
REM        destroy.cmd -Mode full -PurgeRepoFiles
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0destroy.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
echo (exit code %EXITCODE%)
pause
exit /b %EXITCODE%
