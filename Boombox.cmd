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

rem Ouverture dans sa propre fenêtre : appli Boombox installée, sinon navigateur par défaut (s'il le permet),
rem sinon Chrome ou Edge (détails dans scripts\open.ps1, partagé avec l'icône près de l'horloge)
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\open.ps1"
