// Accès à YouTube / YouTube Music via youtubei.js (pas de clé API nécessaire).
import { Innertube, Log } from 'youtubei.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyArtistStats, artistStatsPending } from './spotify-stats.js';

Log.setLevel(Log.Level.NONE);

let ytPromise = null;
let ytBorn = 0;
function getYt() {
  // La session YouTube vieillit (erreurs 403 au bout de quelques heures) : on la renouvelle toutes les 3 h
  if (ytPromise && Date.now() - ytBorn > 3 * 3600e3) ytPromise = null;
  if (!ytPromise) {
    ytBorn = Date.now();
    // fetch passé explicitement : dans l'appli mobile, c'est le HTTP natif (voir mobile/shims/native-fetch.js)
    ytPromise = Innertube.create({ lang: 'fr', location: 'FR', retrieve_player: false, fetch: (...a) => fetch(...a) }).catch((e) => {
      ytPromise = null;
      throw e;
    });
  }
  return ytPromise;
}

export const resetYt = () => (ytPromise = null);

// Auditeurs mensuels arrondis de YouTube Music, gardés une semaine sur le disque (secours si Spotify ne
// connaît pas l'artiste ; les chiffres exacts viennent de spotify-stats.js)
const STATS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache', 'stats.json');
let stats = { listeners: {} };
try {
  stats = { listeners: {}, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) };
} catch {}
let statsTimer = null;
function saveStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats));
  }, 2000);
}

// Petit cache mémoire pour éviter de spammer YouTube.
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  let value;
  try {
    value = await fn();
  } catch (e) {
    // Session refusée par YouTube (403 / 401) : nouvelle session et un second essai
    if (!/status code (403|401)/.test(e?.message || '')) throw e;
    ytPromise = null;
    value = await fn();
  }
  // Un résultat incomplet (requête secondaire en échec) n'est gardé que 5 minutes
  cache.set(key, { value, exp: Date.now() + (value?._partial ? 5 * 60e3 : ttlMs) });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return value;
}

const txt = (v) => (v == null ? '' : typeof v === 'string' ? v : v.text ?? v.toString?.() ?? '');

function upscale(url) {
  if (!url) return null;
  if (url.startsWith('//')) url = 'https:' + url;
  return url
    .replace(/=w\d+-h\d+[^&?/]*/, '=w544-h544-l90-rj')
    .replace(/=s\d+[^&?/]*/, '=s544')
    .replace(/\/(default|mqdefault|sddefault)\.jpg/, '/hqdefault.jpg');
}

export function thumbOf(item) {
  let t = item?.thumbnails ?? item?.thumbnail ?? item?.thumbnail_renderer ?? [];
  if (t && !Array.isArray(t)) t = t.contents ?? t.thumbnails ?? t.thumbnail ?? [];
  if (t && !Array.isArray(t)) t = [];
  if (!t.length) return null;
  const best = t.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a));
  return upscale(best.url);
}

function artistsOf(item) {
  if (Array.isArray(item.artists) && item.artists.length) {
    return item.artists.map((a) => ({ name: a.name, id: a.channel_id || a.endpoint?.payload?.browseId || null }));
  }
  if (Array.isArray(item.authors) && item.authors.length) {
    return item.authors.map((a) => ({ name: a.name, id: a.channel_id || null }));
  }
  if (item.author) {
    if (typeof item.author === 'string') return [{ name: item.author, id: null }];
    return [{ name: item.author.name, id: item.author.channel_id || item.author.id || null }];
  }
  return [];
}

function durationOf(item) {
  if (typeof item.duration === 'number') return item.duration;
  if (item.duration?.seconds) return item.duration.seconds;
  const s = txt(item.duration ?? item.length_text);
  if (!s) return 0;
  return s.split(':').reduce((acc, n) => acc * 60 + (parseInt(n, 10) || 0), 0);
}

