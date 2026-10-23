@echo off
chcp 65001 >nul
title IvyEngine Setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_engine.ps1"
