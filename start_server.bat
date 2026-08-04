@echo off
cd /d "%~dp0"
title 1000 Paintings Gallery - port 8765
echo.
echo  Stopping any old server on port 8765...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul

REM ---- Load xAI API key from portable file (any computer) ----
if not defined XAI_API_KEY if exist "data\xai-api-key.txt" (
  for /f "usebackq eol=# tokens=* delims=" %%k in ("data\xai-api-key.txt") do (
    set "XAI_API_KEY=%%k"
    goto :key_from_data
  )
)
:key_from_data

if not defined XAI_API_KEY if exist ".xai-api-key" (
  for /f "usebackq eol=# tokens=* delims=" %%k in (".xai-api-key") do (
    set "XAI_API_KEY=%%k"
    goto :key_from_dot
  )
)
:key_from_dot

if defined XAI_API_KEY (
  set "XAI_API_KEY=%XAI_API_KEY:"=%"
  echo  xAI API key: loaded ^(env or data\xai-api-key.txt^)
) else (
  echo.
  echo  WARNING: No XAI_API_KEY — Conceptualizer generate will fail.
  echo  Fix once on this PC:
  echo    1. Open https://console.x.ai/team/default/api-keys
  echo    2. Create a key ^(starts with xai-^)
  echo    3. Double-click set_xai_key.bat and paste it
  echo    4. Run start_server.bat again
  echo.
)

echo  Starting gallery server...
python --version >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Python not found. Install Python 3 and try again.
  pause
  exit /b 1
)

echo.
echo  Keep THIS window open while you use the gallery.
echo  On THIS PC:  http://localhost:8765/
echo.
echo  On your PHONE (same Wi-Fi — not localhost):
echo    The server will print "Phone / tablet" URLs when it starts.
echo    If unreachable, run allow_phone_firewall.bat as Administrator once.
echo.
echo  Press Ctrl+C to stop the server.
echo.

start "" "http://localhost:8765/"
python scripts\app_server.py
if errorlevel 1 (
  echo.
  echo  Server exited with an error. See messages above.
  pause
)
