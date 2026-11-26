@echo off
REM Wrapper: chay setup.ps1 voi ExecutionPolicy phu hop, khong can go tay.
REM Noi dung that nam trong setup.ps1 (cmd.exe khong render duoc tieng Viet co dau).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
echo (exit code %EXITCODE%)
pause
exit /b %EXITCODE%
