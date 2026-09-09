@echo off
cd /d "%~dp0"
title Gallery — share with Tailscale users
setlocal EnableDelayedExpansion

set "TS=C:\Program Files\Tailscale\tailscale.exe"
if not exist "%TS%" set "TS=tailscale"

set "MAGIC="
set "IP="
for /f "tokens=*" %%a in ('"%TS%" dns status 2^>nul ^| findstr /i "Other devices in your tailnet can reach"') do (
  rem line: Other devices ... at name.ts.net.
  for /f "tokens=2 delims=at" %%b in ("%%a") do set "MAGIC=%%b"
)
rem Prefer stable parse from status --json via python if available
python -c "import json,subprocess; d=json.loads(subprocess.check_output([r'%TS%','status','--json'], text=True)); s=d.get('Self') or {}; print((s.get('DNSName') or '').rstrip('.')); print((s.get('TailscaleIPs') or [''])[0])" 2>nul > "%TEMP%\ts_gallery_share.txt"
if exist "%TEMP%\ts_gallery_share.txt" (
  set /p MAGIC=<"%TEMP%\ts_gallery_share.txt"
  for /f "skip=1 delims=" %%i in (%TEMP%\ts_gallery_share.txt) do set "IP=%%i" & goto :have
)
:have

if not defined MAGIC set "MAGIC=desktop-khpuv0r.tail51fce6.ts.net"
if not defined IP set "IP=100.92.235.44"

REM HTTPS via Tailscale Serve (required for phone camera)
"%TS%" serve --bg http://127.0.0.1:8765 >nul 2>&1

set "URL=https://%MAGIC%/"
set "URL_SF=https://%MAGIC%/#spellforge"
set "URL_DREAM=https://%MAGIC%/#dream"
set "URL_HTTP=http://%MAGIC%:8765/"
set "URL_IP=http://%IP%:8765/"

echo.
echo  ================================================
echo   1000 Paintings Challenge — phone / Tailscale
echo  ================================================
echo.
echo  YOUR PHONE (camera needs the HTTPS links):
echo    1. Install Tailscale, sign in, Connected ON
echo    2. Keep start_server.bat running on this PC
echo    3. Open in Safari or Chrome:
echo.
echo  Gallery (HTTPS):
echo    %URL%
echo  Dream Stasis + camera:
echo    %URL_DREAM%
echo  Spellforge:
echo    %URL_SF%
echo.
echo  Note: http:// links load the site but BLOCK the camera on phones.
echo  HTTP browse-only: %URL_HTTP%
echo.
echo  Links copied to clipboard.
echo.

(
echo Phone gallery ^(HTTPS — camera works^):
echo.
echo %URL_DREAM%
echo.
echo Gallery: %URL%
echo Spellforge: %URL_SF%
echo.
echo Steps:
echo 1^) Install Tailscale: https://tailscale.com/download
echo 2^) Sign in, turn Connected ON
echo 3^) Open the https link in Safari/Chrome
echo 4^) Allow Camera when Dream Stasis asks
echo.
echo PC must run start_server.bat. If camera fails, run enable_phone_camera.bat on the PC.
) | clip

echo  Message copied to clipboard — paste into Notes or Messages.
echo.
echo  Admin: https://login.tailscale.com/admin/users
echo  Machines: https://login.tailscale.com/admin/machines
echo  ACL ^(should allow all users by default^):
echo         https://login.tailscale.com/admin/acls
echo.
pause
