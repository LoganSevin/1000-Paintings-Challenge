@echo off
cd /d "%~dp0"
title Publish descriptions to logan7in.art
echo.
echo  Pushes analysis JSON to GitHub so Netlify updates the live site.
echo  Does not re-analyze images (no extra xAI credits).
echo.
python scripts\publish_descriptions.py
echo.
pause
