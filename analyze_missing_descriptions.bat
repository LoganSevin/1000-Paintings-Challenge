@echo off
cd /d "%~dp0"
title Fill missing generated descriptions
echo.
echo  Describes every generated/ image that is missing a title + description.
echo  Safe to stop (Ctrl+C) and re-run — it resumes where it left off.
echo  Uses your XAI_API_KEY / data\xai-api-key.txt / Grok login.
echo.
python scripts\analyze_lod1.py --workers 3 --delay 0.6
echo.
pause
