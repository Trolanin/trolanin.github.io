@echo off
rem Builds drift-viz.exe with the Visual Studio C++ Build Tools (cl, rc and fxc from the Windows SDK).
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`call "%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS (echo Visual Studio C++ Build Tools not found. & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
if not exist build mkdir build

rem Shaders are compiled ahead of time and embedded as byte arrays.
for %%s in (VS_Full:vs_5_0 VS_Wave:vs_5_0 VS_Attr:vs_5_0 PS_Warp:ps_5_0 PS_Wave:ps_5_0 PS_Attr:ps_5_0 PS_Comp:ps_5_0 PS_Copy:ps_5_0) do (
  for /f "tokens=1,2 delims=:" %%a in ("%%s") do (
    fxc /nologo /O3 /T %%b /E %%a /Vn g_%%a /Fh build\%%a.h src\shaders.hlsl >build\fxc.log 2>&1 || (type build\fxc.log & exit /b 1)
  )
)

rc /nologo /fo build\app.res src\app.rc || exit /b 1
cl /nologo /O2 /EHsc /std:c++17 /W3 /MT /utf-8 /DUNICODE /D_UNICODE /D_CRT_SECURE_NO_WARNINGS /Ibuild /Fobuild\ ^
  src\main.cpp src\render.cpp src\audio.cpp src\evolve.cpp src\options.cpp build\app.res ^
  /Fe:drift-viz.exe /link /SUBSYSTEM:WINDOWS /MANIFEST:NO
exit /b %ERRORLEVEL%
