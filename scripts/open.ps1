# Ouvre l'appli Boombox dans sa propre fenêtre (lanceur Boombox.cmd et icône scripts\tray.ps1), par ordre de préférence :
# 1. l'appli Boombox installée depuis Chrome / Edge (menu ⋮ → Installer) : même fenêtre que l'icône épinglée.
#    Seulement un raccourci vers chrome_proxy / msedge_proxy : celui du menu Démarrer créé par l'installateur
#    s'appelle aussi « Boombox » mais pointe vers Boombox.cmd, qui se relancerait alors sans fin ;
# 2. le navigateur par défaut s'il sait ouvrir une fenêtre d'appli (--app : Chrome, Edge, Brave, Vivaldi),
#    pour garder les comptes et extensions de la personne ;
# 3. sinon (Firefox, Opera…) Chrome ou Edge en fenêtre d'appli (Edge est toujours là sur Windows 10 / 11) ;
# 4. en dernier recours, un onglet du navigateur par défaut.
param([string]$Url = 'http://localhost:8787')

$sh = New-Object -ComObject WScript.Shell
$pwa = Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'Boombox.lnk' -ErrorAction SilentlyContinue |
  Where-Object { $sh.CreateShortcut($_.FullName).TargetPath -match '_proxy\.exe$' } | Select-Object -First 1
if ($pwa) { Start-Process $pwa.FullName; exit }

$app = $null
try {
  $prog = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId
  $cmd = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$prog\shell\open\command" -ErrorAction Stop).'(default)'
  if ($cmd -match '^\s*"([^"]+\.exe)"' -or $cmd -match '^\s*(\S+\.exe)') {
    $exe = $Matches[1]
    if ((Split-Path $exe -Leaf) -match '^(chrome|msedge|brave|vivaldi)\.exe$' -and (Test-Path $exe)) { $app = $exe }
  }
} catch {}
if (-not $app) {
  $app = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
# Accélération matérielle forcée (même sur une carte graphique que Chrome met de côté par prudence) : défilement et
# animations calés sur la fréquence de l'écran (144 Hz, 165 Hz…). Sans effet si le navigateur était déjà ouvert.
if ($app) { Start-Process $app "--app=$Url", '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-zero-copy' } else { Start-Process $Url }
