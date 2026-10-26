; Installateur Windows de Boombox (compilé par GitHub Actions avec Inno Setup)
; - S'installe pour l'utilisateur, sans droits administrateur : %LocalAppData%\Programs\Boombox
; - Contient Node.js, yt-dlp et cloudflared : rien d'autre à installer
; - Raccourcis Bureau / menu Démarrer, lancement avec Windows en option
; - Les données (bibliothèque locale, réglages) ne sont jamais écrasées par une mise à jour
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6B2F3C1E-8E0B-4E7A-9C51-B00B0B0B0B0B}
AppName=Boombox
AppVersion={#AppVersion}
AppPublisher=Boombox
DefaultDirName={localappdata}\Programs\Boombox
DefaultGroupName=Boombox
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=Boombox-Setup
SetupIconFile=..\resources\boombox.ico
UninstallDisplayIcon={app}\resources\boombox.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"
Name: "autostart"; Description: "Lancer le serveur Boombox au démarrage de Windows (le téléphone peut lire par le PC dès qu'il est allumé)"; GroupDescription: "Démarrage :"

[Files]
Source: "..\dist\win\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Boombox"; Filename: "{app}\Boombox.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\resources\boombox.ico"
Name: "{group}\Désinstaller Boombox"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Boombox"; Filename: "{app}\Boombox.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\resources\boombox.ico"; Tasks: desktopicon
Name: "{userstartup}\Boombox (serveur)"; Filename: "{app}\Boombox.cmd"; Parameters: "/serveur"; WorkingDir: "{app}"; IconFilename: "{app}\resources\boombox.ico"; Tasks: autostart

[Run]
Filename: "{app}\Boombox.cmd"; WorkingDir: "{app}"; Description: "Ouvrir Boombox"; Flags: postinstall nowait skipifsilent shellexec
; Mise à jour automatique (installateur lancé en silencieux par le serveur, server/pc-update.js) : on relance le serveur
Filename: "{app}\Boombox.cmd"; Parameters: "/serveur"; WorkingDir: "{app}"; Flags: nowait runhidden; Check: WizardSilent

[Code]
// Avant d'installer une mise à jour ou de désinstaller : on arrête le serveur Boombox en cours (sinon fichiers verrouillés)
procedure StopBoombox();
var R: Integer;
begin
  Exec('powershell.exe', '-NoProfile -WindowStyle Hidden -Command "Get-Process node,powershell -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' + ExpandConstant('{app}') + '*'' -or ($_.Name -eq ''powershell'' -and (Get-CimInstance Win32_Process -Filter (''ProcessId='' + $_.Id)).CommandLine -like ''*Boombox*tray.ps1*'') } | Stop-Process -Force"', '', SW_HIDE, ewWaitUntilTerminated, R);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopBoombox();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then StopBoombox();
end;
