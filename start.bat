@echo off
cd /d "%~dp0"
title 國文作文批改小幫手

if not exist node_modules call npm install

if not exist .env (
    copy .env.example .env >nul
    echo 請先在 .env 中填入 GEMINI_API_KEY
    notepad .env
    pause
    exit /b
)

echo 正在啟動伺服器，請稍候...
start "" "http://localhost:3000"
node server.js
pause