export function normTrack(item, fallback = {}) {
  const id = item.video_id || item.id || item.endpoint?.payload?.videoId;
  if (!id || id.length !== 11) return null;
  const artists = artistsOf(item);
  return {
    id,
    title: txt(item.title) || txt(item.name) || 'Sans titre',
    artists: artists.length ? artists : fallback.artists || [],
    album: item.album?.id || item.album?.name ? { id: item.album.id || null, name: item.album.name } : fallback.album || null,
    duration: durationOf(item) || fallback.duration || 0,
    thumb: thumbOf(item) || fallback.thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    video: item.item_type === 'video' || undefined,
  };
}

function normAlbum(item) {
  const id = item.id || item.endpoint?.payload?.browseId;
  if (!id) return null;
  const sub = txt(item.subtitle);
  return {
    type: 'album',
    id,
    title: txt(item.title) || txt(item.name),
    year: item.year || (sub.match(/\b(19|20)\d{2}\b/) || [])[0] || '',
    kind: /single/i.test(sub) ? 'Single' : /\bEP\b/.test(sub) ? 'EP' : 'Album',
    artists: artistsOf(item),
    thumb: thumbOf(item),
  };
}

function normArtist(item) {
  const id = item.id || item.channel_id || item.endpoint?.payload?.browseId;
  if (!id) return null;
  return {
    type: 'artist',
    id,
    name: txt(item.name) || txt(item.title) || txt(item.author?.name),
    thumb: thumbOf(item),
    subscribers: txt(item.subscribers) || txt(item.subtitle) || '',
  };
}

function normPlaylist(item) {
  const id = item.id || item.endpoint?.payload?.browseId;
  if (!id) return null;
  return {
    type: 'playlist',
    id: id.replace(/^VL/, ''),
    title: txt(item.title) || txt(item.name),
    author: txt(item.author?.name) || txt(item.author) || txt(item.subtitle),
    thumb: thumbOf(item),
  };
}

function normAny(item) {
  switch (item.item_type) {
    case 'song':
    case 'video':
      return normTrack(item) && { type: item.item_type, ...normTrack(item) };
    case 'album':
      return normAlbum(item);
    case 'artist':
      return normArtist(item);
    case 'playlist':
      return normPlaylist(item);
    default:
      return null;
  }
}

function collectItems(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collectItems(n, out));
    return out;
  }
  if (node.item_type) out.push(node);
  if (node.contents) collectItems(node.contents, out);
  return out;
}

// Carte « Meilleur résultat » de YouTube Music (artiste, album ou titre)
function topCard(s) {
  const ep = s.title?.endpoint?.payload || s.on_tap?.payload || {};
  const pageType = ep.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
  const title = txt(s.title);
  const sub = txt(s.subtitle);
  const thumb = thumbOf(s);
  if (pageType.includes('ARTIST')) return { type: 'artist', id: ep.browseId, name: title, thumb, subscribers: sub };
  if (pageType.includes('ALBUM')) return { type: 'album', id: ep.browseId, title, thumb, year: '', kind: 'Album', artists: [{ name: sub.split('•').pop().trim(), id: null }] };
  if (ep.videoId) {
    const parts = sub.split('•').map((x) => x.trim());
    return { type: 'song', id: ep.videoId, title, thumb, artists: [{ name: parts[1] || parts[0] || '', id: null }], album: null, duration: 0 };
  }
  return null;
}

