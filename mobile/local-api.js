// « Serveur embarqué » de l'appli mobile : remplace le serveur du PC, directement dans le téléphone.
// Il réutilise les modules du serveur (server/*.js) compilés pour le navigateur (voir scripts/build-mobile.mjs).
// Les requêtes réseau passent par le HTTP natif de Capacitor (pas de restriction CORS).
import * as yt from '../server/yt.js';
import { findLyrics, searchByLyrics } from '../server/lyrics.js';
import { discover } from '../server/discover.js';
import { resolveInput } from '../server/resolve.js';
import { askAi, pickModel, resolveAiResult } from '../server/ai.js';

// Mini-serveur de l'assistant IA (Cloudflare Workers) : la clé Gemini y est gardée secrète (voir cloud/ai-worker)
const AI_WORKER = 'https://boombox-ai.boombox-matis.workers.dev';
import { startImport, getJob, spotifyApiToken, startMatch, syncPlaylist } from '../server/importers.js';
import { concertsFor, searchSpotifyUsers, spotifyUserProfile } from '../server/spotify-stats.js';
import { Innertube, Platform } from 'youtubei.js';
import { poTokens } from './potoken.js';

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

setTimeout(() => playerYt().catch(() => {}), 4000);

// ---------- Relais par le PC ----------
// Sur le même Wi-Fi que le PC, l'audio passe par son serveur (yt-dlp) : fiable et instantané.
// Ailleurs (4G/5G, PC éteint), le téléphone récupère l'audio lui-même (ci-dessous).
let relay = null;
let relayK = null; // clé du tunnel Internet (le réseau local n'en a pas besoin)
export function setRelay(base, key = null) {
  relay = base || null;
  relayK = base ? key : null;
}
const relayUrl = (p) => `${relay}${p}${relayK ? `?k=${encodeURIComponent(relayK)}` : ''}`;
export const getRelay = () => relay;

