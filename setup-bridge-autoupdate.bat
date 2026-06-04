@echo off
setlocal

REM -- Must run as Administrator (registers a SYSTEM task + restarts service) --
net session >nul 2>&1
if not errorlevel 1 goto admin_ok
echo.
echo [X] Please Run as administrator
echo     Right-click setup-bridge-autoupdate.bat and choose "Run as administrator"
echo.
pause
exit /b 1
:admin_ok

set TASK=CafePosBridgeAutoUpdate
set PS1=D:\POS\bridge\update-bridge.ps1

echo ============================================
echo   Enable auto-update for the Print Bridge
echo ============================================
echo.
echo This registers a task that, every 15 minutes, copies the latest
echo bridge\server.mjs into the service and restarts it only when it
echo changed. After this, deploys reach the printer with no manual step.
echo.

echo [1/2] Registering scheduled task "%TASK%" (runs as SYSTEM)...
schtasks /Create /TN "%TASK%" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"%PS1%\"" /SC MINUTE /MO 15 /RL HIGHEST /RU SYSTEM /F
if errorlevel 1 (
  echo [X] Could not register the task.
  pause
  exit /b 1
)

echo [2/2] Applying the current version now...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"

echo.
echo ============================================
echo   Auto-update enabled.
echo   Disable later with:  schtasks /Delete /TN "%TASK%" /F
echo ============================================
echo.
pause
