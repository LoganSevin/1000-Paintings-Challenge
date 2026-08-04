@echo off
cd /d "%~dp0"
title Fix public link (1000-l7in)
color 0E
echo.
echo  Your live site still has OLD files if you see:
echo    "Start start_server.bat" or "localhost:8765"
echo.
echo  FIX = run deploy_netlify_easy.bat (NOT drag-and-drop)
echo.
choice /C YN /M "Run deploy_netlify_easy.bat now"
if errorlevel 2 goto skip
call deploy_netlify_easy.bat
goto end
:skip
echo.
echo  Open REDEPLOY_NOW.md for steps.
start "" notepad "%~dp0REDEPLOY_NOW.md"
:end
pause