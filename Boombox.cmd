@echo off
rem Lance Boombox sur le PC : démarre le serveur (fenêtre réduite) s'il ne tourne pas déjà,
rem puis ouvre l'appli dans sa propre fenêtre (Chrome ou Edge en mode application).
cd /d "%~dp0"

powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:8787/api/status) | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "Boombox (serveur)" /min cmd /c "node server\index.js"
  powershell -NoProfile -Command "for ($i = 0; $i -lt 30; $i++) { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:8787/api/status) | Out-Null; break } catch { Start-Sleep -Milliseconds 500 } }"
)

rem « Boombox.cmd /serveur » : démarre seulement le serveur (lancement automatique avec Windows)
if /i "%~1"=="/serveur" exit /b 0

set "URL=http://localhost:8787"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%URL%
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=%URL%
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --app=%URL%
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%URL%
) else (
  start "" %URL%
)
