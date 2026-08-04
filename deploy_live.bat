@echo off
cd /d "%~dp0"
title Deploy 1000 Paintings Gallery live
echo.
echo  WARNING: Netlify DROP (drag folder) does NOT enable Generate.
echo  For full Spellforge on https://1000-l7in.netlify.app use:
echo    deploy_netlify_full.bat
echo  See NETLIFY_FIX.md
echo.
python scripts\prepare_deploy.py
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo  Gallery-only drag deploy (browse + timelapse, NO generate):
echo   %CD%
echo.
choice /C YN /M "Open Netlify Drop for gallery-only deploy anyway"
if errorlevel 2 goto done
start "" "https://app.netlify.com/drop"
explorer "%CD%"
:done
pause