@echo off
title ยกเลิก Auto-start POS

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
del "%STARTUP%\POS System.vbs" > nul 2>&1

echo ยกเลิก Auto-start สำเร็จ
echo POS จะไม่เปิดอัตโนมัติอีกต่อไป
echo.
pause
