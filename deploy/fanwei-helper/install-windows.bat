@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SOURCE_DIR=%~dp0"
set "INSTALL_DIR=%LOCALAPPDATA%\YikaoFanweiHelper"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_LAUNCHER=%STARTUP_DIR%\YikaoFanweiHelper.bat"
set "CONFIG_SOURCE=%SOURCE_DIR%config.env"
set "CONSOLE_ORIGINS=http://172.16.13.214:8765"
if exist "%CONFIG_SOURCE%" (
  for /f "tokens=1,* delims==" %%A in ('findstr /B "YIKAO_CONSOLE_ORIGINS=" "%CONFIG_SOURCE%"') do set "CONSOLE_ORIGINS=%%B"
)
for /f "tokens=1 delims=, " %%A in ("%CONSOLE_ORIGINS%") do set "CONSOLE_ORIGIN=%%A"
if "%CONSOLE_ORIGIN%"=="" set "CONSOLE_ORIGIN=http://172.16.13.214:8765"

echo [1/4] Installing Yikao Fanwei Helper...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

if exist "%INSTALL_DIR%\helper.pid" (
  set /p OLD_PID=<"%INSTALL_DIR%\helper.pid"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$install=Join-Path $env:LOCALAPPDATA 'YikaoFanweiHelper';" ^
  "$node=[IO.Path]::GetFullPath((Join-Path $install 'node.exe'));" ^
  "$pidText='!OLD_PID!';" ^
  "$ids=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq 'node.exe' -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $node } | Select-Object -ExpandProperty ProcessId);" ^
  "if ($pidText -match '^\d+$') { $pidProcess=Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue; if ($pidProcess -and $pidProcess.Path -and [IO.Path]::GetFullPath($pidProcess.Path) -ieq $node) { $ids += $pidProcess.Id } };" ^
  "$ids | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue };" ^
  "$deadline=[DateTime]::UtcNow.AddSeconds(10);" ^
  "do { $running=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq 'node.exe' -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $node }); if (-not $running) { exit 0 }; Start-Sleep -Milliseconds 200 } while ([DateTime]::UtcNow -lt $deadline);" ^
  "exit 1"
if errorlevel 1 (
  echo Installation failed while stopping the old helper.
  pause
  exit /b 1
)
del /q "%INSTALL_DIR%\helper.pid" >nul 2>&1

set "COPY_OK="
for /L %%I in (1,1,5) do (
  xcopy "%SOURCE_DIR%*" "%INSTALL_DIR%\" /E /I /Y /Q >nul
  if not errorlevel 1 (
    set "COPY_OK=1"
    goto copy_complete
  )
  timeout /t 1 /nobreak >nul
)
:copy_complete
if not defined COPY_OK (
  echo Installation failed while copying files.
  pause
  exit /b 1
)

if exist "%CONFIG_SOURCE%" (
  copy /Y "%CONFIG_SOURCE%" "%INSTALL_DIR%\config.env" >nul
) else (
  >"%INSTALL_DIR%\config.env" echo YIKAO_HELPER_HOST=127.0.0.1
  >>"%INSTALL_DIR%\config.env" echo YIKAO_HELPER_PORT=18765
  >>"%INSTALL_DIR%\config.env" echo YIKAO_HELPER_CHROME_PORT=19222
  >>"%INSTALL_DIR%\config.env" echo YIKAO_CONSOLE_ORIGINS=%CONSOLE_ORIGIN%
)
>>"%INSTALL_DIR%\config.env" echo YIKAO_HELPER_RUNTIME_DIR=%INSTALL_DIR%

echo [2/4] Registering current-user startup launcher...
if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%"
copy /Y "%INSTALL_DIR%\start-windows.bat" "%STARTUP_LAUNCHER%" >nul

echo [3/4] Starting local helper...
call "%INSTALL_DIR%\start-windows.bat"
if errorlevel 1 (
  echo The helper could not be started. Check "%INSTALL_DIR%\helper-error.log".
  pause
  exit /b 1
)

echo [4/4] Opening the shared Fanwei page...
start "" "%CONSOLE_ORIGIN%/fanwei-test"
echo Installation completed.
timeout /t 2 /nobreak >nul
exit /b 0
