@echo off
rem Lance Boombox sur le PC : démarre le serveur (fenêtre réduite) s'il ne tourne pas déjà,
rem puis ouvre l'appli dans sa propre fenêtre (Chrome ou Edge en mode application).
cd /d "%~dp0"
rem 127.0.0.1 et pas localhost : Windows PowerShell essaie d'abord IPv6 (::1), où le serveur n'écoute pas, et met 2 s à abandonner

powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8787/api/status) | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  rem Serveur en arrière-plan, sans fenêtre, avec une icône près de l'horloge (scripts\tray.ps1)
  start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\tray.ps1"
  powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8787/api/status) | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
  rem Toujours rien après 30 s : rapport de plantage (version installée seulement, voir server\report.js)
  if errorlevel 1 if exist "%~dp0node\node.exe" "%~dp0node\node.exe" server\report.js "Le serveur ne demarre pas" lanceur
)

rem « Boombox.cmd /serveur » : démarre seulement le serveur (lancement automatique avec Windows)
if /i "%~1"=="/serveur" exit /b 0

set "URL=http://localhost:8787"
rem Boombox installé comme appli Chrome (menu ⋮ → Installer) : on ouvre CETTE appli, pour que l'icône épinglée
rem dans la barre des tâches soit la même fenêtre (sinon Windows la range avec Chrome).
rem Seulement un raccourci d'appli Chrome / Edge (*_proxy.exe) : celui du menu Démarrer créé par l'installateur
rem s'appelle aussi « Boombox » mais pointe vers ce lanceur, qui se relancerait alors sans fin.
for /f "usebackq delims=" %%L in (`powershell -NoProfile -Command "Get-ChildItem \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\" -Recurse -Filter 'Boombox.lnk' -ErrorAction SilentlyContinue | Where-Object { (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName).TargetPath -match '_proxy.exe$' } | Select-Object -First 1 -ExpandProperty FullName"`) do set "PWA=%%L"
if defined PWA (
  start "" "%PWA%"
  exit /b 0
)
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
