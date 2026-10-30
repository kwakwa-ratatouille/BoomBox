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
  return new Promise((resolve, reject) => execFile(bin, args, { timeout: 45e3, windowsHide: process.platform !== 'win32' || !process.stdout.isTTY, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(out))));
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
  // API SoundCloud d'abord : elle indique les sons réservés aux abonnés Go+ (extraits de 30 s), qu'on écarte
  const [api, album] = await Promise.all([
    scApi(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(String(q).slice(0, 100))}&limit=${n}`).catch(() => null),
    scAlbumTracks(String(q).slice(0, 100), scApi).catch(() => []),
  ]);
  if (api?.collection) {
    const seenA = new Set(album.map((t) => t.id));
    return [...album, ...api.collection.filter((t) => t.streamable !== false && t.policy !== 'SNIP' && t.policy !== 'BLOCK' && !seenA.has(scId(t.id))).map((t) => ({
      id: scId(t.id), title: t.title, artists: [{ name: t.user?.username || 'SoundCloud' }], album: null,
      duration: Math.round((t.full_duration || t.duration || 0) / 1000), thumb: (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t500x500') || null, soundcloud: true,
    }))];
  }
  // Secours : recherche par yt-dlp
  const out = await ytdlp(BIN, ['--flat-playlist', '--dump-json', '--no-warnings', `scsearch${n}:${String(q).slice(0, 100)}`]).catch(() => '');
  const found = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).map((h) => {
    const thumb = (h.thumbnails || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
    return { id: scId(h.id), title: h.title, artists: [{ name: h.uploader || 'SoundCloud' }], album: null, duration: Math.round(h.duration || 0), thumb, soundcloud: true };
  });
  // Sons de l'album trouvé d'abord, puis les autres résultats (sans doublons)
  const seen = new Set(album.map((t) => t.id));
  return [...album, ...found.filter((t) => !seen.has(t.id))];
}

// ---------- Albums SoundCloud (sets) ----------
const SC_UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const scWords = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
async function scAlbumTracks(q, api) {
  const qw = new Set(scWords(q));
  if (qw.size < 2) return [];
  const r = await api(`https://api-v2.soundcloud.com/search/playlists?q=${encodeURIComponent(q)}&limit=8`).catch(() => null);
  // Meilleur album : la plupart des mots de son titre sont dans la recherche
  const best = (r?.collection || [])
    .map((p) => {
      const tw = scWords(p.title);
      return { p, score: tw.length ? tw.filter((w) => qw.has(w)).length / tw.length : 0 };
    })
    .filter((x) => x.score >= 0.75)
    .sort((a, b) => b.score - a.score)[0]?.p;
  if (!best) return [];
  const full = await api(`https://api-v2.soundcloud.com/playlists/${best.id}`).catch(() => null);
  let tracks = full?.tracks || [];
  // Les sons au-delà des premiers ne sont que des numéros : on demande le reste
  const missing = tracks.filter((t) => !t.title).map((t) => t.id);
  if (missing.length) {
    const more = await api(`https://api-v2.soundcloud.com/tracks?ids=${missing.slice(0, 50).join(',')}`).catch(() => []);
    const byId = new Map((more || []).map((t) => [t.id, t]));
    tracks = tracks.map((t) => (t.title ? t : byId.get(t.id))).filter(Boolean);
  }
  const art = (best.artwork_url || '').replace('-large', '-t500x500') || null;
  return tracks.filter((t) => t.streamable !== false).map((t) => ({
    id: 'sc_' + Number(t.id).toString(36).padStart(8, '0'), title: t.title, artists: [{ name: t.user?.username || best.user?.username || 'SoundCloud' }],
    album: { name: best.title }, duration: Math.round((t.full_duration || t.duration || 0) / 1000), thumb: (t.artwork_url || '').replace('-large', '-t500x500') || art, soundcloud: true,
  }));
}

// Identifiant public du lecteur web de SoundCloud (lu dans ses scripts, gardé 12 h)
let scCid = null;
let scCidAt = 0;
async function scClientId(fresh = false) {
  if (scCid && !fresh && Date.now() - scCidAt < 12 * 3600e3) return scCid;
  const home = await (await fetch('https://soundcloud.com/', { headers: SC_UA })).text();
  const scripts = [...home.matchAll(/<script crossorigin src="([^"]+\.js)"/g)].map((m) => m[1]).reverse();
  for (const src of scripts) {
    const m = (await (await fetch(src, { headers: SC_UA })).text()).match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (m) return ((scCidAt = Date.now()), (scCid = m[1]));
  }
  throw new Error('SoundCloud indisponible');
}
async function scApi(url) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}client_id=${await scClientId(i > 0)}`, { headers: SC_UA, signal: AbortSignal.timeout(10000) });
    if (r.status === 401 || r.status === 403) continue;
    if (!r.ok) throw new Error(`SoundCloud ${r.status}`);
    return r.json();
  }
  throw new Error('SoundCloud refuse la demande');
}

// Nombre d'écoutes de sons SoundCloud (« 1,2 M »), pour les sons d'album remplacés par leur version SoundCloud
export async function scPlayCounts(ids) {
  const nums = ids.map((id) => parseInt(String(id).replace(/^sc_/, ''), 36)).filter(Boolean);
  if (!nums.length) return {};
  const list = await scApi(`https://api-v2.soundcloud.com/tracks?ids=${nums.slice(0, 50).join(',')}`).catch(() => []);
  const fmt = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
  return Object.fromEntries((list || []).filter((t) => t.playback_count != null).map((t) => [scId(t.id), fmt.format(t.playback_count)]));
}
