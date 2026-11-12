@echo off
rem Drag a .ino onto this file (or: flash.bat my_design.ino [COM5]) to compile and upload it to the ESP32.
if "%~1"=="" (echo Drag a .ino file onto flash.bat, or run: flash.bat my_design.ino [COM5] & pause & exit /b 1)
if "%~2"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0flash.ps1" -Sketch "%~1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0flash.ps1" -Sketch "%~1" -Port "%~2"
)
pause
