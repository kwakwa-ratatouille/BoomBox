# Serveur Boombox en arrière-plan, avec une icône dans la zone de notification (près de l'horloge).
# Clic droit : ouvrir Boombox, redémarrer le serveur, quitter. Double-clic : ouvrir Boombox.
# Le serveur (node) tourne sans fenêtre et redémarre tout seul s'il s'arrête.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$url = 'http://localhost:8787'

# Une seule icône à la fois
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'BoomboxTray', [ref]$created)
if (-not $created) { exit }

$script:server = $null
$script:quitting = $false

function Start-Server {
  # Déjà lancé ailleurs (ancienne fenêtre) : on ne double pas
  if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { return }
  # Version installée (setup Windows) : Node est fourni avec l'appli ; sinon celui du PC
  $node = Join-Path $root 'node\node.exe'
  if (-not (Test-Path $node)) { $node = 'node' }
  # Serveur qui s'arrête en boucle (3 relances en 3 min) : rapport de plantage, une fois (server\report.js)
  $script:starts = @(@($script:starts) + (Get-Date) | Where-Object { $_ -and $_ -gt (Get-Date).AddMinutes(-3) })
  if ($script:starts.Count -ge 3 -and -not $script:reported) {
    $script:reported = $true
    Start-Process -FilePath $node -ArgumentList 'server\report.js', '"Le serveur s''arrete en boucle"', 'icone' -WorkingDirectory $root -WindowStyle Hidden
  }
  $script:server = Start-Process -FilePath $node -ArgumentList 'server\index.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru
}

function Stop-Server {
  $c = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
  if ($script:server -and -not $script:server.HasExited) { Stop-Process -Id $script:server.Id -Force -ErrorAction SilentlyContinue }
  $script:server = $null
}

function Open-Boombox {
  # Appli installée, navigateur par défaut ou Chrome / Edge : voir scripts\open.ps1 (partagé avec Boombox.cmd)
  Start-Process powershell -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'open.ps1'), '-Url', $url -WindowStyle Hidden
}

$icon = New-Object System.Windows.Forms.NotifyIcon
$ico = Join-Path $root 'resources\boombox.ico'
$icon.Icon = if (Test-Path $ico) { New-Object System.Drawing.Icon $ico } else { [System.Drawing.SystemIcons]::Application }
$icon.Text = 'Boombox (serveur en marche)'
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Ouvrir Boombox')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Open-Boombox })
$restart = $menu.Items.Add('Redémarrer le serveur')
$restart.add_Click({ Stop-Server; Start-Sleep -Milliseconds 800; Start-Server; $icon.ShowBalloonTip(2000, 'Boombox', 'Serveur redémarré', 'Info') })
[void]$menu.Items.Add('-')
$quit = $menu.Items.Add('Quitter Boombox')
$quit.add_Click({
  $script:quitting = $true
  Stop-Server
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick({ Open-Boombox })

Start-Server

# Surveillance : serveur arrêté (plantage) → relancé
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.add_Tick({
  if (-not $script:quitting -and -not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) { Start-Server }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
