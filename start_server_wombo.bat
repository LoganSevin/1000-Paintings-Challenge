@echo off
cd /d "%~dp0"
title Spellforge local (WOMBO Dream)
echo.
echo  Uses WOMBO Dream for Generate instead of xAI.
echo  Set your key below (or in Windows Environment variables).
echo.
if "%WOMBO_DREAM_API_KEY%"=="" (
  echo  ERROR: Set WOMBO_DREAM_API_KEY first, e.g.:
  echo    set WOMBO_DREAM_API_KEY=your-key-from-api.dream.ai
  pause
  exit /b 1
)
set SPELLFORGE_IMAGE_PROVIDER=wombo
call start_server.bat