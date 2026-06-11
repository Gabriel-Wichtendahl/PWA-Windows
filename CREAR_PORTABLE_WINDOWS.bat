@echo off
setlocal
cd /d "%~dp0"
echo Creando portable Windows...
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: No se encontro Node.js. Instala Node.js LTS.
  pause
  exit /b 1
)
if not exist node_modules npm install
npm run pack:win
pause
