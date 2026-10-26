// Mise à jour automatique de Boombox installé sur PC (installateur Windows), au démarrage puis toutes les 6 h :
// - interface (public/) : même archive que les téléphones (Firebase, app-update/manifest.json), dépliée sur place ;
// - serveur, Node, yt-dlp… : nouvel installateur publié sur GitHub, lancé en silencieux (il arrête Boombox,
//   remplace les fichiers et le relance). Jamais pendant une écoute.
// Rien ne se passe dans le dossier de développement (pas de node\node.exe fourni, ou dépôt git).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const WEB = 'https://musikal-b72d1.web.app/';
const REPO = 'kwakwa-ratatouille/BoomBox';

const installed = () => process.platform === 'win32' && fs.existsSync(path.join(ROOT, 'node', 'node.exe')) && !fs.existsSync(path.join(ROOT, '.git'));
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
// Versions « 2026.1026.1612 » (interface) ou « 1.0.229 » (installateur) : comparaison nombre par nombre
const newer = (a, b) => {
  const x = String(a).replace(/^v/, '').split('.').map(Number);
  const y = String(b || '0').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// Dernière requête d'écoute (audio, préchargement) : on n'interrompt pas la musique pour installer
let lastPlay = 0;
export const activity = (req, res, next) => {
  if (/^\/api\/(stream|prefetch|audio|clip)/.test(req.path)) lastPlay = Date.now();
  next();
};

// JSZip (fourni pour l'appli) chargé comme un module CommonJS
let JSZip;
const jszip = () => {
  if (JSZip) return JSZip;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', fs.readFileSync(path.join(PUB, 'vendor', 'jszip.min.js'), 'utf8'))(module, module.exports, createRequire(import.meta.url));
  return (JSZip = module.exports);
};

async function updateInterface() {
  const m = await fetch(`${WEB}app-update/manifest.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null));
  const local = readJson(path.join(PUB, 'version.json'));
  if (!m?.version || !newer(m.version, local?.version)) return;
  const buf = Buffer.from(await fetch(WEB + m.url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`archive ${r.status}`)))));
  const zip = await jszip().loadAsync(buf);
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length < 10 || !zip.file('index.html')) throw new Error('archive incomplète');
  // Tout est lu avant d'écrire quoi que ce soit ; version.json en dernier (une coupure retentera la mise à jour)
  const data = await Promise.all(files.map(async (f) => [f.name, await f.async('nodebuffer')]));
  for (const [name, content] of data) {
    if (name === 'version.json') continue;
    const dest = path.join(PUB, name);
    if (!dest.startsWith(PUB + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  fs.writeFileSync(path.join(PUB, 'version.json'), JSON.stringify({ version: m.version, minNative: m.minNative }));
  console.log(`  Mise à jour de l'interface : ${m.version}`);
}

let installing = false;
async function updateApp() {
  const local = readJson(path.join(ROOT, 'pc-version.json'));
  if (!local?.version || installing) return;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'user-agent': 'Boombox' } }).then((x) => (x.ok ? x.json() : null));
  const asset = r?.assets?.find((a) => a.name === 'Boombox-Setup.exe');
  if (!asset || !newer(r.tag_name, local.version)) return;
  if (Date.now() - lastPlay < 10 * 60e3) return; // musique en cours : on réessaiera plus tard
  installing = true;
  const exe = path.join(os.tmpdir(), `Boombox-Setup-${r.tag_name}.exe`);
  try {
    if (!fs.existsSync(exe) || fs.statSync(exe).size !== asset.size) {
      const buf = Buffer.from(await fetch(asset.browser_download_url).then((x) => (x.ok ? x.arrayBuffer() : Promise.reject(new Error(`installateur ${x.status}`)))));
      if (buf.length !== asset.size) throw new Error('installateur incomplet');
      fs.writeFileSync(exe, buf);
    }
    console.log(`  Mise à jour de Boombox : ${r.tag_name} (redémarrage du serveur)`);
    // Détaché : l'installateur arrête ce serveur puis le relance (voir scripts/boombox.iss)
    spawn(exe, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    installing = false;
    throw e;
  }
}

async function check() {
  await updateInterface().catch((e) => console.error('  Mise à jour de l’interface impossible :', e.message));
  await updateApp().catch((e) => console.error('  Mise à jour de Boombox impossible :', e.message));
}

export function startAutoUpdate() {
  if (!installed()) return;
  setTimeout(check, 30e3);
  setInterval(check, 6 * 3600e3);
}
