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
  # La musique jouée en fond s'arrête aussi (son lecteur gardait le programme en vie : le son continuait)
  try { $bgTimer.Stop(); $player.Stop(); $player.Close() } catch {}
  Stop-Server
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
  [Environment]::Exit(0)
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

# ---------- Lecture en fond ----------
# Fenêtre Boombox fermée pendant un son : le son continue ici (même moment, puis la suite de la file), et le menu
# de l'icône permet pause, suivant et arrêt. En rouvrant Boombox, la fenêtre reprend la main. État : serveur, /api/bg.
Add-Type -AssemblyName PresentationCore
$api = 'http://127.0.0.1:8787/api/bg'
$player = New-Object System.Windows.Media.MediaPlayer
$script:bgSeq = -1
$script:seekTo = $null
$script:bgPlaying = $false
$script:lastPos = 0
$bgSep = New-Object System.Windows.Forms.ToolStripSeparator
$bgNow = New-Object System.Windows.Forms.ToolStripMenuItem
$bgNow.Enabled = $false
$bgToggle = New-Object System.Windows.Forms.ToolStripMenuItem 'Pause'
$bgNext = New-Object System.Windows.Forms.ToolStripMenuItem 'Son suivant'
$bgStop = New-Object System.Windows.Forms.ToolStripMenuItem 'Arrêter la musique'
foreach ($it in @($bgSep, $bgNow, $bgToggle, $bgNext, $bgStop)) { $it.Visible = $false; $menu.Items.Insert(0, $it) }
# Ordre voulu en haut du menu : titre, pause, suivant, arrêter, puis une séparation
$menu.Items.Remove($bgSep); $menu.Items.Insert(4, $bgSep)
function Bg-Post($act) { try { Invoke-RestMethod -Method Post "$api/$act" -TimeoutSec 2 | Out-Null } catch {} }
$bgToggle.add_Click({ if ($script:bgPlaying) { Bg-Post 'pause' } else { Bg-Post 'resume' } })
$bgNext.add_Click({ Bg-Post 'next' })
$bgStop.add_Click({ Bg-Post 'stop' })

$bgTimer = New-Object System.Windows.Forms.Timer
$bgTimer.Interval = 1000
$bgTimer.add_Tick({ try { Bg-Tick } catch { "$(Get-Date -Format s) $($_.Exception.Message) @ $($_.InvocationInfo.ScriptLineNumber)" | Out-File -Append (Join-Path $env:TEMP 'boombox-tray.log') } })
function Bg-Tick {
  try { $s = Invoke-RestMethod $api -TimeoutSec 1 } catch { return }
  if ($s.seq -ne $script:bgSeq) {
    $script:bgSeq = $s.seq
    if ($s.track) {
      # Prise de relais à la fermeture de la fenêtre : on le dit (sinon on ne sait pas d'où vient la musique)
      if (-not $script:bgShown) { $icon.ShowBalloonTip(5000, 'Boombox continue en fond', "« $($s.track.title) » — clic droit sur l'icône Boombox pour mettre pause ou arrêter.", 'Info') }
      $script:bgShown = $true
      $player.Open([Uri]"http://127.0.0.1:8787/api/audio-file/$($s.track.id)")
      $script:seekTo = [double]$s.position
    } else { $player.Close(); $script:bgShown = $false }
  }
  $has = $player.NaturalDuration.HasTimeSpan
  if ($has -and $null -ne $script:seekTo) { $player.Position = [TimeSpan]::FromSeconds($script:seekTo); $script:seekTo = $null }
  if ($s.track -and $s.playing) { $player.Play() } else { $player.Pause() }
  $script:bgPlaying = [bool]($s.track -and $s.playing)
  if ($s.track -and $has) {
    $pos = $player.Position.TotalSeconds
    # Fin du son : le suivant de la file
    if ($s.playing -and $pos -ge $player.NaturalDuration.TimeSpan.TotalSeconds - 0.6) { Bg-Post 'next' }
    elseif ([math]::Abs($pos - $script:lastPos) -ge 2) { $script:lastPos = $pos; try { Invoke-RestMethod -Method Post "$api/pos?t=$([math]::Round($pos, 1))" -TimeoutSec 1 | Out-Null } catch {} }
  }
  $show = [bool]$s.track
  foreach ($it in @($bgSep, $bgNow, $bgToggle, $bgNext, $bgStop)) { $it.Visible = $show }
  if ($show) {
    $label = "$($s.track.title) · $($s.track.artist)"
    if ($label.Length -gt 60) { $label = $label.Substring(0, 59) + '…' }
    $bgNow.Text = $(if ($s.playing) { "♪ $label" } else { "⏸ $label" })
    $bgToggle.Text = $(if ($s.playing) { 'Pause' } else { 'Reprendre' })
    $tip = "Boombox · $label"
    $icon.Text = $(if ($tip.Length -gt 63) { $tip.Substring(0, 62) + '…' } else { $tip })
  } else { $icon.Text = 'Boombox (serveur en marche)' }
}
$bgTimer.Start()

# ---------- Raccourcis clavier globaux ----------
# Marchent partout dans Windows, même quand Boombox n'est pas au premier plan :
#   Ctrl+Alt+P lecture/pause · Ctrl+Alt+→ suivant · Ctrl+Alt+← précédent
#   Ctrl+Alt+↑ / ↓ volume · Ctrl+Alt+L liker le son
# Envoyés à la fenêtre Boombox par le serveur (/api/hotkey) ; fenêtre fermée et musique en fond : gérés ici.
try {
  Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System; using System.Windows.Forms; using System.Runtime.InteropServices;
public class BBHotkeys : NativeWindow {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint vk);
  public event Action<int> Pressed;
  public BBHotkeys() { CreateHandle(new CreateParams()); }
  public bool Add(int id, uint mod, uint vk) { return RegisterHotKey(Handle, id, mod | 0x4000, vk); }
  protected override void WndProc(ref Message m) { if (m.Msg == 0x0312 && Pressed != null) Pressed((int)m.WParam); base.WndProc(ref m); }
}
"@
  $hk = New-Object BBHotkeys
  # id → action ; Ctrl (2) + Alt (1) = 3
  $hkActions = @{ 1 = 'toggle'; 2 = 'next'; 3 = 'prev'; 4 = 'volUp'; 5 = 'volDown'; 6 = 'like' }
  $hkKeys = @{ 1 = 0x50; 2 = 0x27; 3 = 0x25; 4 = 0x26; 5 = 0x28; 6 = 0x4C }
  foreach ($id in $hkKeys.Keys) { [void]$hk.Add($id, 3, $hkKeys[$id]) } # déjà pris par une autre appli : ce raccourci est ignoré
  $hk.add_Pressed({
    param($id)
    $a = $hkActions[$id]
    try { $r = Invoke-RestMethod -Method Post "http://127.0.0.1:8787/api/hotkey" -Body $a -ContentType 'text/plain' -TimeoutSec 2 } catch { $r = $null }
    # Aucune fenêtre Boombox ouverte : musique jouée en fond par l'icône
    if ($r -and $r.delivered -eq 0 -and $script:bgSeq -ge 0) {
      if ($a -eq 'toggle') { if ($script:bgPlaying) { Bg-Post 'pause' } else { Bg-Post 'resume' } }
      elseif ($a -eq 'next') { Bg-Post 'next' }
    }
  })
} catch {
  "$(Get-Date -Format s) raccourcis : $($_.Exception.Message)" | Out-File -Append (Join-Path $env:TEMP 'boombox-tray.log')
}

[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
