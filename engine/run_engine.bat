@echo off
chcp 65001 >nul
title IvyEngine
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo  [!] Run setup first: setup_engine.bat or the installer from the website.
  echo.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m ivy_engine.launcher %*
if errorlevel 1 pause
