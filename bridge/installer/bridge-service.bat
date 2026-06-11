@echo off
REM ==========================================================================
REM  Cafe POS Print Bridge - (re)install the Windows service via NSSM.
REM  Called by the Inno Setup installer AFTER files are copied into the
REM  service directory. ASCII only - Thai text + chcp breaks cmd parsing on
REM  shop PCs (same rule as update-bridge.ps1). All errors are swallowed so
REM  the installer never aborts on a re-run.
REM
REM  Arg 1 = install / service directory.
REM          Defaults to %ProgramData%\cafe-pos-bridge when not supplied.
REM ==========================================================================
setlocal
set "DST=%~1"
if "%DST%"=="" set "DST=%ProgramData%\cafe-pos-bridge"
set "SVC=CafePosBridge"
set "NSSM=%DST%\nssm.exe"

REM -- remove any previous instance (ignore errors when none exists) --
"%NSSM%" stop   %SVC%         >nul 2>&1
"%NSSM%" remove %SVC% confirm >nul 2>&1

REM -- install + configure --
"%NSSM%" install %SVC% "%DST%\bridge.exe" "%DST%\server.mjs"            >nul 2>&1
"%NSSM%" set %SVC% AppDirectory     "%DST%"                             >nul 2>&1
"%NSSM%" set %SVC% Start            SERVICE_AUTO_START                  >nul 2>&1
"%NSSM%" set %SVC% Description      "Cafe POS print bridge - forwards browser print jobs to the receipt printer" >nul 2>&1
"%NSSM%" set %SVC% AppStdout        "%DST%\bridge.log"                  >nul 2>&1
"%NSSM%" set %SVC% AppStderr        "%DST%\bridge.log"                  >nul 2>&1
"%NSSM%" set %SVC% AppRotateFiles   1                                   >nul 2>&1
"%NSSM%" set %SVC% AppRotateBytes   1048576                             >nul 2>&1
"%NSSM%" set %SVC% AppRestartDelay  3000                                >nul 2>&1

REM -- start it now (no reboot needed) --
"%NSSM%" start %SVC% >nul 2>&1

exit /b 0