const urlCache = new Map();
// Chaque « client » YouTube donne des liens qui ne se téléchargent qu'en se présentant comme ce client
// (sinon YouTube répond 403) : on garde son User-Agent avec le lien.
const CLIENTS = [
  ['IOS', 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'],
  ['ANDROID', 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'],
  ['YTMUSIC_ANDROID', 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14) gzip'],
  ['TV_EMBEDDED', 'Mozilla/5.0 (PlayStation; PlayStation 4/12.02) AppleWebKit/605.1.15 (KHTML, like Gecko)'],
  ['TV', 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version'],
  ['MWEB', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1'],
  ['WEB_EMBEDDED', null],
  ['WEB', null],
];
// Clients web : YouTube exige un jeton « PO token » (généré dans le téléphone, voir potoken.js)
const WEB_CLIENTS = new Set(['MWEB', 'WEB', 'WEB_EMBEDDED']);
async function resolveClient(y, id, client, ua) {
  let tokens = null;
  if (WEB_CLIENTS.has(client)) tokens = await poTokens(y, id).catch(() => null);
  const info = await y.getBasicInfo(id, tokens ? { client, po_token: tokens.player } : { client });
  // Uniquement de l'AAC (M4A) : l'iPhone ne lit pas le WebM/Opus. Pas d'AAC chez ce client → client suivant.
  const aac = (info.streaming_data?.adaptive_formats || []).filter((f) => f.has_audio && !f.has_video && /audio\/mp4/.test(f.mime_type || ''));
  const fmt = aac.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  if (!fmt) throw new Error(`pas de format M4A (${info.playability_status?.status || '?'})`);
  if (tokens && y.session.player) y.session.player.po_token = tokens.gvs;
  let url = fmt.url || (await fmt.decipher(y.session.player));
  if (url && tokens && !/[?&]pot=/.test(url)) url += `&pot=${encodeURIComponent(tokens.gvs)}`;
  if (!url) throw new Error('aucun lien');
  return { url, client, ua: ua || navigator.userAgent, withToken: !!tokens, size: Number(fmt.content_length) || 0, exp: Date.now() + 4 * 3600e3 };
}
async function remoteAudio(id, exclude = []) {
  const hit = urlCache.get(id);
  if (hit && hit.exp > Date.now() && !exclude.includes(hit.client)) return hit;
  const y = await playerYt();
  let lastErr = null;
  const all = []; // erreur de chaque client, jointe au rapport « Lecture impossible »
  const good = localStorage.getItem('boombox.ytClient');
  const order = [...CLIENTS].sort((a, b) => (b[0] === good) - (a[0] === good));
  for (const [client, ua] of order) {
    if (exclude.includes(client)) continue;
    try {
      const r = await resolveClient(y, id, client, ua);
      urlCache.set(id, r);
      return r;
    } catch (e) {
      lastErr = new Error(`${client} : ${e.message}`);
      all.push(lastErr.message);
    }
  }
  throw Object.assign(lastErr || new Error('Audio introuvable'), { all });
}
// Compatibilité (autres appels) : lien seul
async function remoteAudioUrl(id) {
  return (await remoteAudio(id)).url;
}

// Diagnostic (Paramètres → Diagnostic lecture) : teste chaque étape et l'écrit à l'écran
export async function diagnose(id, log) {
  log(`Réseau : ${net.connected ? (net.wifi ? 'Wi-Fi' : 'données mobiles') : 'hors ligne'}`);
  log(`PC relais : ${relay || 'non trouvé'}`);
  let y;
  try {
    const t = Date.now();
    y = await playerYt();
    log(`YouTube (Innertube) : OK en ${Date.now() - t} ms`);
  } catch (e) {
    return log(`YouTube (Innertube) : ÉCHEC ${String(e?.message || e).slice(0, 120)}`);
  }
  // Android : yt-dlp embarqué dans l'appli
  if (androidYtdlp()) {
    const t = Date.now();
    try {
      const st = await ytdlpDownload(id, 'diag-ytdlp.m4a');
      log(`yt-dlp (Android) : OK ${Math.round(st.size / 1024)} Ko en ${Date.now() - t} ms`);
      await Filesystem.deleteFile({ path: 'diag-ytdlp.m4a', directory: Directory.Data }).catch(() => {});
    } catch (e) {
      log(`yt-dlp (Android) : ÉCHEC ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  // Jeton BotGuard (clients web)
  try {
    const t = Date.now();
    await poTokens(y, id);
    log(`Jeton BotGuard (PO token) : OK en ${Date.now() - t} ms`);
  } catch (e) {
    log(`Jeton BotGuard (PO token) : ÉCHEC ${String(e?.message || e).slice(0, 120)}`);
  }
  for (const [client, ua] of CLIENTS) {
    try {
      const r = await resolveClient(y, id, client, ua);
      const path = `diag-${client}.m4a`;
      const t = Date.now();
      try {
        const st = await fetchTo(path, r.url, { 'User-Agent': r.ua });
        log(`${client}${r.withToken ? ' (jeton)' : ''} : téléchargement OK ${Math.round(st.size / 1024)} Ko en ${Date.now() - t} ms`);
        await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
      } catch (e) {
        log(`${client}${r.withToken ? ' (jeton)' : ''} : lien OK, téléchargement ÉCHEC ${String(e?.message || e).slice(0, 90)}`);
      }
    } catch (e) {
      log(`${client} : ÉCHEC ${String(e?.message || e).slice(0, 120)}`);
    }
  }
}

// ---------- Android : yt-dlp embarqué (module natif BoomboxNative) ----------
const nativePlugin = () => globalThis.Capacitor?.Plugins?.BoomboxNative;
const androidYtdlp = () => Capacitor.getPlatform() === 'android' && !!nativePlugin()?.ytdlpDownload;
async function ytdlpDownload(id, path) {
  await nativePlugin().ytdlpDownload({ id, path });
  const stat = await Filesystem.stat({ path, directory: Directory.Data });
  if (stat.size < 30 * 1024) throw new Error(`fichier invalide (${stat.size} o)`);
  return stat;
}

// ---------- SoundCloud sans PC (mini-serveur Boombox en ligne) ----------
async function scWorker(path) {
  const token = await globalThis.__bbIdToken?.().catch(() => null);
  const r = await fetch(`${AI_WORKER}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `serveur ${r.status}`);
  return j;
}
const toB64 = (u8) => {
  let out = '';
  for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(out);
};
async function scDownload(id, path) {
  const st = await scWorker(`/sc/stream?id=${id}`);
  let parts = [];
  if (st.protocol === 'progressive') {
    parts = [new Uint8Array(await (await fetch(st.url)).arrayBuffer())];
  } else {
    // HLS : segment d'initialisation (EXT-X-MAP) + morceaux, mis bout à bout = un fichier audio complet
    const list = await (await fetch(st.url)).text();
    const base = st.url.replace(/[^/]*(\?.*)?$/, '');
    const abs = (u) => (/^https?:/.test(u) ? u : base + u);
    const urls = [];
    const map = list.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (map) urls.push(abs(map[1]));
    for (const line of list.split('\n').map((l) => l.trim())) if (line && !line.startsWith('#')) urls.push(abs(line));
    if (!urls.length) throw new Error('liste vide');
    for (let k = 0; k < urls.length; k += 6) {
      const got = await Promise.all(urls.slice(k, k + 6).map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));
      parts.push(...got);
    }
  }
  const size = parts.reduce((n, p) => n + p.length, 0);
  if (size < 30 * 1024) throw new Error('son vide');
  const all = new Uint8Array(size);
  let o = 0;
  for (const p of parts) (all.set(p, o), (o += p.length));
  await Filesystem.writeFile({ path, data: toB64(all), directory: Directory.Data, recursive: true });
  return { size };
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

// YouTube bride un lien téléchargé d'un seul coup à la vitesse de lecture (un son de 3 min prenait ~3 min, même
// en Wi-Fi) : on le télécharge en morceaux de 1 Mo (paramètre range=), 4 à la fois, puis on les recolle.
const CHUNK = 1024 * 1024;
async function fetchChunked(path, url, headers, size) {
  if (!size) return fetchTo(path, url, headers);
  const parts = [];
  for (let a = 0; a < size; a += CHUNK) parts.push([a, Math.min(size, a + CHUNK) - 1]);
  const queue = parts.map((p, i) => i);
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let i; (i = queue.shift()) !== undefined; ) {
      const [a, b] = parts[i];
      await Filesystem.downloadFile({ url: `${url}&range=${a}-${b}`, path: `${path}.p${i}`, directory: Directory.Data, recursive: true, headers });
    }
  })).catch(async (e) => {
    await Promise.all(parts.map((p, i) => Filesystem.deleteFile({ path: `${path}.p${i}`, directory: Directory.Data }).catch(() => {})));
    throw e;
  });
  for (let i = 0; i < parts.length; i++) {
    const { data } = await Filesystem.readFile({ path: `${path}.p${i}`, directory: Directory.Data });
    await (i ? Filesystem.appendFile : Filesystem.writeFile)({ path, data, directory: Directory.Data });
    await Filesystem.deleteFile({ path: `${path}.p${i}`, directory: Directory.Data }).catch(() => {});
  }
  const stat = await Filesystem.stat({ path, directory: Directory.Data });
  if (Math.abs(stat.size - size) > 1024) {
    await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
    throw new Error(`fichier incomplet (${stat.size}/${size} o)`);
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
// Infos des sons (titre, artiste, durée) : servent au repli sur SoundCloud quand YouTube refuse
const trackMeta = new Map();
export function rememberMeta(t) {
  if (t?.id && t.title) trackMeta.set(t.id, { title: t.title, artist: (t.artists || [])[0]?.name || '', duration: t.duration || 0 });
}
const normTxt = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)|\[.*?\]|feat\.?.*$|ft\..*$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Même son sur SoundCloud : titre qui correspond, artiste présent, durée proche (si connue)
async function scTwin(meta) {
  return (await scTwinFor(meta, `${meta.artist} ${meta.title}`)) || scTwinFor(meta, meta.title);
}
async function scTwinFor(meta, q) {
  const list = await scWorker(`/sc/search?q=${encodeURIComponent(q)}`).catch(() => []);
  const t = normTxt(meta.title);
  const a = normTxt(meta.artist).split(' ')[0];
  return (list || []).find((x) => {
    const xt = normTxt(x.title);
    const xa = normTxt((x.artists || [])[0]?.name);
    const titleOk = xt === t || xt.includes(t) || t.includes(xt);
    const artistOk = !a || xa.includes(a) || xt.includes(a);
    const durOk = !meta.duration || !x.duration || Math.abs(x.duration - meta.duration) < 15;
    return titleOk && artistOk && durOk;
  }) || null;
}

// Autre version YouTube Music du même son (clip, audio, réédition…) quand la fiche enregistrée ne se lit plus
async function ytTwin(id, meta) {
  const r = await yt.search(`${meta.artist} ${meta.title}`, 'song');
  const t = normTxt(meta.title);
  const a = normTxt(meta.artist).split(' ')[0];
  return (r?.songs || r?.items || []).find((x) => {
    if (!x?.id || x.id === id) return false;
    const xt = normTxt(x.title);
    const xa = normTxt((x.artists || []).map((z) => z.name).join(' '));
    return (xt === t || xt.includes(t) || t.includes(xt)) && (!a || xa.includes(a)) && (!meta.duration || !x.duration || Math.abs(x.duration - meta.duration) < 20);
  })?.id || null;
}

// Dernier échec de téléchargement de chaque son : liste des essais ratés (rapport de bug du lecteur)
const failTrails = new Map();
export const failTrail = (id) => (failTrails.get(id) || []).join(' / ');

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
    // Chaque essai raté (PC, chaque client YouTube, SoundCloud…), joint au rapport « Lecture impossible »
    const trail = [];
    const fail = (e) => {
      trail.push(...(e?.all?.length ? e.all : [String(e?.message || e)]));
      lastErr = e;
      return null;
    };
    // 1. Par le PC (même Wi-Fi)
    if (relay) stat = await fetchTo(path, relayUrl(`/api/audio-file/${id}`)).catch((e) => fail(e));
    // 2. SoundCloud (sans PC) : le mini-serveur donne le lien, le téléphone télécharge directement chez SoundCloud
    if (!stat && /^sc_/.test(id)) stat = await scDownload(id, path).catch((e) => fail(new Error(`SoundCloud : ${e.message}`)));
    if (/^sc_/.test(id)) {
      if (!stat) throw Object.assign(lastErr || new Error('SoundCloud indisponible'), { trail });
      audioIndex[id] = { size: stat.size, at: Date.now(), used: Date.now(), keep };
      saveIndex();
      pruneCache();
      return audioIndex[id];
    }
    // 2. Directement chez YouTube, en changeant de client si l'un est refusé. Android : yt-dlp d'abord s'il est
    // le seul à avoir marché la dernière fois, et 2 clients seulement avant de passer à lui (il est plus sûr)
    const ytdlp = androidYtdlp();
    const viaYtdlp = () => ytdlpDownload(id, path).then((st) => (localStorage.setItem('boombox.ytClient', 'ytdlp'), st)).catch((e) => fail(new Error(`yt-dlp : ${e.message}`)));
    if (!stat && ytdlp && localStorage.getItem('boombox.ytClient') === 'ytdlp') stat = await viaYtdlp();
    const tried = [];
    while (!stat && tried.length < (ytdlp ? 2 : 5)) {
      const r = await remoteAudio(id, tried).catch((e) => fail(e));
      if (!r) break;
      tried.push(r.client);
      stat = await fetchChunked(path, r.url, { 'User-Agent': r.ua }, r.size).catch((e) => {
        urlCache.delete(id);
        return fail(new Error(`${r.client} : téléchargement ${e.message}`));
      });
      if (stat) localStorage.setItem('boombox.ytClient', r.client);
    }
    // 3. Android : yt-dlp embarqué, en secours (fiable mais lent à démarrer : Python est relancé à chaque son)
    if (!stat && ytdlp && localStorage.getItem('boombox.ytClient') !== 'ytdlp') stat = await viaYtdlp();
    // 3 bis. Cette version est bloquée chez YouTube (« +18 », compte exigé…) : une autre mise en ligne du même son
    if (!stat) {
      const m = trackMeta.get(id);
      const alts = await yt.alternatives(id, m && { title: m.title, artist: m.artist, duration: m.duration }).catch(() => []);
      const twin = m && (await ytTwin(id, m).catch(() => null));
      for (const alt of [...new Set([...alts, twin].filter(Boolean))].slice(0, 3)) {
        const r = await remoteAudio(alt).catch((e) => fail(e));
        if (r) stat = await fetchChunked(path, r.url, { 'User-Agent': r.ua }, r.size).catch((e) => fail(e));
        if (stat) break;
      }
    }
    // 4. YouTube refuse (fréquent sans PC, surtout sur iPhone) : le même son sur SoundCloud
    if (!stat && trackMeta.has(id)) {
      const twin = await scTwin(trackMeta.get(id)).catch(() => null);
      if (twin) stat = await scDownload(twin.id, path).catch((e) => fail(new Error(`SoundCloud : ${e.message}`)));
      else trail.push('SoundCloud : aucun équivalent');
    } else if (!stat) trail.push('SoundCloud : infos du son absentes');
    if (!stat) {
      failTrails.set(id, trail);
      throw Object.assign(lastErr || new Error('téléchargement impossible'), { trail });
    }
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
export async function localAudioSrc(id, { stream = false, low = false } = {}) {
  if (!audioIndex[id] && !net.connected) throw new Error('Hors ligne : titre non téléchargé');
  if (stream && !audioIndex[id] && relay) {
    downloadAudio(id).catch(() => {});
    return relayUrl(`/api/stream/${id}${low ? '?q=low' : ''}`);
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
export function pruneCache(limitBytes = Number(localStorage.getItem('boombox.storageLimit') || 5 * 1024 ** 3)) {
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
  // IA disponible : clé du téléphone, ou celle du PC par le relais (vérifié au moment de la question)
  if (p === '/api/status') return { ytdlp: true, native: true, lan: [], spotifyApi: !!cfg.spotifyClientId, ai: true, aiViaPc: !cfg.geminiApiKey, aiModel: cfg.geminiModel || null };
  if (p === '/api/search') return yt.search(String(q.q || '').slice(0, 200), q.type || 'all');
  if (p === '/api/suggest') return yt.suggest(String(q.q || '').slice(0, 200));
  if ((m = p.match(/^\/api\/artist\/([\w-]+)$/))) return yt.artist(m[1]);
  if ((m = p.match(/^\/api\/album\/([\w-]+)$/))) return yt.album(m[1]);
  if ((m = p.match(/^\/api\/discography\/([\w-]+)$/))) return yt.discography(m[1]);
  if (p === '/api/new-releases') return yt.newReleases();
  if (p === '/api/soundcloud/search') {
    if (!relay) return scWorker(`/sc/search?q=${encodeURIComponent(q.q || '')}`).catch(() => []);
    const r = await fetch(`${relay}/api/soundcloud/search?q=${encodeURIComponent(q.q || '')}${relayK ? `&k=${encodeURIComponent(relayK)}` : ''}`).catch(() => null);
    const list = r?.ok ? await r.json().catch(() => []) : [];
    return list.map((t) => ({ ...t, thumb: t.thumb }));
  }
  if (p === '/api/spotify/users') return searchSpotifyUsers(String(q.q || ''));
  if ((m = p.match(/^\/api\/spotify\/user\/([\w.-]+)$/))) return spotifyUserProfile(m[1]);
  if ((m = p.match(/^\/api\/ytplaylist\/([\w-]+)$/))) return yt.ytPlaylist(m[1], 300);
  if ((m = p.match(/^\/api\/radio\/([\w-]+)$/))) return yt.radio(m[1]);
  if (p === '/api/lyrics') return findLyrics({ videoId: q.videoId || null, title: q.title, artist: q.artist, album: q.album, duration: q.duration });
  if (p === '/api/discover') return discover(body || {});
  if (p === '/api/resolve') {
    const t = await resolveInput(body?.input);
    if (!t) throw new Error('Titre introuvable');
    return t;
  }
  if (p === '/api/ai') {
    // 1. Clé propre au téléphone ; 2. mini-serveur Cloudflare (clé secrète côté serveur, limites par personne) ;
    // 3. l'IA de ton PC par le relais. Aucune clé n'est jamais mise dans l'appli.
    if (cfg.geminiApiKey) return askAi(cfg, body || {});
    const token = await globalThis.__bbIdToken?.().catch(() => null);
    if (token) {
      try {
        const r = await fetch(AI_WORKER, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body || {}) });
        const data = await r.json().catch(() => ({}));
        if (r.ok) return resolveAiResult(data);
        if (r.status === 429 || !relay) throw new Error(data.error || `Assistant IA : erreur ${r.status}`);
      } catch (e) {
        if (!relay) throw e;
      }
    }
    if (!relay) throw new Error("L'assistant IA est injoignable pour le moment : vérifie ta connexion et réessaie.");
    const r = await fetch(relayUrl('/api/ai'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `IA du PC : erreur ${r.status}`);
    return data;
  }
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

export const media = { rememberMeta, failTrail, localAudioSrc, audioBuffer, imageBlobUrl, downloadAudio, deleteAudio, deleteAll, unkeep, isDownloaded, storageUsed, pruneCache, audioIndex, net, setRelay, getRelay, diagnose };
