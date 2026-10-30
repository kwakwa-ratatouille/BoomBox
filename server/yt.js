import { scFind, scPlayCounts } from './soundcloud.js';
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
  // Certains résultats n'ont pas d'artiste « rangé » (affiché « Artiste inconnu ») : on le lit dans la 2e ligne
  // du résultat (« Titre • Ninho • Album • 3:21 »), d'abord les liens vers une page artiste, sinon le texte
  const runs = item.flex_columns?.[1]?.title?.runs || item.subtitle?.runs || [];
  const linked = runs
    .filter((r) => /ARTIST/.test(r.endpoint?.payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '') || /^UC/.test(r.endpoint?.payload?.browseId || ''))
    .map((r) => ({ name: txt(r.text), id: r.endpoint.payload.browseId }));
  if (linked.length) return linked;
  const parts = runs.map((r) => txt(r.text)).join('').split('•').map((x) => x.trim()).filter(Boolean);
  const name = parts.find((p) => !/^(titre|song|chanson|vid[ée]o|single|ep|album|\d+:\d+|[\d,.\s]+\s*(k|m|md)?\s*(vues|views|lectures|plays)?)$/i.test(p));
  return name ? [{ name, id: null }] : [];
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
const REISSUE = /deluxe|expanded|edition|[ée]dition|anniversary|anniversaire|remaster|super|from the vault|version|reissue|r[ée][ée]dition/i;
// Année de première sortie d'un album (MusicBrainz), pour ranger une réédition à sa vraie place
async function originalYear(artist, title) {
  const base = title.replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*$/, '').trim();
  if (!base || !artist) return null;
  const q = encodeURIComponent(`releasegroup:"${base.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}" AND primarytype:album`);
  const r = await fetch(`https://musicbrainz.org/ws/2/release-group/?query=${q}&fmt=json&limit=5`, { headers: { 'User-Agent': 'Boombox/1.0 (https://github.com/kwakwa-ratatouille/BoomBox)', Accept: 'application/json' } });
  if (!r.ok) return null;
  const j = await r.json();
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const years = (j['release-groups'] || [])
    .filter((g) => norm(g.title) === norm(base) && (g.score || 0) >= 90)
    .map((g) => Number(String(g['first-release-date'] || '').slice(0, 4)))
    .filter(Boolean);
  return years.length ? Math.min(...years) : null;
}

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
    // Rééditions (« Night Visions (Expanded Edition) » datée 2022 alors que l'album est de 2012) : YouTube Music
    // ne donne que l'année de la réédition. On cherche l'année d'origine dans MusicBrainz (gratuit, sans clé).
    const artistName = txt(a.header?.title);
    await Promise.all(out.filter((x) => x.group === 'album' && REISSUE.test(x.title)).slice(0, 6).map(async (x) => {
      const y = await originalYear(artistName, x.title).catch(() => null);
      if (y && y < Number(x.year)) Object.assign(x, { reissue: x.year, year: String(y) });
    }));
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
  return cached(`al2:${id}`, 6 * 60 * 60e3, async () => {
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
    const items = collectItems(al.contents);
    let tracks = items.map((i) => {
      const t = normTrack(i, { artists, album: albumRef, thumb });
      if (t) t.plays = playsOf(i) || undefined; // « 12 M lectures » affiché par YouTube Music
      return t;
    });
    // Titres « non disponibles » sur YouTube Music en France (droits) : avant, ils disparaissaient de l'album.
    // On les remplace par leur version YouTube (clip ou audio mis en ligne), retrouvée par titre + artiste.
    const missing = tracks.map((t, k) => (t ? null : k)).filter((k) => k != null);
    if (missing.length) {
      const who = artists[0]?.name || '';
      const key = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const fill = async (k) => {
        const i = items[k];
        const title = txt(i.title);
        if (!title) return;
        try {
          // 1) Le son officiel sur SoundCloud (publié par l'artiste) : la vraie version de l'album
          const sc = await scFind(null, title, who, i.duration?.seconds || 0);
          if (sc) {
            tracks[k] = { id: sc.id, title, duration: i.duration?.seconds || sc.duration, artists, album: albumRef, thumb, fromSoundcloud: true };
            return;
          }
          // 2) Sinon sa version YouTube (clip ou audio mis en ligne)
          const r = await search(`${who} ${title}`, 'video');
          const hit = (r.items || []).find((v) => key(v.title).includes(key(title)) && (!who || key(`${v.title} ${(v.artists || []).map((x) => x.name).join(' ')}`).includes(key(who).split(' ')[0])));
          if (hit) tracks[k] = { ...hit, type: undefined, title, duration: i.duration?.seconds || hit.duration, artists, album: albumRef, thumb, fromYoutube: true };
        } catch {}
      };
      for (let k = 0; k < missing.length; k += 4) await Promise.all(missing.slice(k, k + 4).map(fill));
      // Écoutes des sons remplacés par leur version SoundCloud (comptées chez SoundCloud)
      const scIds = tracks.filter((t) => t?.fromSoundcloud).map((t) => t.id);
      const counts = scIds.length ? await scPlayCounts(scIds).catch(() => ({})) : {};
      tracks.forEach((t) => t?.fromSoundcloud && counts[t.id] && (t.plays = counts[t.id]));
    }
    tracks = tracks
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
// Texte comparable. Les lettres de toutes les langues sont gardées : avant, seul l'alphabet latin restait, et un titre
// japonais, chinois ou coréen devenait vide (jamais retrouvé, ou confondu avec un autre son du même artiste)
const clean = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\(.*?\)|\[.*?\]|（.*?）|【.*?】|「|」|『|』/g, ' ')
    .replace(/feat\.?|ft\.?|remaster(ed)?|\d{4}/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Ressemblance de 0 à 1 : mots en commun ; pour le japonais, chinois, coréen (pas d'espaces entre les mots) :
// paires de caractères en commun
function similarity(a, b) {
  const ca = clean(a);
  const cb = clean(b);
  const A = new Set(ca.split(' ').filter(Boolean));
  const B = new Set(cb.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const words = inter / Math.max(A.size, B.size);
  if (!CJK.test(ca + cb)) return words;
  const pairs = (t) => {
    const x = t.replace(/\s+/g, '');
    const out = new Map();
    for (let i = 0; i < x.length - 1; i++) out.set(x.slice(i, i + 2), (out.get(x.slice(i, i + 2)) || 0) + 1);
    if (x.length === 1) out.set(x, 1);
    return out;
  };
  // Seulement les caractères japonais / chinois / coréens des deux côtés : la traduction ou la transcription en
  // lettres latines ajoutée par YouTube (« 夕凪 - Evening calm ») ne fait plus baisser la ressemblance
  const only = (t) => [...t].filter((ch) => CJK.test(ch)).join('');
  const qa = only(ca);
  const qb = only(cb);
  if (!qa || !qb) return words;
  const pa = pairs(qa);
  const pb = pairs(qb);
  let common = 0;
  for (const [k, n] of pa) common += Math.min(n, pb.get(k) || 0);
  // Part des caractères cherchés qu'on retrouve (le titre trouvé peut contenir en plus « Live at… »)
  let need = 0;
  for (const n of pa.values()) need += n;
  return Math.max(words, need ? common / need : 0);
}

// Même artiste ? Écritures différentes acceptées si le titre (en japonais, chinois, coréen) correspond exactement :
// « Yorushika » et « ヨルシカ » ne se ressemblent pas en lettres
const sameArtist = (want, got, title, gotTitle) => !want || similarity(want, got) >= 0.3 || (CJK.test(clean(title)) && similarity(title, gotTitle) >= 0.95);

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

// Son bloqué par YouTube (vidéo « +18 » qui exige un compte, etc.) : la même chanson mise en ligne ailleurs
// (chaîne de l'artiste, « Audio officiel »…), même titre et même durée à 4 s près. Renvoie jusqu'à 3 ids à essayer.
export async function alternatives(id, meta = null) {
  let title = meta?.title;
  let artist = meta?.artist;
  let duration = meta?.duration || 0;
  if (!title) {
    const yt = await getYt();
    const info = await yt.getBasicInfo(id).catch(() => null);
    title = info?.basic_info?.title;
    artist = (info?.basic_info?.author || '').replace(/\s*-\s*Topic$/i, '');
    duration = info?.basic_info?.duration || 0;
  }
  if (!title) return [];
  const clean = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const t = clean(title);
  // Clips et vidéos « paroles » exclus : bruitages, dialogues ou intro ajoutés par-dessus la musique
  const bad = /remix|live|cover|karaok|instrumental|slowed|sped|reverb|8d|nightcore|extended|1 ?hour|1h|lyric|paroles|clip|music video|official video|visuali[sz]er|tiktok|mashup/i;
  const q = `${artist || ''} ${title}`.trim();
  const a = clean(artist).split(' ')[0];
  const [songs, videos] = await Promise.all([search(q, 'song').catch(() => ({ items: [] })), search(q, 'video').catch(() => ({ items: [] }))]);
  return [...songs.items, ...videos.items]
    .filter((x) => x.id && x.id !== id && /^[\w-]{11}$/.test(x.id))
    .filter((x) => clean(x.title).includes(t) && !(bad.test(x.title) && !bad.test(title)))
    // Mise en ligne par l'artiste (sa chaîne, « - Topic », VEVO) : pas les copies de fans, souvent retouchées
    // (traduction des paroles, intro, bruitages… : un son « bizarre » qui ne correspond pas à l'original)
    .filter((x) => !a || clean((x.artists || []).map((z) => z.name).join(' ')).includes(a))
    .filter((x) => !duration || !x.duration || Math.abs(x.duration - duration) <= 4)
    .map((x) => x.id)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3);
}

// retry : nouvelle recherche même si le son avait été déclaré introuvable (bouton « Rechercher à nouveau »)
export async function matchTrack(item, { retry = false } = {}) {
  const key = `${clean(item.title)}|${clean(item.artist)}`;
  // Certains résultats YouTube Music arrivent sans artiste (« Artiste inconnu ») : on met celui qu'on cherchait
  const withArtist = (t) => (t && !t.artists?.length && item.artist ? { ...t, artists: [{ name: item.artist, id: null }] } : t);
  if (key in matchCache && !retry) return withArtist(matchCache[key]);
  const t = await matchTrackUncached(item);
  matchCache[key] = t;
  saveMatches();
  return withArtist(t);
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
  // Rien de sûr : 2e essai avec le titre seul (artiste écrit autrement, nom japonais, « feat. »…), artiste vérifié
  if ((!best || bestScore < 0.8) && artist) {
    const alt = (await search(title, 'song').catch(() => ({ items: [] }))).items.filter((i) => i.type === 'song');
    for (const c of alt.slice(0, 8)) {
      // Titre seul : on n'accepte que le bon artiste et un titre vraiment proche (sinon un autre son passait)
      if (similarity(artist, c.artists.map((x) => x.name).join(' ')) < 0.6 || similarity(title, c.title) < 0.6) continue;
      const score = similarity(title, c.title) * 3 + similarity(artist, c.artists.map((a) => a.name).join(' ')) * 2 - (duration && c.duration ? Math.min(Math.abs(duration - c.duration) / 30, 2) : 0);
      if (score > bestScore) ((bestScore = score), (best = c));
    }
  }
  // Artiste différent (reprise, remix par quelqu'un d'autre…) : refusé
  if (best && !sameArtist(artist, best.artists.map((x) => x.name).join(' '), title, best.title)) return null;
  // Titre trop différent : un autre son du même artiste (mieux vaut « introuvable » qu'un mauvais son)
  if (best && similarity(title, best.title) < 0.3) return null;
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