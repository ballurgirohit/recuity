@echo off
setlocal enableextensions

set "DIR=%~dp0"
cd /d "%DIR%"

echo.
echo Starting server...
echo Open http://localhost:3000 in your browser

npm run start

echo.
echo Server stopped. Press any key to close.
pause >nul
