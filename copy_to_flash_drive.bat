@echo off
setlocal
cd /d "%~dp0"

echo.
echo  Copy gallery to flash drive (portable — any drive letter)
echo  Source: %CD%
echo.
set /p DEST="Destination folder (e.g. E:\gallery): "
if "%DEST%"=="" (
  echo  Cancelled.
  pause
  exit /b 1
)
if not exist "%DEST%" mkdir "%DEST%"

echo.
echo  [1] Full copy  — paintings + generated + saved art
echo  [2] Slim copy  — paintings + data + code only (~200 MB)
set /p MODE="Choose 1 or 2 [1]: "
if "%MODE%"=="" set MODE=1

if "%MODE%"=="2" (
  echo  Slim copy...
  robocopy "%CD%" "%DEST%" /E /R:2 /W:2 /NFL /NDL /NP ^
    /XD generated saved-fallout saved-stasis node_modules recovered "scripts\tools" .git ^
    /XF app_server_disasm.txt pycdc_errors.txt app_server_recovered.py pycdc.exe Thumbs.db desktop.ini
) else (
  echo  Full copy...
  robocopy "%CD%" "%DEST%" /E /R:2 /W:2 /NFL /NDL /NP ^
    /XD node_modules recovered "scripts\tools" .git ^
    /XF app_server_disasm.txt pycdc_errors.txt app_server_recovered.py pycdc.exe Thumbs.db desktop.ini
)

echo.
if %ERRORLEVEL% LEQ 7 (
  echo  OK. On the flash drive run start_server.bat then http://localhost:8765/
) else (
  echo  Robocopy exit code %ERRORLEVEL% — check destination and retry.
)
pause