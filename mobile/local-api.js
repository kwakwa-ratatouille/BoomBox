// « Serveur embarqué » de l'appli mobile : remplace le serveur du PC, directement dans le téléphone.
// Il réutilise les modules du serveur (server/*.js) compilés pour le navigateur (voir scripts/build-mobile.mjs).
// Les requêtes réseau passent par le HTTP natif de Capacitor (pas de restriction CORS).
import * as yt from '../server/yt.js';
import { findLyrics, searchByLyrics } from '../server/lyrics.js';
import { discover } from '../server/discover.js';
import { resolveInput } from '../server/resolve.js';
import { askAi, pickModel } from '../server/ai.js';
import { startImport, getJob, spotifyApiToken, startMatch, syncPlaylist } from '../server/importers.js';
import { concertsFor } from '../server/spotify-stats.js';
import { Innertube, Platform } from 'youtubei.js';

// Déchiffrement des liens YouTube (repli si le client « iOS » ne suffit pas)
Platform.shim.eval = async (data, env) => {
  const props = [];
  if (env.n) props.push(`n: exportedVars.nFunction("${env.n}")`);
  if (env.sig) props.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  return new Function(`${data.output}\nreturn { ${props.join(', ')} }`)();
};
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

// État du réseau (Wi-Fi / données mobiles / hors ligne)
export const net = { connected: true, wifi: true, listeners: new Set() };
Network.getStatus().then((s) => Object.assign(net, { connected: s.connected, wifi: s.connectionType === 'wifi' })).catch(() => {});
Network.addListener('networkStatusChange', (s) => {
  Object.assign(net, { connected: s.connected, wifi: s.connectionType === 'wifi' });
  net.listeners.forEach((fn) => fn(net));
});

const cfg = JSON.parse(localStorage.getItem('boombox.cfg') || '{}');
const saveCfg = () => localStorage.setItem('boombox.cfg', JSON.stringify(cfg));

// ---------- Audio : URL de lecture YouTube puis fichier local ----------
let ytPlayer = null;
function playerYt() {
  ytPlayer ??= Innertube.create({ lang: 'fr', location: 'FR', retrieve_player: true, fetch: (...a) => fetch(...a) }).catch((e) => {
    ytPlayer = null;
    throw e;
  });
  return ytPlayer;
}

// ---------- Relais par le PC ----------
// Sur le même Wi-Fi que le PC, l'audio passe par son serveur (yt-dlp) : fiable et instantané.
// Ailleurs (4G/5G, PC éteint), le téléphone récupère l'audio lui-même (ci-dessous).
let relay = null;
export function setRelay(base) {
  relay = base || null;
}
export const getRelay = () => relay;

