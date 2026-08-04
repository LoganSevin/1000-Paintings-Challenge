@echo off
cd /d "%~dp0"
title Allow phone access — port 8765
echo.
echo  Adds a Windows Firewall rule so phones on the same Wi-Fi can open the gallery.
echo  Requires Administrator (right-click ^> Run as administrator if this fails).
echo.

netsh advfirewall firewall delete rule name="1000 Paintings Gallery 8765" >nul 2>&1
netsh advfirewall firewall add rule name="1000 Paintings Gallery 8765" dir=in action=allow protocol=TCP localport=8765
if errorlevel 1 (
  echo.
  echo  FAILED — right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)

echo.
echo  Firewall rule added for TCP port 8765.
echo  Restart start_server.bat, then on your phone use the "Phone / tablet" URL it prints.
echo  Example: http://192.168.1.171:8765/
echo.
pause