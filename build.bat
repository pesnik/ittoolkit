@echo off
setlocal

set APP_NAME=helium
set DIST_DIR=dist

echo Building %APP_NAME%...
call npm run tauri build

if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"

echo Packaging for distribution...

REM Check for NSIS installer (standard Windows build)
if exist "src-tauri\target\release\bundle\nsis\*.exe" (
    echo Found NSIS installer, copying to %DIST_DIR%...
    copy "src-tauri\target\release\bundle\nsis\*.exe" "%DIST_DIR%\"
)

REM Create a portable zip (manual step since Tauri builds installers by default)
REM We zip the executable and resources directly
if exist "src-tauri\target\release\helium.exe" (
    echo Creating portable zip...
    powershell -command "Compress-Archive -Path 'src-tauri\target\release\helium.exe' -DestinationPath '%DIST_DIR%\%APP_NAME%-windows-portable.zip' -Force"
)

echo.
echo Build complete. Check the '%DIST_DIR%' folder.
echo.
pause
