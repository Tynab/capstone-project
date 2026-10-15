@echo off
REM XOA TOAN BO 2 VM va du lieu MongoDB ben trong. Khong the hoan tac.
echo CANH BAO: lenh nay xoa ca 2 VM (capstone-manager, capstone-worker)
echo va toan bo du lieu MongoDB nam trong do. Khong the hoan tac.
echo.
echo Neu can giu du lieu, xem muc "Sao luu" trong infra/README.md truoc.
set /p ok=Go "yes" de tiep tuc:
if /i not "%ok%"=="yes" (
  echo Da huy.
  pause
  exit /b 1
)
pushd "%~dp0"
vagrant destroy -f
popd
pause
