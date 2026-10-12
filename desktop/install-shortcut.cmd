@echo off
chcp 65001 >nul
title DevTrace - tao loi tat
node "%~dp0shortcut.js" install %*
echo.
pause
