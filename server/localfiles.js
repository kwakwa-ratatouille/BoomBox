// « Mes fichiers » : les musiques déjà présentes sur le PC (.mp3, .m4a, .flac…), lues dans un ou plusieurs dossiers.
// Chaque fichier devient un titre Boombox (identifiant « lf_xxxxxxxx ») : jouable, likable, ajoutable aux playlists,
// et lisible aussi sur le téléphone quand il passe par ce PC. Rien n'est envoyé sur Internet.
// Aussi : « Télécharger » un son ou une playlist dans le dossier Musique\Boombox du PC.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONF = path.join(ROOT, 'data', 'local.json');
const EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma)$/i;
const MUSIC = path.join(os.homedir(), 'Music');

let conf = { folders: [MUSIC] };
try {
  conf = { ...conf, ...JSON.parse(fs.readFileSync(CONF, 'utf8')) };
} catch {}
const save = () => {
  fs.mkdirSync(path.dirname(CONF), { recursive: true });
  fs.writeFileSync(CONF, JSON.stringify(conf, null, 2));
};

const byId = new Map(); // id → { file, track }
let scanning = null;
let scannedAt = 0;

export const isLocalId = (id) => /^lf_[0-9a-f]{8}$/.test(String(id));
const idOf = (file) => 'lf_' + crypto.createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 8);

function walk(dir, out, depth = 0) {
  if (depth > 8 || out.length > 20000) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (depth === 0 && dir === MUSIC && e.name === 'Boombox') continue; // nos propres téléchargements (déjà dans l'appli)
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (EXT.test(e.name)) out.push(p);
  }
}

// Titre / artiste devinés depuis le nom du fichier (« Artiste - Titre.mp3 ») quand les étiquettes sont vides
function fromName(file) {
  const base = path.basename(file).replace(EXT, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(?:\d{1,3}[\s.-]+)?(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}

async function readTrack(file) {
  const id = idOf(file);
  const guess = fromName(file);
  let meta = null;
  try {
    meta = await parseFile(file, { duration: true });
  } catch {}
  const c = meta?.common || {};
  const artists = (c.artists?.length ? c.artists : c.artist ? [c.artist] : guess.artist ? [guess.artist] : ['Artiste inconnu']).map((name) => ({ name }));
  return {
    id,
    title: c.title || guess.title,
    artists,
    album: c.album ? { name: c.album } : null,
    duration: Math.round(meta?.format?.duration || 0),
    thumb: c.picture?.length ? `/api/local/cover/${id}` : null,
    local: true,
    addedAt: Math.round(fs.statSync(file).mtimeMs),
  };
}

export async function scan(force = false) {
  if (scanning) return scanning;
  if (!force && byId.size && Date.now() - scannedAt < 10 * 60e3) return [...byId.values()].map((x) => x.track);
  scanning = (async () => {
    const files = [];
    for (const f of conf.folders) if (fs.existsSync(f)) walk(f, files);
    const keep = new Set();
    for (const file of files) {
      const id = idOf(file);
      keep.add(id);
      if (!byId.has(id)) byId.set(id, { file, track: await readTrack(file) });
    }
    for (const id of [...byId.keys()]) if (!keep.has(id)) byId.delete(id);
    scannedAt = Date.now();
    return [...byId.values()].map((x) => x.track).sort((a, b) => b.addedAt - a.addedAt);
  })().finally(() => (scanning = null));
  return scanning;
}

export const localPath = (id) => byId.get(id)?.file || null;
export const folders = () => conf.folders;
export function setFolders(list) {
  conf.folders = [...new Set((list || []).map((f) => String(f).trim()).filter(Boolean))].slice(0, 10);
  save();
  byId.clear();
  return scan(true);
}

// Pochette intégrée au fichier (ou rien → l'appli met l'icône par défaut)
export async function cover(id) {
  const file = localPath(id);
  if (!file) return null;
  try {
    const m = await parseFile(file, { duration: false });
    const pic = m.common.picture?.[0];
    return pic ? { data: Buffer.from(pic.data), type: pic.format || 'image/jpeg' } : null;
  } catch {
    return null;
  }
}

// ---------- Téléchargement dans Musique\Boombox ----------
const clean = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sans titre';
export const downloadDir = (sub) => path.join(MUSIC, 'Boombox', ...(sub ? [clean(sub)] : []));

// tracks : [{ id, title, artists }] ; getFile(id) → chemin du fichier audio (cache yt-dlp)
export async function downloadTracks(tracks, sub, getFile) {
  const dir = downloadDir(sub);
  fs.mkdirSync(dir, { recursive: true });
  let ok = 0;
  const failed = [];
  for (const t of tracks) {
    if (isLocalId(t.id)) continue; // déjà sur le PC
    try {
      const src = await getFile(t.id);
      const name = `${clean((t.artists || []).map((a) => a.name).join(', '))} - ${clean(t.title)}${path.extname(src) || '.m4a'}`;
      fs.copyFileSync(src, path.join(dir, name));
      ok++;
    } catch {
      failed.push(t.title);
    }
  }
  return { dir, ok, failed };
}
