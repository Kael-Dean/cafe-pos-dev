@echo off
chcp 65001 >nul
setlocal

REM ── ต้องรันด้วยสิทธิ์ Administrator ─────────────────────────
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo [X] ต้อง Run as administrator
    echo     คลิกขวาที่ install.bat แล้วเลือก "Run as administrator"
    echo.
    pause
    exit /b 1
)

set SVC=CafePosBridge
set DST=%ProgramData%\cafe-pos-bridge
set SRC=%~dp0

echo ============================================
echo   Cafe POS Print Bridge - Installer
echo ============================================
echo.

echo [1/4] คัดลอกไฟล์ไปยัง %DST%
if not exist "%DST%" mkdir "%DST%"
copy /Y "%SRC%bridge.exe"  "%DST%\bridge.exe"  >nul
copy /Y "%SRC%server.mjs"  "%DST%\server.mjs"  >nul
copy /Y "%SRC%nssm.exe"    "%DST%\nssm.exe"    >nul

echo [2/4] ลบ service เก่า (ถ้ามี)
"%DST%\nssm.exe" stop %SVC% >nul 2>&1
"%DST%\nssm.exe" remove %SVC% confirm >nul 2>&1

echo [3/4] ติดตั้ง service "%SVC%"
"%DST%\nssm.exe" install %SVC% "%DST%\bridge.exe" "%DST%\server.mjs" >nul
"%DST%\nssm.exe" set %SVC% AppDirectory "%DST%" >nul
"%DST%\nssm.exe" set %SVC% Start SERVICE_AUTO_START >nul
"%DST%\nssm.exe" set %SVC% Description "Cafe POS print bridge - forwards browser print jobs to LAN printer" >nul
"%DST%\nssm.exe" set %SVC% AppStdout "%DST%\bridge.log" >nul
"%DST%\nssm.exe" set %SVC% AppStderr "%DST%\bridge.log" >nul
"%DST%\nssm.exe" set %SVC% AppRotateFiles 1 >nul
"%DST%\nssm.exe" set %SVC% AppRotateBytes 1048576 >nul
"%DST%\nssm.exe" set %SVC% AppRestartDelay 3000 >nul

echo [4/4] เปิด service
"%DST%\nssm.exe" start %SVC% >nul
timeout /t 3 /nobreak >nul

echo.
echo ทดสอบการเชื่อมต่อ...
curl -s http://127.0.0.1:8080/status
echo.
echo.
echo ============================================
echo   ติดตั้งสำเร็จ!
echo ============================================
echo.
echo เปิด browser ไปที่:
echo   https://cafe-pos-sable.vercel.app
echo.
echo Bridge จะหาเครื่องปริ้นในเครือข่ายเอง
echo (อาจใช้เวลาสแกน 10-30 วินาทีตอนเริ่มต้น)
echo.
echo Log file: %DST%\bridge.log
echo จัดการ service: services.msc (ชื่อ %SVC%)
echo ลบทิ้ง: รัน uninstall.bat
echo.
pause
