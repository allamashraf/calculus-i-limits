@echo off
title LIMITS - keep this window open while presenting
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install it from https://nodejs.org and run this file again. & pause & exit /b 1)
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process http://localhost:4173"
echo.
echo   LIMITS is running at http://localhost:4173
echo   Keep this window open. Close it when you finish presenting.
echo.
node server.mjs
pause
