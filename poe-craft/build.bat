@echo off
rem Builds build\poecraft.exe with the Visual Studio C++ Build Tools (MSVC, C++20).
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS (echo Visual Studio C++ Build Tools not found. & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1 || exit /b 1
cd /d "%~dp0"
if not exist build\obj mkdir build\obj
cl /nologo /O2 /EHsc /std:c++20 /W3 /MP /utf-8 /DNOMINMAX src\*.cpp /Fobuild\obj\ /Fe:build\poecraft.exe /link /SUBSYSTEM:CONSOLE
exit /b %ERRORLEVEL%
