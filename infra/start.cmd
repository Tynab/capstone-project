@echo off
REM Wrapper: bat lai 2 VM da dung (khong cai dat, khong provision).
REM Noi dung that nam trong start.ps1 (cmd.exe khong render duoc tieng Viet co dau).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
echo (exit code %EXITCODE%)
pause
exit /b %EXITCODE%
