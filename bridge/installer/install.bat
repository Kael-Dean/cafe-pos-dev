@echo off
setlocal

REM -- Must run as Administrator --
net session >nul 2>&1
if not errorlevel 1 goto admin_ok
echo.
echo [X] Please Run as administrator
echo     Right-click install.bat and choose "Run as administrator"
echo.
pause
exit /b 1
:admin_ok

set SVC=CafePosBridge
set DST=%ProgramData%\cafe-pos-bridge
set SRC=%~dp0

echo ============================================
echo   Cafe POS Print Bridge - Installer
echo ============================================
echo.

echo [1/4] Copying files to %DST%
if not exist "%DST%" mkdir "%DST%"
copy /Y "%SRC%bridge.exe"  "%DST%\bridge.exe"  >nul
copy /Y "%SRC%server.mjs"  "%DST%\server.mjs"  >nul
copy /Y "%SRC%nssm.exe"    "%DST%\nssm.exe"    >nul

echo [2/4] Removing old service (if any)
"%DST%\nssm.exe" stop %SVC% >nul 2>&1
"%DST%\nssm.exe" remove %SVC% confirm >nul 2>&1

echo [3/4] Installing service "%SVC%"
"%DST%\nssm.exe" install %SVC% "%DST%\bridge.exe" "%DST%\server.mjs" >nul
"%DST%\nssm.exe" set %SVC% AppDirectory "%DST%" >nul
"%DST%\nssm.exe" set %SVC% Start SERVICE_AUTO_START >nul
"%DST%\nssm.exe" set %SVC% Description "Cafe POS print bridge - forwards browser print jobs to LAN printer" >nul
"%DST%\nssm.exe" set %SVC% AppStdout "%DST%\bridge.log" >nul
"%DST%\nssm.exe" set %SVC% AppStderr "%DST%\bridge.log" >nul
"%DST%\nssm.exe" set %SVC% AppRotateFiles 1 >nul
"%DST%\nssm.exe" set %SVC% AppRotateBytes 1048576 >nul
"%DST%\nssm.exe" set %SVC% AppRestartDelay 3000 >nul

echo [4/4] Starting service
"%DST%\nssm.exe" start %SVC% >nul
timeout /t 3 /nobreak >nul

echo.
echo Testing connection...
curl -s http://127.0.0.1:8080/status
echo.
echo.
echo ============================================
echo   Installation complete!
echo ============================================
echo.
echo Open your browser at:
echo   https://cafe-pos-sable.vercel.app
echo.
echo The bridge will auto-discover your printer on the LAN
echo (first scan may take 10-30 seconds).
echo.
echo Log file: %DST%\bridge.log
echo Manage service: services.msc (service name: %SVC%)
echo Uninstall: run uninstall.bat
echo.
pause
