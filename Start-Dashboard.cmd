@echo off
setlocal
cd /d D:\TinyDcBot
set OLLAMA_MODELS=D:\TinyDcBot\runtime\ollama\models
set TINYDCBOT_DASHBOARD_PORT=8787
set TINYDCBOT_ALLOW_PATH_RUNTIME=
powershell -ExecutionPolicy Bypass -NoProfile -File "D:\TinyDcBot\scripts\launch-dashboard.ps1"
