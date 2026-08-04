@echo off
cd /d "%~dp0"
echo.
echo  Cleaning dev junk + Grok caches (safe)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup_disk_space.ps1" -IncludeGrok
echo.
pause