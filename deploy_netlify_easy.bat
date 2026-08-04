@echo off
cd /d "%~dp0"
title Deploy 1000-l7in (no global npm needed)
color 0A
echo.
echo  Uses npx from this folder - do NOT use "npm install -g"
echo  Do NOT run commands in PowerShell if you see "scripts disabled"
echo  Use THIS window only.
echo.
call npm install
if errorlevel 1 (
  echo.
  echo  npm failed. Install Node from https://nodejs.org then run this again.
  pause
  exit /b 1
)
echo.
call npx netlify --version
echo.
echo  Step 1: Login (browser will open - click Authorize)
echo  ----------------------------------------
call npx netlify login
if errorlevel 1 (
  echo  Login failed. Try: NETLIFY_NO_CLI.md for GitHub method instead.
  pause
  exit /b 1
)
echo.
echo  Step 2: Link site 1000-l7in
echo  ----------------------------------------
echo  When asked, pick your team, then site "1000-l7in".
echo  Or paste Site ID from Netlify - Site configuration - General.
echo.
call npx netlify link
if errorlevel 1 (
  echo.
  echo  Link failed. Use GitHub method in NETLIFY_NO_CLI.md
  pause
  exit /b 1
)
echo.
echo  Step 3: Build deploy (installs Generate API)
echo  ----------------------------------------
call npx netlify deploy --prod --build
if errorlevel 1 (
  echo  Deploy failed - see NETLIFY_FIX.md
  pause
  exit /b 1
)
echo.
echo  SUCCESS. Now add XAI_API_KEY on Netlify if not done yet:
echo  https://app.netlify.com - 1000-l7in - Environment variables
echo.
echo  Test: https://1000-l7in.netlify.app/api/health
echo  Share: https://1000-l7in.netlify.app/#spellforge
pause