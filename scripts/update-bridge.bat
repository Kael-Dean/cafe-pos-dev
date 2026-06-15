@echo off
setlocal

REM -- Must run as Administrator (service restart needs it) --
net session >nul 2>&1
if not errorlevel 1 goto admin_ok
echo.
echo [X] Please Run as administrator
echo     Right-click update-bridge.bat and choose "Run as administrator"
echo.
pause
exit /b 1
:admin_ok

echo ============================================
echo   Update Cafe POS Print Bridge
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POS\bridge\update-bridge.ps1"
set RC=%errorlevel%

echo.
if "%RC%"=="0" (
  echo ============================================
  echo   Done. Print a new receipt to verify.
  echo   ^(customer name shows, VAT lines removed^)
  echo ============================================
) else (
  echo [X] Update failed ^(exit %RC%^). See messages above.
)
echo.
pause
