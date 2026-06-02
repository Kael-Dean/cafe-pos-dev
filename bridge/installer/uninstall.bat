@echo off
setlocal

REM -- Must run as Administrator --
net session >nul 2>&1
if not errorlevel 1 goto admin_ok
echo.
echo [X] Please Run as administrator
echo     Right-click uninstall.bat and choose "Run as administrator"
echo.
pause
exit /b 1
:admin_ok

set SVC=CafePosBridge
set DST=%ProgramData%\cafe-pos-bridge

echo ============================================
echo   Cafe POS Print Bridge - Uninstaller
echo ============================================
echo.

if exist "%DST%\nssm.exe" goto do_remove
echo Not found at %DST% - probably never installed
pause
exit /b 0
:do_remove

echo [1/3] Stopping service
"%DST%\nssm.exe" stop %SVC% >nul 2>&1

echo [2/3] Removing service
"%DST%\nssm.exe" remove %SVC% confirm >nul 2>&1

echo [3/3] Deleting files
timeout /t 2 /nobreak >nul
rmdir /S /Q "%DST%" 2>nul
if not exist "%DST%" goto done_ok
echo [!] Some files could not be deleted (locked).
echo     Restart the PC and delete this folder manually: %DST%
goto end
:done_ok
echo.
echo Removed successfully!
:end
echo.
pause
