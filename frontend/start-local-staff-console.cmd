@echo off
title CAV Local Staff Console
cd /d "%~dp0"

echo Starting CAV Local Staff Console...
echo.
echo Open this URL on the cashier PC:
echo http://127.0.0.1:3001
echo.
echo Local Printing Mode can auto-detect printers from this local console.
echo Keep this window open while using the POS.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js or run this from a machine with Node installed.
  echo.
  pause
  exit /b 1
)

node serve-build.js

echo.
echo Local Staff Console stopped.
pause
