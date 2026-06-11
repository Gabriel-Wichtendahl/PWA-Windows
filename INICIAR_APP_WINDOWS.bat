@echo off
setlocal
cd /d "%~dp0"
echo Iniciando Deriv IC Panel Electron...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: No se encontro Node.js.
  echo Instala Node.js LTS desde https://nodejs.org/ y volve a ejecutar este archivo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias la primera vez...
  npm install
  if errorlevel 1 (
    echo.
    echo ERROR instalando dependencias.
    pause
    exit /b 1
  )
)
npm start
pause
