@echo off
setlocal enabledelayedexpansion
title Pen Fight Arena - setup

echo.
echo  ===============================================
echo   Pen Fight Arena - one-time setup
echo  ===============================================
echo.

cd /d "%~dp0"

REM ---- Node.js present? -------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo  [X] Node.js was not found on your PATH.
    echo.
    echo      Install Node.js 20 LTS or newer from https://nodejs.org
    echo      then close this window, open a new one, and run setup.bat again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo  Node.js !NODEVER! detected.
echo.

REM ---- Install dependencies ---------------------------------------------
echo  Installing dependencies. The first run downloads a few hundred MB and
echo  can take several minutes - this is normal.
echo.
call npm install
if errorlevel 1 (
    echo.
    echo  [X] npm install failed. Common causes:
    echo        - no internet connection or a corporate proxy
    echo        - an antivirus tool locking files in node_modules
    echo      Scroll up for the exact npm error, then run setup.bat again.
    echo.
    pause
    exit /b 1
)

echo.
echo  Dependencies installed.
echo.

REM ---- Environment file --------------------------------------------------
if not exist ".env" (
    copy /Y ".env.example" ".env" >nul
    echo  Created .env from .env.example.
) else (
    echo  .env already exists - leaving it alone.
)
echo.

REM ---- Prisma client (optional) -----------------------------------------
REM Generating the Prisma client needs no database connection. If it fails,
REM the game still runs on local JSON storage, so this never blocks setup.
echo  Generating the Prisma database client (optional)...
call npm run prisma:generate >nul 2>nul
if errorlevel 1 (
    echo  Prisma client not generated. That is fine - the game will use local
    echo  development storage. See README.md to enable PostgreSQL later.
) else (
    echo  Prisma client ready.
)
echo.

REM ---- Final check -------------------------------------------------------
call npm run doctor

echo.
echo  ===============================================
echo   Setup finished. Run start.bat to play.
echo  ===============================================
echo.
pause