export async function search(q, type = 'all') {
  return cached(`s:${type}:${q}`, 10 * 60e3, async () => {
    const yt = await getYt();
    if (type === 'all') {
      const res = await yt.music.search(q);
      const top = [];
      const buckets = { songs: [], videos: [], albums: [], artists: [], playlists: [] };
      for (const section of res.contents || []) {
        if (section.type === 'MusicCardShelf') {
          const t = topCard(section);
          if (t) top.push(t);
          if (t?.type === 'artist') buckets.artists.push(t);
          // Les titres du « meilleur résultat » passent en tête de liste
          for (const it of collectItems(section.contents)) {
            const n = normAny(it);
            if (n?.type !== 'song' || buckets.songs.some((x) => x.id === n.id)) continue;
            if (!n.artists.length && t?.type === 'artist') n.artists = [{ name: t.name, id: t.id }];
            buckets.songs.push(n);
          }
          continue;
        }
        for (const it of collectItems(section.contents)) {
          const n = normAny(it);
          if (!n) continue;
          const key = { song: 'songs', video: 'videos', album: 'albums', artist: 'artists', playlist: 'playlists' }[n.type];
          if (key && !buckets[key].some((x) => x.id === n.id)) buckets[key].push(n);
        }
      }
      return { top: top[0] || buckets.artists[0] || buckets.songs[0] || null, ...buckets };
    }
    const res = await yt.music.search(q, { type });
    const shelf = (res.contents || []).find((c) => c.type === 'MusicShelf');
    let items = collectItems(shelf?.contents || []).map(normAny).filter(Boolean);
    return { items };
  });
}

export async function suggest(q) {
  return cached(`sg:${q}`, 30 * 60e3, async () => {
    const yt = await getYt();
    const res = await yt.music.getSearchSuggestions(q);
    const out = [];
    for (const section of res || []) {
      for (const it of section.contents || []) {
        const t = txt(it.suggestion) || txt(it.title);
        if (t && !out.includes(t)) out.push(t);
      }
    }
    return out.slice(0, 8);
  });
}

// light : version rapide sans le top 10 complet ni les auditeurs (utilisée par la Découverte)
export async function artist(id, opts = {}) {
  const a = await artistPage(id, opts);
  if (opts.light) return a;
  // Chiffres exacts de Spotify (auditeurs mensuels, écoutes) : ceux déjà connus, les autres arrivent en arrière-plan
  const out = applyArtistStats({ ...a, topTracks: a.topTracks.map((t) => ({ ...t })) });
  out.statsPending = artistStatsPending(out) || undefined;
  return out;
}
async function artistPage(id, { light = false } = {}) {
  return cached(`a:${id}:${light ? 'l' : 'f'}`, 60 * 60e3, async () => {
    const yt = await getYt();
    const a = await yt.music.getArtist(id);
    const h = a.header || {};
    const sections = [];
    let topTracks = [];
    let topPlaylist = null;
    for (const s of a.sections || []) {
      const title = txt(s.header?.title) || txt(s.title);
      const items = collectItems(s.contents);
      if (s.type === 'MusicShelf') {
        // Nombre de lectures affiché par YouTube Music (« 61 M lectures »)
        topTracks = items.map((i) => { const t = normTrack(i); if (t) t.plays = playsOf(i); return t; }).filter(Boolean);
        topPlaylist = s.endpoint?.payload?.browseId?.replace(/^VL/, '') || null;
        continue;
      }
      const norm = items.map(normAny).filter(Boolean);
      if (norm.length) sections.push({ title, items: norm });
    }
    const name = txt(h.title) || txt(h.name);
    const thumb = thumbOf(h) || thumbOf(h.thumbnail);
    // Top 10 : on complète les 5 titres phares avec la playlist « Top titres » de l'artiste
    const name0 = txt(h.title) || txt(h.name);
    // Top 10 et auditeurs mensuels récupérés en parallèle
    const [more, searchRes] = light
      ? [null, null]
      : await Promise.all([
          topPlaylist && topTracks.length < 10 ? withTimeout(ytPlaylist(topPlaylist, 20), 9000).catch(() => null) : null,
          withTimeout(getYt().then((y) => y.music.search(name0)), 6000).catch(() => null),
        ]);
    let partial = !light && topPlaylist && topTracks.length < 10 && !more;
    for (const t of more?.tracks || []) {
      if (topTracks.length >= 10) break;
      if (!topTracks.some((x) => x.id === t.id)) topTracks.push(t);
    }
    for (const t of topTracks) if (!t.artists.length) t.artists = [{ name, id }];
    // Auditeurs mensuels : affichés dans la carte « Meilleur résultat » de la recherche
    // (gardés une semaine sur le disque : affichés même si la recherche échoue)
    let listeners = '';
    if (searchRes) try {
      const card = (searchRes.contents || []).find((c) => c.type === 'MusicCardShelf');
      const sub = txt(card?.subtitle);
      const cardId = card?.title?.endpoint?.payload?.browseId || card?.on_tap?.payload?.browseId;
      if (card && /auditeur|listener/i.test(sub) && (!cardId || cardId === id)) listeners = sub.split('•').pop().trim().replace(/auditeurs\/mois/i, 'auditeurs mensuels').replace(/monthly audience/i, 'auditeurs mensuels');
    } catch {}
    if (listeners) {
      stats.listeners[id] = { v: listeners, t: Date.now() };
      saveStats();
    } else if (stats.listeners[id]) listeners = stats.listeners[id].v;
    if (!light && !listeners) partial = true; // on réessaiera dans 5 minutes
    return {
      id,
      name,
      thumb,
      description: cleanBio(txt(h.description)),
      listeners,
      subscribers: listeners || txt(h.subscription_button?.subscriber_count) || txt(h.subscribers) || '',
      topTracks,
      sections,
      _partial: partial || undefined,
    };
  });
}

