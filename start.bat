@echo off
title Call Prompter Server
echo.
echo   Call Prompter - Starting...
echo   --------------------------
echo.

:: Kill any existing server on ports 4242/4243
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4242.*LISTEN" 2^>nul') do (
    echo   Killing old server (PID %%a)...
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4243.*LISTEN" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: Start server
cd /d "%~dp0"
echo   Starting server...
echo   UI will be at: http://127.0.0.1:4243
echo   Press Ctrl+C to stop
echo.
bun server.mjs %*
if %errorlevel% neq 0 (
    echo.
    echo   Bun not found. Trying Node...
    node server.mjs %*
)
pause