const urlCache = new Map();
// Chaque « client » YouTube donne des liens qui ne se téléchargent qu'en se présentant comme ce client
// (sinon YouTube répond 403) : on garde son User-Agent avec le lien.
const CLIENTS = [
  ['IOS', 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'],
  ['ANDROID', 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'],
  ['TV', 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version'],
  ['WEB_EMBEDDED', null],
  ['WEB', null],
];
async function remoteAudio(id, exclude = []) {
  const hit = urlCache.get(id);
  if (hit && hit.exp > Date.now() && !exclude.includes(hit.client)) return hit;
  const y = await playerYt();
  let lastErr = null;
  for (const [client, ua] of CLIENTS) {
    if (exclude.includes(client)) continue;
    try {
      const info = await y.getBasicInfo(id, { client });
      // Uniquement de l'AAC (M4A) : l'iPhone ne lit pas le WebM/Opus. Pas d'AAC chez ce client → client suivant.
      const aac = (info.streaming_data?.adaptive_formats || []).filter((f) => f.has_audio && !f.has_video && /audio\/mp4/.test(f.mime_type || ''));
      const fmt = aac.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (!fmt) throw new Error(`${client} : pas de format M4A`);
      const url = fmt.url || (await fmt.decipher(y.session.player));
      if (url) {
        const r = { url, client, ua: ua || navigator.userAgent, exp: Date.now() + 4 * 3600e3 };
        urlCache.set(id, r);
        return r;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Audio introuvable');
}
// Compatibilité (autres appels) : lien seul
async function remoteAudioUrl(id) {
  return (await remoteAudio(id)).url;
}

// Téléchargement vérifié : un fichier minuscule = page d'erreur de YouTube, pas un son
async function fetchTo(path, url, headers = {}) {
  await Filesystem.downloadFile({ url, path, directory: Directory.Data, recursive: true, headers });
  const stat = await Filesystem.stat({ path, directory: Directory.Data });
  if (stat.size < 30 * 1024) {
    await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
    throw new Error(`réponse invalide (${stat.size} o)`);
  }
  return stat;
}

// Index des fichiers audio présents sur le téléphone : { id: { size, at, used, keep } }
const INDEX_KEY = 'boombox.audioIndex';
export const audioIndex = JSON.parse(localStorage.getItem(INDEX_KEY) || '{}');
const saveIndex = () => localStorage.setItem(INDEX_KEY, JSON.stringify(audioIndex));
const downloads = new Map();

export function isDownloaded(id) {
  return !!audioIndex[id];
}

// Télécharge le titre sur le téléphone (une seule fois) ; keep = téléchargé volontairement (hors ligne)
export function downloadAudio(id, { keep = false } = {}) {
  if (audioIndex[id]) {
    audioIndex[id].used = Date.now();
    if (keep) audioIndex[id].keep = true;
    saveIndex();
    return Promise.resolve(audioIndex[id]);
  }
  if (downloads.has(id)) return downloads.get(id);
  const p = (async () => {
    const path = `audio/${id}.m4a`;
    await Filesystem.mkdir({ path: 'audio', directory: Directory.Data, recursive: true }).catch(() => {});
    let stat = null;
    let lastErr = null;
    // 1. Par le PC (même Wi-Fi)
    if (relay) stat = await fetchTo(path, `${relay}/api/audio-file/${id}`).catch((e) => ((lastErr = e), null));
    // 2. Directement chez YouTube, en changeant de client si l'un est refusé
    const tried = [];
    while (!stat && tried.length < 3) {
      const r = await remoteAudio(id, tried).catch((e) => ((lastErr = e), null));
      if (!r) break;
      tried.push(r.client);
      stat = await fetchTo(path, r.url, { 'User-Agent': r.ua }).catch((e) => {
        lastErr = new Error(`${r.client} : ${e.message}`);
        urlCache.delete(id);
        return null;
      });
    }
    if (!stat) throw lastErr || new Error('téléchargement impossible');
    audioIndex[id] = { size: stat.size, at: Date.now(), used: Date.now(), keep };
    saveIndex();
    pruneCache();
    return audioIndex[id];
  })().finally(() => downloads.delete(id));
  downloads.set(id, p);
  return p;
}

// stream : titre pas encore sur le téléphone et PC joignable → lecture immédiate par le PC pendant que le
// fichier se télécharge en arrière-plan (la prochaine écoute sera locale). Un lien YouTube direct ne peut pas
// être lu tel quel par le lecteur (il exige l'en-tête du client) : sans PC, on attend le fichier local.
export async function localAudioSrc(id, { stream = false } = {}) {
  if (!audioIndex[id] && !net.connected) throw new Error('Hors ligne : titre non téléchargé');
  if (stream && !audioIndex[id] && relay) {
    downloadAudio(id).catch(() => {});
    return `${relay}/api/stream/${id}`;
  }
  await downloadAudio(id);
  const { uri } = await Filesystem.getUri({ path: `audio/${id}.m4a`, directory: Directory.Data });
  return Capacitor.convertFileSrc(uri);
}

export async function deleteAudio(id) {
  if (!audioIndex[id]) return;
  await Filesystem.deleteFile({ path: `audio/${id}.m4a`, directory: Directory.Data }).catch(() => {});
  delete audioIndex[id];
  saveIndex();
}

export function storageUsed() {
  return Object.values(audioIndex).reduce((s, x) => s + (x.size || 0), 0);
}

// Respecte la limite d'espace : on supprime d'abord les titres non gardés les moins récemment écoutés
export function pruneCache(limitBytes = Number(localStorage.getItem('boombox.storageLimit') || 1024 ** 3)) {
  let used = storageUsed();
  if (used <= limitBytes) return;
  const order = Object.entries(audioIndex).sort((a, b) => (a[1].keep - b[1].keep) || (a[1].used - b[1].used));
  for (const [id, x] of order) {
    if (used <= limitBytes * 0.95) break;
    if (x.keep && used <= limitBytes) break;
    deleteAudio(id);
    used -= x.size || 0;
  }
}

async function audioBuffer(id) {
  const src = await localAudioSrc(id);
  // Fichier local : fetch normal de la WebView (le « fetch » de ce fichier est le HTTP natif)
  return (await globalThis.fetch(src)).arrayBuffer();
}

// Image en blob (pour lire les pixels de la pochette sans restriction)
async function imageBlobUrl(u) {
  const r = await fetch(u, { binary: true });
  return URL.createObjectURL(await r.blob());
}

// ---------- Routeur : mêmes chemins que le serveur du PC ----------
const analysis = JSON.parse(localStorage.getItem('boombox.analysis') || '{}');

export async function handle(path, { method = 'GET', body } = {}) {
  const u = new URL(path, 'https://local');
  const q = Object.fromEntries(u.searchParams);
  const p = u.pathname;
  let m;
  if (p === '/api/status') return { ytdlp: true, native: true, lan: [], spotifyApi: !!cfg.spotifyClientId, ai: !!cfg.geminiApiKey, aiModel: cfg.geminiModel || null };
  if (p === '/api/search') return yt.search(String(q.q || '').slice(0, 200), q.type || 'all');
  if (p === '/api/suggest') return yt.suggest(String(q.q || '').slice(0, 200));
  if ((m = p.match(/^\/api\/artist\/([\w-]+)$/))) return yt.artist(m[1]);
  if ((m = p.match(/^\/api\/album\/([\w-]+)$/))) return yt.album(m[1]);
  if ((m = p.match(/^\/api\/ytplaylist\/([\w-]+)$/))) return yt.ytPlaylist(m[1], 300);
  if ((m = p.match(/^\/api\/radio\/([\w-]+)$/))) return yt.radio(m[1]);
  if (p === '/api/lyrics') return findLyrics({ videoId: q.videoId || null, title: q.title, artist: q.artist, album: q.album, duration: q.duration });
  if (p === '/api/discover') return discover(body || {});
  if (p === '/api/resolve') {
    const t = await resolveInput(body?.input);
    if (!t) throw new Error('Titre introuvable');
    return t;
  }
  if (p === '/api/ai') return askAi(cfg, body || {});
  if (p === '/api/home') {
    const queries = (Array.isArray(body?.playlists) ? body.playlists : []).map(String).slice(0, 6);
    const [ex, ...lists] = await Promise.all([yt.explore().catch(() => ({})), ...queries.map((q) => yt.search(q, 'playlist').then((r) => r.items || []).catch(() => []))]);
    return { ...ex, playlists: Object.fromEntries(queries.map((q, k) => [q, lists[k].slice(0, 12)])) };
  }
  if (p === '/api/lyrics-search') return searchByLyrics(String(u.searchParams.get('q') || ''), (q) => yt.search(q));
  if (p === '/api/concerts') return concertsFor((Array.isArray(body?.names) ? body.names : []).map(String));
  if (p === '/api/sync') return syncPlaylist({ url: String(body?.url || ''), seen: Array.isArray(body?.seen) ? body.seen : null, have: Array.isArray(body?.have) ? body.have : [] }, cfg);
  if (p === '/api/import') return startImport(String(body?.input || ''), cfg, String(body?.name || ''));
  if (p === '/api/match') return startMatch(body?.items || [], body?.kind === 'artist' ? 'artist' : 'track');
  if ((m = p.match(/^\/api\/import\/([\w-]+)$/))) {
    const j = getJob(m[1]);
    if (!j) throw new Error('Tâche inconnue');
    return j;
  }
  if (p === '/api/releases') {
    const follows = (body?.follows || []).slice(0, 300);
    const out = [];
    const current = {};
    const thumbs = {};
    await Promise.all(follows.map(async (f) => {
      try {
        const a = await yt.artist(String(f.id), { light: true });
        const rel = [];
        for (const s of a.sections) if (/album|single|\bep\b/i.test(s.title)) for (const it of s.items) if (it.type === 'album' && !rel.some((r) => r.id === it.id)) rel.push(it);
        current[f.id] = rel.map((r) => r.id);
        if (a.thumb) thumbs[f.id] = a.thumb;
        const known = Array.isArray(f.known) ? f.known : current[f.id];
        for (const r of rel) out.push({ ...r, artist: { id: f.id, name: a.name || f.name }, isNew: !known.includes(r.id) });
      } catch {}
    }));
    out.sort((x, y) => (y.isNew - x.isNew) || (Number(y.year) || 0) - (Number(x.year) || 0));
    return { releases: out, newCount: out.filter((r) => r.isNew).length, current, thumbs };
  }
  if (p === '/api/analysis' && method === 'GET') {
    const out = {};
    for (const id of String(q.ids || '').split(',')) if (analysis[id]) out[id] = analysis[id];
    return out;
  }
  if (p === '/api/analysis' && method === 'POST') {
    Object.assign(analysis, body || {});
    localStorage.setItem('boombox.analysis', JSON.stringify(analysis));
    return { ok: true };
  }
  if ((m = p.match(/^\/api\/prefetch\/([\w-]+)$/))) {
    downloadAudio(m[1]).catch(() => {});
    return null;
  }
  if (p === '/api/config/gemini') {
    const key = String(body?.key || '').trim();
    if (!key) delete cfg.geminiApiKey;
    else Object.assign(cfg, { geminiApiKey: key, geminiModel: await pickModel(key) });
    saveCfg();
    return { ok: true, ai: !!cfg.geminiApiKey, model: cfg.geminiModel || null };
  }
  if (p === '/api/config/spotify') {
    const id = String(body?.clientId || '').trim();
    const secret = String(body?.clientSecret || '').trim();
    if (!id) delete cfg.spotifyClientId;
    else if (!(await spotifyApiToken({ spotifyClientId: id, spotifyClientSecret: secret }, true))) throw new Error('Clés refusées par Spotify');
    else Object.assign(cfg, { spotifyClientId: id, spotifyClientSecret: secret });
    saveCfg();
    return { ok: true, spotifyApi: !!cfg.spotifyClientId };
  }
  throw new Error(`Route inconnue : ${p}`);
}

export async function deleteAll() {
  for (const id of Object.keys(audioIndex)) await deleteAudio(id);
}
// Le titre ne doit plus être gardé (playlist retirée du hors ligne) : il reste en cache jusqu'à la limite
export function unkeep(id) {
  if (audioIndex[id]) (audioIndex[id].keep = false), saveIndex();
}

export const media = { localAudioSrc, audioBuffer, imageBlobUrl, downloadAudio, deleteAudio, deleteAll, unkeep, isDownloaded, storageUsed, pruneCache, audioIndex, net, setRelay, getRelay };
