@echo off
REM ============================================================
REM  Update the CafePosBridge Windows service to the new
REM  USB-capable bridge (AiYin AN581-C, 58mm, image-rendered Thai).
REM
REM  >>> RIGHT-CLICK this file and choose "Run as administrator" <<<
REM      (service control + writing to ProgramData need admin)
REM ============================================================
setlocal
set "DST=%ProgramData%\cafe-pos-bridge"
set "NSSM=%DST%\nssm.exe"
set "SRC=d:\POS-dev"

echo.
echo [1/4] Stopping CafePosBridge service...
"%NSSM%" stop CafePosBridge

echo [2/4] Copying new server.mjs...
copy /Y "%SRC%\bridge\server.mjs" "%DST%\server.mjs"

echo [3/4] Copying printer config (USB / AN581-C)...
copy /Y "%SRC%\app\printer-config.json" "%DST%\printer-config.json"

echo [4/4] Starting CafePosBridge service...
"%NSSM%" start CafePosBridge

echo.
echo Done. The bridge now prints to the USB printer "AN581-C".
echo You can close this window.
echo.
pause
