@echo off
REM Wrapper: chay cloudflare-jsd.ps1 voi ExecutionPolicy phu hop, khong can go tay.
REM Noi dung that nam trong cloudflare-jsd.ps1 (cmd.exe khong render duoc tieng Viet co dau).
REM Vi du: cloudflare-jsd.cmd                          (chi DOC trang thai bot_management cua zone)
REM        cloudflare-jsd.cmd -Apply                     (tat enable_js = JavaScript Detections)
REM        cloudflare-jsd.cmd -ZoneId 023e4... -Apply    (khi token khong co quyen Zone:Read)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare-jsd.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
echo (exit code %EXITCODE%)
pause
exit /b %EXITCODE%
