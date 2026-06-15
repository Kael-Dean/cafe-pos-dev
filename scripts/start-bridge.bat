@echo off
title Print Bridge - ร้านตะวันอ้อมข้าว
cd /d D:\POS

echo.
echo ============================================
echo   Print Bridge
echo ============================================
echo.

:: เริ่ม print-server.js ใน background window
start "Print Server" cmd /k "node print-server.js"

echo รอ print server เริ่ม...
timeout /t 2 /nobreak > nul

echo.
echo เริ่ม Cloudflare Tunnel...
echo URL จะแสดงด้านล่าง — copy ไปใส่ในหน้า Hardware ของเว็บ
echo.

:: รัน quick tunnel (ไม่ต้อง login)
cloudflared tunnel --url http://localhost:3456

pause
