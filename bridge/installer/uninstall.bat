@echo off
chcp 65001 >nul
setlocal

net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo [X] ต้อง Run as administrator
    echo     คลิกขวาที่ uninstall.bat แล้วเลือก "Run as administrator"
    echo.
    pause
    exit /b 1
)

set SVC=CafePosBridge
set DST=%ProgramData%\cafe-pos-bridge

echo ============================================
echo   Cafe POS Print Bridge - Uninstaller
echo ============================================
echo.

if not exist "%DST%\nssm.exe" (
    echo ไม่พบ %DST% — อาจไม่เคยติดตั้ง
    pause
    exit /b 0
)

echo [1/3] หยุด service
"%DST%\nssm.exe" stop %SVC% >nul 2>&1

echo [2/3] ลบ service
"%DST%\nssm.exe" remove %SVC% confirm >nul 2>&1

echo [3/3] ลบไฟล์
timeout /t 2 /nobreak >nul
rmdir /S /Q "%DST%" 2>nul
if exist "%DST%" (
    echo [!] ลบไฟล์ไม่หมด อาจถูก lock อยู่ ลอง restart แล้วลบเอง
    echo     โฟลเดอร์: %DST%
) else (
    echo.
    echo ลบเรียบร้อย!
)
echo.
pause