// Discographie complète d'un artiste : albums, singles et EP, apparitions (rubriques « Tout afficher » de YouTube
// Music), du plus récent au plus ancien. group : 'album' | 'single' | 'feat'.
export async function discography(id) {
  return cached(`disco:${id}`, 6 * 60 * 60e3, async () => {
    const yt = await getYt();
    const a = await yt.music.getArtist(id);
    const out = [];
    const seen = new Set();
    for (const sec of a.sections || []) {
      const title = txt(sec.header?.title) || txt(sec.title);
      const group = /^albums?$/i.test(title) ? 'album' : /single|\bep\b/i.test(title) ? 'single' : /appara|appears|featured on|avec la participation/i.test(title) ? 'feat' : null;
      if (!group) continue;
      let items = collectItems(sec.contents);
      const ep = sec.header?.more_content?.endpoint || sec.header?.endpoint;
      if (ep?.call) {
        try {
          const r = await ep.call(yt.actions, { client: 'YTMUSIC', parse: true });
          const all = r.contents_memo?.get('MusicTwoRowItem') || [];
          if (all.length) items = all;
        } catch {}
      }
      for (const it of items) {
        const n = normAny(it);
        if (!n || n.type !== 'album' || seen.has(n.id)) continue;
        seen.add(n.id);
        const sub = txt(it.subtitle);
        out.push({ ...n, group, year: n.year || (sub.match(/\b(19|20)\d{2}\b/) || [])[0] || '', kind: n.kind || (/single/i.test(sub) ? 'Single' : /\bEP\b/.test(sub) ? 'EP' : 'Album') });
      }
    }
    // Du plus récent au plus ancien (même année : ordre de YouTube Music, déjà du plus récent au plus ancien)
    out.forEach((x, i) => (x._i = i));
    out.sort((x, y) => (Number(y.year) || 0) - (Number(x.year) || 0) || x._i - y._i);
    out.forEach((x) => delete x._i);
    return { id, name: txt(a.header?.title), items: out };
  });
}

