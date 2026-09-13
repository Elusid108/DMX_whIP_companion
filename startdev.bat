@echo off
cd /d "%~dp0"
set DEBUG=*
npm start > debug.log 2>&1
