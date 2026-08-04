@echo off
cd /d "%~dp0"
title Set xAI API key for gallery
echo.
echo  This saves your xAI console API key for Conceptualizer / generate.
echo  Get a key: https://console.x.ai/team/default/api-keys
echo  It should look like: xai-xxxxxxxx...
echo.
echo  Paste the key below and press Enter.
echo  (It is stored only in data\xai-api-key.txt on this PC — do not share that file.)
echo.
set /p "KEY=API key: "
if not defined KEY (
  echo  No key entered.
  pause
  exit /b 1
)

REM strip accidental quotes
set "KEY=%KEY:"=%"
if /i "%KEY:~0,7%"=="Bearer " set "KEY=%KEY:~7%"

if not exist "data" mkdir data
(
  echo # xAI console API key — used by start_server.bat / Conceptualizer
  echo # https://console.x.ai/team/default/api-keys
  echo %KEY%
) > "data\xai-api-key.txt"

echo.
echo  Saved to data\xai-api-key.txt
echo  Now run start_server.bat ^(restart if it is already open^).
echo.
pause
