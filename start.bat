@echo off
title POS System - ร้านตะวันอ้อมข้าว
cd /d D:\POS\app

echo.
echo ============================================
echo   ระบบ POS - ร้านตะวันอ้อมข้าว
echo ============================================
echo.

:: ติดตั้ง dependencies ถ้ายังไม่มี node_modules
if not exist "node_modules" (
    echo กำลังติดตั้งระบบครั้งแรก กรุณารอสักครู่...
    pnpm install
    echo.
)

echo กำลังเริ่มระบบ...
echo iPad เปิดเว็บที่: http://[IP ของเครื่องนี้]:3000
echo กด Ctrl+C เพื่อปิดระบบ
echo.

start "" "http://localhost:3000"
pnpm dev
pause
