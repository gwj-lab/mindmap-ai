@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if not errorlevel 1 goto run-pnpm

where corepack >nul 2>nul
if errorlevel 1 (
  echo Node.js with Corepack or pnpm was not found. Install Node.js, then run this script again.
  pause
  exit /b 1
)

call corepack pnpm dev
if errorlevel 1 pause
exit /b

:run-pnpm
call pnpm dev
if errorlevel 1 pause
