@echo off
cd /d "%~dp0"
title Share full Spellforge online
echo.
python scripts\prepare_deploy.py
echo.
echo  ============================================================
echo   FULL PARTICIPATION LINK (same as your PC, for visitors)
echo  ============================================================
echo.
echo   Follow the steps in:  SHARE_AND_PARTICIPATE.md
echo.
echo   Summary:
echo   1. Upload this gallery folder to GitHub
echo   2. Create a Render Web Service (free)
echo   3. Add XAI_API_KEY and PUBLIC_URL on Render
echo   4. Share:  https://YOUR-APP.onrender.com/#spellforge
echo.
echo   Visitors never run start_server.bat.
echo.
start "" notepad "%~dp0SHARE_AND_PARTICIPATE.md"
pause