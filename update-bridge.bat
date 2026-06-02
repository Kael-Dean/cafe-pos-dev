@echo off
chcp 65001 >nul
setlocal

REM ── ต้อง Run as administrator ─────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo [X] ต้อง Run as administrator
    echo     คลิกขวาที่ update-bridge.bat แล้วเลือก "Run as administrator"
    echo.
    pause
    exit /b 1
)

set SVC=CafePosBridge
set DST=%ProgramData%\cafe-pos-bridge
set SRC=D:\POS\bridge\server.mjs

echo ============================================
echo   อัปเดต Print Bridge เป็นเวอร์ชันล่าสุด
echo ============================================
echo.

echo [1/3] คัดลอก server.mjs เวอร์ชันใหม่...
copy /Y "%SRC%" "%DST%\server.mjs" >nul
if errorlevel 1 (
    echo [X] copy ไม่สำเร็จ - ตรวจสอบว่ามีไฟล์ %SRC%
    pause
    exit /b 1
)

echo [2/3] restart service "%SVC%"...
"%DST%\nssm.exe" restart %SVC%
timeout /t 4 /nobreak >nul

echo [3/3] ทดสอบการเชื่อมต่อ...
curl -s http://127.0.0.1:8080/status
echo.
echo.
echo ============================================
echo   อัปเดตสำเร็จ! ลองพิมพ์ใบเสร็จใหม่ได้เลย
echo   (VAT จะหายไป + ขึ้นชื่อร้าน/เบอร์โทร)
echo ============================================
echo.
pause
