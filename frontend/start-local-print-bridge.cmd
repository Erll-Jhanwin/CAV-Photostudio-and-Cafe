@echo off
title CAV Local Print Bridge
cd /d "%~dp0"

echo Starting CAV Local Print Bridge...
echo.
echo Keep this window open while using Local Printing Mode.
echo Bridge URL: http://127.0.0.1:8765
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js or run this from a machine with Node installed.
  echo.
  pause
  exit /b 1
)

node local-print-bridge.js

echo.
echo Local Print Bridge stopped.
pause
