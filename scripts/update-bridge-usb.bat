@echo off
REM ============================================================
REM  Update the CafePosBridge Windows service to the current
REM  bridge (USB AiYin AN581-C / LAN Epson, image-rendered Thai,
REM  origin allowlist + mandatory shop token).
REM
REM  >>> RIGHT-CLICK this file and choose "Run as administrator" <<<
REM      (service control + writing to ProgramData need admin)
REM
REM  The bridge refuses every request until a shop token exists in
REM  %ProgramData%\cafe-pos-bridge\bridge-token.txt. It must equal
REM  the BRIDGE_TOKEN env var of the web app on Vercel. Printer
REM  settings (USB/LAN, printer name, store header) already live in
REM  %ProgramData%\cafe-pos-bridge\printer-config.json and are kept.
REM ============================================================
setlocal
set "DST=%ProgramData%\cafe-pos-bridge"
set "NSSM=%DST%\nssm.exe"
set "SRC=d:\POS-dev"

echo.
echo [1/4] Checking shop token...
if exist "%DST%\bridge-token.txt" goto token_ok
if exist "%SRC%\bridge\bridge-token.txt" (
  copy /Y "%SRC%\bridge\bridge-token.txt" "%DST%\bridge-token.txt" >nul
  goto token_ok
)
echo.
echo [X] No shop token found. Nothing was changed.
echo     Create %DST%\bridge-token.txt containing the same value as
echo     BRIDGE_TOKEN on Vercel, then run this file again.
echo.
pause
exit /b 1
:token_ok

echo [2/4] Stopping CafePosBridge service...
"%NSSM%" stop CafePosBridge

echo [3/4] Copying new server.mjs...
copy /Y "%SRC%\bridge\server.mjs" "%DST%\server.mjs"

echo [4/4] Starting CafePosBridge service...
"%NSSM%" start CafePosBridge

echo.
echo Done. Open the POS in the browser on this PC and print a test receipt.
echo You can close this window.
echo.
pause
