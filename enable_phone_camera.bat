@echo off
cd /d "%~dp0"
title Enable phone camera (Tailscale HTTPS)
setlocal EnableDelayedExpansion

set "TS=C:\Program Files\Tailscale\tailscale.exe"
if not exist "%TS%" set "TS=tailscale"

echo.
echo  Phone browsers block the camera on plain HTTP.
echo  This turns on Tailscale HTTPS so Safari/Chrome allow the camera.
echo.
echo  Requirements:
echo    - Tailscale running and Connected on this PC
echo    - start_server.bat running (gallery on port 8765)
echo.

"%TS%" serve --bg http://127.0.0.1:8765
if errorlevel 1 (
  echo.
  echo  If Serve is not enabled for your tailnet, open the link Tailscale printed,
  echo  click Enable, then run this bat again.
  echo.
  pause
  exit /b 1
)

set "MAGIC="
for /f "delims=" %%n in ('python -c "import json,subprocess;d=json.loads(subprocess.check_output([r'%TS%','status','--json'],text=True));print((d.get('Self') or {}).get('DNSName','').rstrip('.'))" 2^>nul') do set "MAGIC=%%n"
if not defined MAGIC set "MAGIC=desktop-khpuv0r.tail51fce6.ts.net"

set "URL=https://%MAGIC%/"
set "URL_DREAM=https://%MAGIC%/#dream"

echo.
echo  HTTPS gallery (use THIS on your phone for camera):
echo    %URL%
echo  Dream Stasis:
echo    %URL_DREAM%
echo.
echo  On the phone: Tailscale Connected, then open the Dream link in Safari or Chrome.
echo  Do NOT use http:// or file:// for the camera.
echo.

(
echo Phone camera URL ^(HTTPS — required^):
echo.
echo %URL_DREAM%
echo.
echo Gallery: %URL%
echo.
echo 1^) Tailscale Connected on phone
echo 2^) start_server.bat running on PC
echo 3^) Open the Dream link in Safari/Chrome
echo 4^) Enter the field → Allow Camera
) | clip

echo  Links copied to clipboard.
echo.
"%TS%" serve status
echo.
pause
