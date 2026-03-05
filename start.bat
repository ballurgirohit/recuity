@echo off
setlocal enableextensions

REM Start the Hiring app (Node + Express)
REM This script assumes Node.js + npm are installed and available in PATH.

set "DIR=%~dp0"
cd /d "%DIR%"

IF NOT EXIST "node_modules\" (
  echo Installing dependencies...
  npm install
  IF ERRORLEVEL 1 (
    echo.
    echo npm install failed. Please ensure Node.js and npm are installed.
    pause
    exit /b 1
  )
)

echo Starting server...
echo Open http://localhost:3000 in your browser

npm run start

echo.
echo Server stopped. Press any key to close.
pause >nul