// Nouveaux albums et singles du moment (YouTube Music → Explorer), toute la liste
export async function newReleases() {
  return cached('newreleases', 3 * 60 * 60e3, async () => {
    const yt = await getYt();
    const e = await yt.music.getExplore();
    const sec = (e.sections || []).find((s) => /nouv|new/i.test(txt(s.header?.title))) || e.sections?.[0];
    if (!sec) return [];
    let items = collectItems(sec.contents);
    const ep = sec.header?.more_content?.endpoint || sec.header?.endpoint;
    if (ep?.call) {
      try {
        const r = await ep.call(yt.actions, { client: 'YTMUSIC', parse: true });
        const all = r.contents_memo?.get('MusicTwoRowItem') || [];
        if (all.length) items = all;
      } catch {}
    }
    return items.map(normAny).filter((n) => n && n.type === 'album');
  });
}

export async function album(id) {
  return cached(`al:${id}`, 6 * 60 * 60e3, async () => {
    const yt = await getYt();
    const al = await yt.music.getAlbum(id);
    const h = al.header || {};
    const subtitle = txt(h.subtitle);
    // Artiste : selon le format de la page (les nouvelles sorties utilisent souvent un autre en-tête), il est dans
    // « author », dans la ligne sous le titre (strapline) ou dans les liens du sous-titre
    const runArtists = (t) => (t?.runs || []).filter((r) => /^UC/.test(r.endpoint?.payload?.browseId || '')).map((r) => ({ name: r.text, id: r.endpoint.payload.browseId }));
    let artists = (h.author ? [{ name: h.author.name, id: h.author.channel_id }] : []).filter((a) => a.name);
    if (!artists.length) artists = [...runArtists(h.strapline_text_one), ...runArtists(h.subtitle), ...runArtists(h.second_subtitle)];
    if (!artists.length && h.strapline_text_one) artists = [{ name: txt(h.strapline_text_one), id: null }].filter((a) => a.name);
    const thumb = thumbOf(h) || thumbOf(al.background);
    const albumRef = { id, name: txt(h.title) };
    const tracks = collectItems(al.contents)
      .map((i) => normTrack(i, { artists, album: albumRef, thumb }))
      .filter(Boolean)
      .map((t) => ({ ...t, album: albumRef, thumb, artists: t.artists?.length && t.artists[0]?.name ? t.artists : artists }));
    // Toujours rien : artiste des titres eux-mêmes
    if (!artists.length) artists = tracks.find((t) => t.artists?.[0]?.name)?.artists || [];
    return {
      id,
      title: txt(h.title),
      artists,
      year: h.year || (subtitle.match(/\b(19|20)\d{2}\b/) || [])[0] || '',
      kind: /single/i.test(subtitle) ? 'Single' : /\bEP\b/.test(subtitle) ? 'EP' : 'Album',
      thumb,
      tracks,
    };
  });
}

export async function ytPlaylist(id, max = 1000) {
  return cached(`pl:${id}`, 30 * 60e3, async () => {
    const yt = await getYt();
    let pl = await yt.music.getPlaylist(id);
    const h = pl.header || {};
    const withPlays = (i) => {
      const t = normTrack(i);
      if (t) t.plays = playsOf(i) || undefined;
      return t;
    };
    const tracks = collectItems(pl.items || pl.contents).map(withPlays).filter(Boolean);
    while (pl.has_continuation && tracks.length < max) {
      pl = await pl.getContinuation();
      tracks.push(...collectItems(pl.items || pl.contents).map(withPlays).filter(Boolean));
    }
    return { id, title: txt(h.title), author: txt(h.author?.name) || txt(h.subtitle), thumb: thumbOf(h), tracks };
  });
}

export async function radio(videoId) {
  return cached(`r:${videoId}`, 30 * 60e3, async () => {
    const yt = await getYt();
    const up = await yt.music.getUpNext(videoId, true);
    return (up.contents || []).map((i) => normTrack(i)).filter(Boolean);
  });
}

// Biographie sans les mentions de source (« Source : Wikipédia », « From Wikipedia… », liens, licence)
function cleanBio(s) {
  return String(s || '')
    .split('\n')
    .filter((l) => !/^\s*(source|sources|from wikipedia|extrait de wikip|wikip[ée]dia|texte sous licence|creative commons|https?:\/\/)/i.test(l))
    .join('\n')
    .replace(/\s*\(?(source\s*:\s*)?wikip[ée]dia[^\n)]*\)?\s*$/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), ms))]);

