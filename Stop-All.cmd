@echo off
setlocal
cd /d D:\TinyDcBot
powershell -ExecutionPolicy Bypass -NoProfile -File "D:\TinyDcBot\scripts\stop-all.ps1"
pause