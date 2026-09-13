@echo off
cd /d "%~dp0"

rem Customer launch: do not inherit a DEBUG flag that would open DevTools.
set DEBUG=

if not exist "node_modules\" (
    echo Installing dependencies. This may take a minute...
    call npm install
    if errorlevel 1 goto :fail
)

call npm run build:ui
if errorlevel 1 goto :fail

if not exist "node_modules\electron\dist\electron.exe" (
    echo Electron is not installed. Run npm install and try again.
    goto :fail
)

rem %~dp0 ends with a backslash; quoting it makes Electron see a stray " in the path.
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:fail
echo Failed to start DMX whIP Companion.
pause
exit /b 1