// « 61 M lectures » / « 1,2 Md de vues » dans les colonnes d'un élément YouTube Music
function playsOf(item) {
  for (const c of item.flex_columns || []) {
    const s = txt(c.title);
    if (/lecture|vue|view|play|écoute/i.test(s)) return s.replace(/\s*(de\s+)?(lectures?|vues?|views?|plays?|écoutes?)\s*$/i, '').trim();
  }
  return null;
}

// Paroles fournies par YouTube Music (Musixmatch / LyricFind), liées exactement à la vidéo
export async function ytLyrics(videoId) {
  return cached(`ly:${videoId}`, 24 * 3600e3, async () => {
    const yt = await getYt();
    try {
      const l = await yt.music.getLyrics(videoId);
      const text = txt(l?.description);
      return text ? { plain: text, source: (txt(l?.footer).replace(/^Source\s*:\s*/i, '') || 'YouTube Music') } : null;
    } catch {
      return null;
    }
  });
}

// --- Correspondance d'un titre provenant d'une autre plateforme ---
const clean = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/feat\.?|ft\.?|remaster(ed)?|\d{4}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function similarity(a, b) {
  const A = new Set(clean(a).split(' ').filter(Boolean));
  const B = new Set(clean(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

// Cache disque des correspondances « titre + artiste → titre YouTube » : un ré-import ou une
// recherche déjà faite est instantané.
const MATCH_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache', 'matches.json');
let matchCache = {};
try {
  matchCache = JSON.parse(fs.readFileSync(MATCH_FILE, 'utf8'));
} catch {}
let matchSaveTimer = null;
function saveMatches() {
  clearTimeout(matchSaveTimer);
  matchSaveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(MATCH_FILE), { recursive: true });
    fs.writeFileSync(MATCH_FILE, JSON.stringify(matchCache));
  }, 2000);
}

export async function matchTrack(item) {
  const key = `${clean(item.title)}|${clean(item.artist)}`;
  if (key in matchCache) return matchCache[key];
  const t = await matchTrackUncached(item);
  matchCache[key] = t;
  saveMatches();
  return t;
}

async function matchTrackUncached({ title, artist, duration }) {
  const q = `${title} ${artist || ''}`.trim();
  const { items } = await search(q, 'song');
  let candidates = items.filter((i) => i.type === 'song');
  if (!candidates.length) candidates = (await search(q, 'video')).items;
  let best = null;
  let bestScore = -1;
  for (const c of candidates.slice(0, 8)) {
    let score = similarity(title, c.title) * 3 + similarity(artist, c.artists.map((a) => a.name).join(' ')) * 2;
    if (duration && c.duration) score -= Math.min(Math.abs(duration - c.duration) / 30, 2);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best || bestScore < 0.8) return null;
  const { type, ...track } = best;
  return track;
}

// Page « Explorer » de YouTube Music (France) : nouveaux albums / singles et titres tendance, pour l'accueil
export async function explore() {
  return cached('explore', 6 * 3600e3, async () => {
    const yt = await getYt();
    const ex = await yt.music.getExplore();
    const out = { newReleases: [], trending: [], clips: [] };
    for (const s of ex.sections || []) {
      const title = txt(s.header?.title) || txt(s.title);
      const items = collectItems(s.contents || s.items || []).map(normAny).filter(Boolean);
      if (/nouveaux albums|new albums/i.test(title)) out.newReleases = items;
      else if (/tendance|trending/i.test(title)) out.trending = items.filter((t) => t.type === 'song' || t.type === 'video');
      else if (/clips|videos/i.test(title)) out.clips = items;
    }
    return out;
  });
}