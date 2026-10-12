@echo off
chcp 65001 >nul
title DevTrace - go loi tat
node "%~dp0shortcut.js" uninstall %*
echo.
pause
