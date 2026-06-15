@echo off
title ติดตั้ง Auto-start POS

echo.
echo ============================================
echo   ติดตั้ง POS ให้เปิดอัตโนมัติตอนเปิดคอม
echo ============================================
echo.

:: สร้าง VBScript launcher (รัน start.bat โดยไม่มี CMD popup)
set LAUNCHER=%~dp0start-pos.vbs
echo Set WshShell = CreateObject("WScript.Shell") > "%LAUNCHER%"
echo WshShell.Run """D:\POS\start.bat""", 1, False >> "%LAUNCHER%"

:: เพิ่มเข้า Windows Startup folder
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
copy "%LAUNCHER%" "%STARTUP%\POS System.vbs" > nul

echo ติดตั้งสำเร็จ!
echo.
echo ตอนนี้ POS จะเปิดอัตโนมัติทุกครั้งที่เปิดคอม
echo.
echo ถ้าอยากยกเลิก ให้รัน remove-autostart.bat
echo.
pause
