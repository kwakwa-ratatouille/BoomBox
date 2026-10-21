// SoundCloud en secours : beaucoup d'artistes y publient eux-mêmes leurs sons (ex. PNL), alors que YouTube Music
// les bloque en France et que YouTube n'a parfois que des remix. yt-dlp (déjà utilisé pour YouTube) sait chercher et
// télécharger les sons publics de SoundCloud. Identifiant Boombox d'un son SoundCloud : « sc_ » + 8 caractères.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'soundcloud.json');
let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
} catch {}
let saveT = null;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFile(CACHE, JSON.stringify(cache), () => {});
  }, 1000);
};

export const isScId = (id) => /^sc_[0-9a-z]{8}$/.test(String(id));
export const scId = (num) => 'sc_' + Number(num).toString(36).padStart(8, '0');
export const scUrl = (id) => `https://api.soundcloud.com/tracks/${parseInt(String(id).slice(3), 36)}`;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const BAD = /\b(remix|nightcore|cover|slowed|sped up|speed up|reverb|instrumental|karaoke|8d|mashup|edit|live)\b/;

function ytdlp(bin, args) {
  return new Promise((resolve, reject) => execFile(bin, args, { timeout: 45e3, windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(out))));
}

// Le son officiel : publié par l'artiste (nom du compte = artiste), même titre, pas un remix
let BIN = null;
export const setScBin = (b) => (BIN = b); // chemin de yt-dlp (donné par stream.js, côté PC)
export async function scFind(bin, title, artist, duration = 0) {
  bin = bin || BIN;
  if (!bin || !title) return null;
  const key = `${norm(artist)}|${norm(title)}`;
  if (key in cache) return cache[key];
  let found = null;
  try {
    const out = await ytdlp(bin, ['--flat-playlist', '--dump-json', '--no-warnings', `scsearch8:${artist} ${title}`]);
    const hits = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    const a = norm(artist).split(' ')[0];
    const t = norm(title);
    const ok = (h) => {
      const ht = norm(h.title);
      if (!ht.includes(t) || (BAD.test(ht) && !BAD.test(t))) return false;
      if (duration && h.duration && Math.abs(h.duration - duration) > 25) return false;
      return true;
    };
    const official = hits.find((h) => ok(h) && norm(h.uploader).includes(a));
    const any = hits.find((h) => ok(h) && norm(`${h.title} ${h.uploader}`).includes(a));
    const h = official || any;
    if (h) found = { id: scId(h.id), title: h.title, uploader: h.uploader, duration: Math.round(h.duration || 0), official: !!official };
  } catch {}
  cache[key] = found;
  save();
  return found;
}

// Lien SoundCloud collé dans la recherche → son Boombox
export async function scResolve(url) {
  if (!BIN) throw new Error('Les liens SoundCloud se lisent avec Boombox ouvert sur ton PC');
  const out = await ytdlp(BIN, ['--dump-json', '--no-warnings', '--no-playlist', '--skip-download', url]);
  const j = JSON.parse(out.split('\n').find((l) => l.startsWith('{')) || '{}');
  if (!j.id) throw new Error('Son SoundCloud introuvable (est-il public ?)');
  const thumb = (j.thumbnails || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || j.thumbnail || null;
  return { id: scId(j.id), title: j.title, artists: [{ name: j.uploader || 'SoundCloud' }], album: null, duration: Math.round(j.duration || 0), thumb };
}

// Recherche SoundCloud (onglet « SoundCloud » de la recherche) : sons publics, sans les remix en premier
export async function scSearch(q, n = 15) {
  if (!BIN) return [];
  const out = await ytdlp(BIN, ['--flat-playlist', '--dump-json', '--no-warnings', `scsearch${n}:${String(q).slice(0, 100)}`]).catch(() => '');
  return out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).map((h) => {
    const thumb = (h.thumbnails || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
    return { id: scId(h.id), title: h.title, artists: [{ name: h.uploader || 'SoundCloud' }], album: null, duration: Math.round(h.duration || 0), thumb, soundcloud: true };
  });
}
