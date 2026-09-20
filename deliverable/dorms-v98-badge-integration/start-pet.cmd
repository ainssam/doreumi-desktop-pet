@echo off
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\node_modules\electron\dist\electron.exe" (
  echo Electron runtime not found. Run npm ci from the repository root.
  pause
  exit /b 1
)
start "" "%ROOT%\node_modules\electron\dist\electron.exe" "%~dp0desktop.cjs"
