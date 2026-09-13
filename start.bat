@echo off
cd /d "%~dp0"

if not exist "node_modules\" (
    echo Installing dependencies. This may take a minute...
    call npm install
    if errorlevel 1 goto :fail
)

call npm run build:ui
if errorlevel 1 goto :fail

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
exit /b 0

:fail
echo Failed to start DMX whIP Companion.
pause
exit /b 1
