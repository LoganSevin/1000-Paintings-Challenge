@echo off
cd /d "%~dp0"
title Push gallery to GitHub
echo.
echo  This folder is a git repo with your current live studio build committed.
echo.
echo  1) Create a GitHub repo (if you do not have one yet):
echo     https://github.com/new
echo     Name e.g. gallery or 1000-paintings-gallery — leave empty, do not add README.
echo.
echo  2) Paste your repo URL below when asked.
echo     Example: https://github.com/YOUR_USERNAME/gallery.git
echo.
set /p REPO=GitHub repo URL: 
if "%REPO%"=="" (
  echo No URL entered. Exiting.
  pause
  exit /b 1
)
git remote remove origin 2>nul
git remote add origin "%REPO%"
git branch -M main
echo.
echo  Pushing main to origin...
git push -u origin main
if errorlevel 1 (
  echo.
  echo  Push failed. Common fixes:
  echo  - Sign in when Git Credential Manager opens
  echo  - Use a Personal Access Token as the password if asked
  echo  - If the remote already has history: git pull origin main --allow-unrelated-histories
  echo    then resolve and push again
  pause
  exit /b 1
)
echo.
echo  Done. GitHub now matches this gallery folder (code + paintings; not generated/).
pause
