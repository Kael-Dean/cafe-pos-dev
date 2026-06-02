@echo off
title POS System
cd /d D:\POS\app

if not exist "node_modules" (
    echo Installing dependencies...
    pnpm install
    echo.
)

echo Building POS (first time takes 2-3 minutes)...
pnpm build

if %errorlevel% neq 0 (
    echo Build failed. Press any key to exit.
    pause
    exit
)

echo.
echo POS ready! Open: http://localhost:3000
echo Press Ctrl+C to stop
echo.

start "" "http://localhost:3000"
pnpm start
pause
