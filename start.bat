@echo off
setlocal enabledelayedexpansion
title Pen Fight Arena - running

echo.
echo  ===============================================
echo   Pen Fight Arena
echo  ===============================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo  [X] Node.js was not found. Install it from https://nodejs.org
    echo      then run setup.bat first.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  [X] Dependencies are not installed yet.
    echo      Run setup.bat first, or run: npm install
    echo.
    pause
    exit /b 1
)

echo  Starting the game server and the web client together.
echo.
echo  When you see "Local: http://localhost:5173", open that address.
echo  To play two players on this computer, open it in two windows -
echo  use a normal window and a private/incognito window, or add ?guest=1
echo  to the address in the second one.
echo.
echo  Press Ctrl+C in this window to stop.
echo.

call npm run dev

echo.
echo  ===============================================
echo   The game has stopped.
echo  ===============================================
echo.
echo  If that was unexpected, the error is printed above.
echo  Run "npm run doctor" to check your setup.
echo.
pause
