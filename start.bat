@echo off
title POS System - ร้านตะวันอ้อมข้าว
cd /d D:\POS\app
echo.
echo ============================================
echo   กำลังเริ่มระบบ POS...
echo   เปิดเบราว์เซอร์แล้วไปที่ http://localhost:3000
echo   กด Ctrl+C เพื่อปิดระบบ
echo ============================================
echo.
start "" "http://localhost:3000"
pnpm dev
pause
