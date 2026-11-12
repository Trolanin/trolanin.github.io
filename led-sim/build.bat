@echo off
rem Builds led-audio.exe with the Visual Studio C++ Build Tools.
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`call "%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS (echo Visual Studio C++ Build Tools not found. & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
cl /nologo /O2 /EHsc /std:c++17 /W3 led-audio.cpp /Fe:led-audio.exe /link /SUBSYSTEM:CONSOLE
set ERR=%ERRORLEVEL%
del led-audio.obj 2>nul
exit /b %ERR%
