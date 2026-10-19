// Lancement de Boombox au démarrage de Windows : un raccourci vers Boombox.cmd dans le dossier « Démarrage »
// de l'utilisateur. Option « ouvrir la fenêtre » : sinon seul le serveur démarre (l'appli est prête, le
// téléphone peut lire / télécommander, et un double-clic sur l'icône ouvre la fenêtre aussitôt).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const startupDir = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const LINK = () => path.join(startupDir(), 'Boombox.lnk');

export function autostartStatus() {
  if (process.platform !== 'win32') return { supported: false, on: false };
  const on = fs.existsSync(LINK());
  let openWindow = false;
  try {
    openWindow = on && fs.readFileSync(path.join(ROOT, 'cache', 'autostart.json'), 'utf8').includes('"openWindow":true');
  } catch {}
  return { supported: true, on, openWindow };
}

export function setAutostart(on, openWindow = false) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Disponible seulement sur Windows'));
    if (!on) {
      fs.rmSync(LINK(), { force: true });
      return resolve(autostartStatus());
    }
    const target = path.join(ROOT, 'Boombox.cmd');
    const q = (s) => s.replace(/'/g, "''");
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${q(LINK())}');$s.TargetPath='${q(target)}';$s.Arguments='${openWindow ? '' : '/serveur'}';$s.WorkingDirectory='${q(ROOT)}';$s.WindowStyle=7;$s.IconLocation='${q(path.join(ROOT, 'resources', 'boombox.ico'))},0';$s.Description='Boombox';$s.Save()`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err) => {
      if (err) return reject(err);
      fs.mkdirSync(path.join(ROOT, 'cache'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'cache', 'autostart.json'), JSON.stringify({ openWindow }));
      resolve(autostartStatus());
    });
  });
}
