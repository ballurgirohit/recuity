@echo off
setlocal enableextensions

REM Start the Hiring app (Node + Express)
REM node_modules is OS-specific due to native deps (better-sqlite3).
REM On Windows we install once and write a marker file, then reuse unless missing.

set "DIR=%~dp0"
cd /d "%DIR%"

set "MARKER=.windows_node_modules_installed"

IF NOT EXIST "%MARKER%" (
  REM First run on Windows (or a fresh repo copy)
  IF EXIST "node_modules\" (
    echo Removing bundled node_modules (non-Windows)...
    rmdir /s /q "node_modules"
  )

  echo Installing dependencies for Windows...
  npm install
  IF ERRORLEVEL 1 (
    echo.
    echo npm install failed. Please ensure Node.js and npm are installed and available in PATH.
    pause
    exit /b 1
  )

  REM Create marker so future runs do not reinstall.
  echo installed>%MARKER%
) ELSE (
  REM Marker exists. Ensure node_modules still exists; reinstall only if missing.
  IF NOT EXIST "node_modules\" (
    echo node_modules missing. Reinstalling dependencies...
    npm install
    IF ERRORLEVEL 1 (
      echo.
      echo npm install failed. Please ensure Node.js and npm are installed and available in PATH.
      pause
      exit /b 1
    )
    echo installed>%MARKER%
  )
)

echo.
echo Starting server...
echo Open http://localhost:3000 in your browser

npm run start

echo.
echo Server stopped. Press any key to close.
pause >nul
