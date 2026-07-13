@echo off
setlocal

cd /d "%~dp0"

echo.
echo Pocket Arena local server
echo -------------------------
echo This starts the website on this computer.
echo Open http://localhost:3000 on the host screen.
echo For phone motion controls, use the HTTPS/public deployment or a trusted HTTPS LAN proxy.
echo.

if not exist node_modules (
  echo Installing dependencies...
  call npm ci
  if errorlevel 1 goto failed
)

echo Building production files...
call npm run build
if errorlevel 1 goto failed

echo Starting Pocket Arena...
call npm start
goto end

:failed
echo.
echo Pocket Arena failed to start. Check the error above.
pause

:end
endlocal
