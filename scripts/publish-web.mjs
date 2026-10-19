// Publie une mise à jour de l'interface pour l'appli mobile, sans la réinstaller :
//   node scripts/publish-web.mjs            → prépare l'archive (public/app-update/)
//   node scripts/publish-web.mjs --deploy   → prépare puis met en ligne sur Firebase Hosting
// L'appli (iPhone / Android) vérifie public/app-update/manifest.json au démarrage, télécharge l'archive
// et recharge son interface depuis ce dossier. Seuls les changements natifs (plugins, réglages iOS)
// demandent une nouvelle installation via SideStore.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'app-update');
// JSZip (déjà fourni pour l'appli) chargé comme un module CommonJS (le projet est en « type: module »)
const loadCjs = (file) => {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', fs.readFileSync(file, 'utf8'))(module, module.exports, createRequire(import.meta.url));
  return module.exports;
};
const JSZip = loadCjs(path.join(PUB, 'vendor', 'jszip.min.js'));

// Version de l'interface : date + heure (toujours croissante)
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = `${d.getFullYear()}.${pad(d.getMonth() + 1)}${pad(d.getDate())}.${pad(d.getHours())}${pad(d.getMinutes())}`;
// Version native minimale (à augmenter seulement quand l'interface a besoin d'un nouveau plugin natif)
const MIN_NATIVE = 1;

console.log('1/3 Serveur embarqué…');
execSync('node scripts/build-mobile.mjs', { cwd: ROOT, stdio: 'inherit' });
fs.writeFileSync(path.join(PUB, 'version.json'), JSON.stringify({ version, minNative: MIN_NATIVE }));

console.log('2/3 Archive…');
// Fichiers inutiles dans l'appli (déjà intégrés au natif, ou réservés au web)
const SKIP = [/^app-update\//, /^assets\/(og-image|splash-|android-|app-icon-1024|app-icon-maskable)/, /^party\.html$/, /^u\.html$/, /^js\/(party|public-profile)\.js$/, /\.map$/];
const zip = new JSZip();
let count = 0;
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const rel = path.relative(PUB, full).replace(/\\/g, '/');
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (!SKIP.some((re) => re.test(rel))) {
      zip.file(rel, fs.readFileSync(full));
      count++;
    }
  }
};
walk(PUB);
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^bundle-.*\.zip$/.test(f)) fs.rmSync(path.join(OUT, f)); // on ne garde que la dernière
const file = `bundle-${version}.zip`;
fs.writeFileSync(path.join(OUT, file), buf);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ version, url: `app-update/${file}`, size: buf.length, files: count, minNative: MIN_NATIVE, date: d.toISOString() }, null, 2));
console.log(`   ${count} fichiers, ${(buf.length / 1048576).toFixed(2)} Mo → public/app-update/${file}`);

if (process.argv.includes('--deploy')) {
  console.log('3/3 Mise en ligne (Firebase Hosting)…');
  execSync('npx firebase-tools deploy --only hosting', { cwd: ROOT, stdio: 'inherit' });
  console.log(`Mise à jour ${version} en ligne : les téléphones la prendront à leur prochain démarrage.`);
} else console.log('3/3 Pour la mettre en ligne : node scripts/publish-web.mjs --deploy');
