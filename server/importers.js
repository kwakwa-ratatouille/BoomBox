// Import de playlists depuis d'autres plateformes, puis correspondance sur YouTube Music.
// On conserve tout ce que la source fournit : ordre, date d'ajout de chaque titre, image,
// description et auteur de la playlist.
import { matchTrack, ytPlaylist, album as ytAlbum, search } from './yt.js';
import crypto from 'node:crypto';
import { spotifyPlaylist } from './spotify-stats.js';

const uid = () => crypto.randomBytes(6).toString('base64url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${new URL(url).host}`);
  return { text: await r.text(), url: r.url };
}

const decodeEntities = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

// --- Spotify ---
let spotifyToken = null;
export async function spotifyApiToken(cfg, force = false) {
  if (!cfg.spotifyClientId || !cfg.spotifyClientSecret) return null;
  if (!force && spotifyToken && spotifyToken.exp > Date.now() && spotifyToken.id === cfg.spotifyClientId) return spotifyToken.value;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${cfg.spotifyClientId}:${cfg.spotifyClientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) return null;
  const j = await r.json();
  spotifyToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000, id: cfg.spotifyClientId };
  return spotifyToken.value;
}

const bestImage = (images) => (images || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;

async function spotifyViaApi(kind, id, token) {
  const auth = { authorization: `Bearer ${token}` };
  const get = async (url) => {
    const r = await fetch(url, { headers: auth });
    if (!r.ok) throw new Error(`Spotify API ${r.status}`);
    return r.json();
  };
  if (kind === 'album') {
    const a = await get(`https://api.spotify.com/v1/albums/${id}`);
    const added = Date.parse(a.release_date) || null;
    const items = [];
    let page = a.tracks;
    while (page) {
      for (const t of page.items || []) items.push({ title: t.name, artist: t.artists.map((x) => x.name).join(' '), album: a.name, duration: Math.round(t.duration_ms / 1000), addedAt: added });
      page = page.next ? await get(page.next) : null;
    }
    return { name: a.name, description: `${a.album_type === 'single' ? 'Single' : 'Album'} de ${a.artists.map((x) => x.name).join(', ')} (${String(a.release_date).slice(0, 4)})`, cover: bestImage(a.images), owner: a.artists.map((x) => x.name).join(', '), items, hasDates: true };
  }
  const meta = await get(`https://api.spotify.com/v1/playlists/${id}?fields=name,description,images,owner(display_name)`);
  const items = [];
  let next = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=next,items(added_at,is_local,track(name,duration_ms,artists(name),album(name)))`;
  while (next) {
    const page = await get(next);
    for (const it of page.items || []) {
      if (!it.track?.name) continue;
      items.push({
        title: it.track.name,
        artist: (it.track.artists || []).map((a) => a.name).join(' '),
        album: it.track.album?.name || null,
        duration: Math.round((it.track.duration_ms || 0) / 1000),
        addedAt: Date.parse(it.added_at) || null,
      });
    }
    next = page.next;
  }
  return { name: meta.name, description: decodeEntities(meta.description), cover: bestImage(meta.images), owner: meta.owner?.display_name || null, items, hasDates: true };
}

async function fromSpotify(kind, id, cfg) {
  const token = await spotifyApiToken(cfg);
  if (token) {
    try {
      const res = await spotifyViaApi(kind, id, token);
      if (res.items.length) return res;
    } catch (e) {
      // Les playlists éditoriales de Spotify ne sont plus accessibles par l'API : on passe par la page publique.
      console.warn('Spotify API :', e.message);
    }
  }
  // Sans clé API : lecture complète par le lecteur web de Spotify (sinon le lecteur intégré s'arrête à 100 titres)
  if (kind === 'playlist') {
    try {
      const res = await spotifyPlaylist(id);
      if (res.items.length) return res;
    } catch (e) {
      console.warn('Spotify (lecteur web) :', e.message);
    }
  }
  const { text } = await getText(`https://open.spotify.com/embed/${kind}/${id}`);
  const m = text.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error('Impossible de lire la playlist Spotify (est-elle publique ?)');
  const e = JSON.parse(m[1]).props?.pageProps?.state?.data?.entity;
  if (!e?.trackList) throw new Error('Playlist Spotify introuvable');
  return {
    name: e.name || e.title || 'Import Spotify',
    description: '',
    cover: bestImage(e.coverArt?.sources),
    owner: e.subtitle || null,
    items: e.trackList.map((t) => ({ title: t.title, artist: t.subtitle, duration: Math.round((t.duration || 0) / 1000), addedAt: null })),
    hasDates: false,
    note: token
      ? 'Playlist éditoriale Spotify : dates d’ajout indisponibles.'
      : 'Sans clé API Spotify, les dates d’ajout ne sont pas disponibles et l’import est limité à ~100 titres (Paramètres → Spotify).',
  };
}

// --- Deezer ---
async function fromDeezer(kind, id) {
  const meta = await fetch(`https://api.deezer.com/${kind}/${id}`).then((r) => r.json());
  if (meta.error) throw new Error('Playlist Deezer introuvable ou privée');
  const albumDate = kind === 'album' ? Date.parse(meta.release_date) || null : null;
  const items = [];
  let next = `https://api.deezer.com/${kind}/${id}/tracks?limit=100`;
  while (next && items.length < 5000) {
    const page = await fetch(next).then((r) => r.json());
    for (const t of page.data || []) {
      items.push({
        title: t.title,
        artist: t.artist?.name,
        album: t.album?.title || (kind === 'album' ? meta.title : null),
        duration: t.duration,
        addedAt: t.time_add ? t.time_add * 1000 : albumDate,
      });
    }
    next = page.next;
  }
  return {
    name: meta.title || 'Import Deezer',
    description: decodeEntities(meta.description || ''),
    cover: meta.picture_xl || meta.cover_xl || null,
    owner: meta.creator?.name || meta.artist?.name || null,
    items,
    hasDates: items.some((i) => i.addedAt),
  };
}

// --- Texte libre : une ligne = "Artiste - Titre", ou fichier CSV (Exportify, TuneMyMusic, Soundiiz, Excel…) ---
// Lecteur CSV complet : guillemets, retours à la ligne dans les champs, séparateur , ; ou tabulation,
// fins de ligne Windows / Mac / Linux, en-têtes anglais ou français.
function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) row.push(cur.trim()), (cur = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur.trim());
      if (row.some((x) => x)) rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  row.push(cur.trim());
  if (row.some((x) => x)) rows.push(row);
  return rows;
}

const TITLE_RE = [/track name/, /nom du (titre|morceau)/, /^titre/, /^title/, /^song/, /^morceau/, /^name/, /^nom$/];
const ARTIST_RE = [/^artist name/, /nom de l.artiste/, /^artiste/, /^artist/, /artist/, /artiste/];

function fromText(text) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r\n|\n|\r/).find((l) => l.trim()) || '';
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0];
  const items = [];
  const rows = delim[1] > 1 ? parseCsv(text, delim[0]) : [];
  const header = rows[0]?.map((h) => h.toLowerCase().replace(/^\uFEFF/, '').trim());
  const col = (res) => {
    for (const re of res) {
      const i = header.findIndex((h) => re.test(h) && !/uri|\bids?\b|url|isrc|playlist/.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  const ti = header ? col(TITLE_RE) : -1;
  if (ti >= 0) {
    const ai = col(ARTIST_RE);
    const di = col([/added at/, /date d.ajout/, /ajout/, /added/]);
    const bi = col([/album name/, /nom de l.album/, /^album/]);
    const mi = col([/duration \(ms\)/, /duration_ms/, /durée \(ms\)/]);
    for (const r of rows.slice(1)) {
      const title = r[ti];
      if (!title) continue;
      const ms = mi >= 0 ? Number(r[mi]) : 0;
      items.push({
        title,
        artist: ai >= 0 ? (r[ai] || '').replace(/\\,/g, ',').split(/[;,]/)[0].trim() : '',
        album: bi >= 0 ? r[bi] || null : null,
        duration: ms ? Math.round(ms / 1000) : 0,
        addedAt: di >= 0 ? Date.parse(r[di]) || null : null,
      });
    }
  } else {
    for (const line of text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean)) {
      const parts = line.split(/\s+[-–—]\s+/);
      if (parts.length >= 2) items.push({ artist: parts[0], title: parts.slice(1).join(' - '), addedAt: null });
      else items.push({ title: line, artist: '', addedAt: null });
    }
  }
  return { name: 'Playlist importée', description: '', cover: null, owner: null, items, hasDates: items.some((i) => i.addedAt) };
}
// Playlists publiques d'un profil Spotify (clé API Spotify nécessaire) : jusqu'à 40 titres de ses 4 plus grosses
async function fromSpotifyUser(userId, cfg) {
  const token = await spotifyApiToken(cfg);
  if (!token) throw new Error('Pour un profil Spotify, ajoute ta clé API Spotify (Paramètres) ou colle plutôt le lien d’une de ses playlists');
  const r = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists?limit=50`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Profil Spotify introuvable (${r.status})`);
  const j = await r.json();
  const lists = (j.items || []).filter((p) => p?.id && (p.tracks?.total || 0) > 0).sort((a, b) => (b.tracks?.total || 0) - (a.tracks?.total || 0)).slice(0, 4);
  if (!lists.length) throw new Error('Ce profil Spotify n’a pas de playlist publique');
  const items = [];
  for (const p of lists) {
    const src = await spotifyViaApi('playlist', p.id, token).catch(() => null);
    items.push(...(src?.items || []).sort(() => Math.random() - 0.5).slice(0, 40));
  }
  return { name: `Profil Spotify de ${lists[0].owner?.display_name || userId}`, owner: lists[0].owner?.display_name || userId, description: '', cover: null, items, hasDates: false };
}

async function resolveSource(input, cfg) {
  const s = input.trim();
  if (!/^https?:\/\//i.test(s)) return { source: 'Texte', ...fromText(s) };

  let url = s;
  // Liens courts (deezer.page.link, link.deezer.com, spotify.link…)
  if (/page\.link|link\.deezer|spotify\.link|dzr\.page/i.test(url)) url = (await getText(url)).url;
  const u = new URL(url);

  if (/spotify\.com$/.test(u.hostname)) {
    // Profil Spotify d'un ami (pour un Blend) : on prend des titres de ses playlists publiques
    const user = u.pathname.match(/user\/([^/?#]+)/);
    if (user) return { source: 'Spotify', url, ...(await fromSpotifyUser(decodeURIComponent(user[1]), cfg)) };
    const m = u.pathname.match(/(playlist|album)\/([A-Za-z0-9]+)/);
    if (!m) throw new Error('Lien Spotify non reconnu (playlist ou album attendu)');
    return { source: 'Spotify', url, ...(await fromSpotify(m[1], m[2], cfg)) };
  }
  if (/deezer\.com$/.test(u.hostname)) {
    const m = u.pathname.match(/(playlist|album)\/(\d+)/);
    if (!m) throw new Error('Lien Deezer non reconnu');
    return { source: 'Deezer', url, ...(await fromDeezer(m[1], m[2])) };
  }
  if (/youtube\.com$|youtu\.be$/.test(u.hostname)) {
    const list = u.searchParams.get('list');
    if (list) {
      const pl = await ytPlaylist(list);
      return { source: 'YouTube', url, name: pl.title || 'Playlist YouTube', description: '', cover: pl.thumb, owner: pl.author || null, tracks: pl.tracks, hasDates: false };
    }
    const browse = u.pathname.match(/browse\/(MPREb_[\w-]+)/);
    if (browse) {
      const al = await ytAlbum(browse[1]);
      return { source: 'YouTube Music', url, name: al.title, description: `${al.kind} (${al.year})`, cover: al.thumb, owner: al.artists.map((a) => a.name).join(', '), tracks: al.tracks, hasDates: false };
    }
    throw new Error('Lien YouTube : il faut un lien de playlist (contenant list=…)');
  }
  throw new Error('Plateforme non supportée. Colle plutôt la liste « Artiste - Titre » (une par ligne).');
}

// Jobs d'import en mémoire (le client interroge la progression).
const jobs = new Map();

export function startImport(input, cfg, nameHint = '') {
  const job = { id: uid(), status: 'running', name: '', source: '', url: null, description: '', cover: null, owner: null, hasDates: false, total: 0, done: 0, tracks: [], unmatched: [], error: null, note: null };
  jobs.set(job.id, job);
  (async () => {
    try {
      const src = await resolveSource(input, cfg);
      if (nameHint && src.source === 'Texte') src.name = nameHint;
      Object.assign(job, { name: src.name, source: src.source, url: src.url || null, description: src.description || '', cover: src.cover || null, owner: src.owner || null, hasDates: !!src.hasDates, note: src.note || null });
      if (src.tracks) {
        job.total = job.done = src.tracks.length;
        job.tracks = src.tracks;
      } else {
        job.total = src.items.length;
        const results = new Array(src.items.length);
        let cursor = 0;
        const worker = async () => {
          while (cursor < src.items.length) {
            const i = cursor++;
            const it = src.items[i];
            let t = null;
            try {
              t = await matchTrack(it);
            } catch {}
            if (t) {
              // On garde la date d'ajout d'origine, et l'album d'origine si YouTube n'en donne pas
              results[i] = { ...t, addedAt: it.addedAt || null, album: t.album || (it.album ? { id: null, name: it.album } : null) };
            } else job.unmatched.push(`${it.artist ? it.artist + ' - ' : ''}${it.title}`);
            job.done++;
          }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
        // Ordre d'origine conservé ; les doublons éventuels sont retirés
        const seen = new Set();
        job.tracks = results.filter((t) => t && !seen.has(t.id) && seen.add(t.id));
      }
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
    }
    setTimeout(() => jobs.delete(job.id), 60 * 60e3);
  })();
  return job;
}

export const getJob = (id) => jobs.get(id);

// ---------- Synchronisation continue d'une playlist importée (Spotify, Deezer, YouTube) ----------
// On relit la playlist d'origine et on renvoie seulement les titres apparus depuis la dernière fois.
// seen : clés « titre|artiste » déjà vues à la synchro précédente (null la première fois : on compare alors
// avec les titres déjà présents dans la playlist Boombox, `have`). Les titres retirés côté Boombox ne reviennent pas.
const syncKey = (title, artist) => `${String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s*[([].*?[)\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, '')}|${String(artist || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 24)}`;
export async function syncPlaylist({ url, seen = null, have = [] }, cfg) {
  // (seen est réaffecté plus bas si la synchro précédente était partielle)
  const src = await resolveSource(url, cfg);
  const items = src.items || (src.tracks || []).map((t) => ({ title: t.title, artist: (t.artists || []).map((a) => a.name).join(' '), addedAt: t.addedAt || null, track: t }));
  const keys = items.map((it) => syncKey(it.title, it.artist));
  // Synchro précédente partielle (ex. lecture limitée à 100 titres) : on compare aussi avec les titres déjà présents
  const seenSet = new Set(seen || []);
  if (seen && keys.filter((k) => seenSet.has(k)).length < keys.length * 0.6) seen = null;
  const known = new Set(seen || []);
  // Première synchro : un titre de la source est « déjà là » si le même titre (et le premier artiste) est dans la playlist
  const haveKeys = new Set(have.map((h) => syncKey(h.title, h.artist)));
  const haveTitles = new Set(have.map((h) => syncKey(h.title, '')));
  const fresh = items.filter((it, i) => !known.has(keys[i]) && !(seen == null && (haveKeys.has(keys[i]) || haveTitles.has(syncKey(it.title, '')))));
  const added = [];
  const unmatched = [];
  for (const it of fresh.slice(0, 600)) {
    let t = it.track || null;
    if (!t) {
      try {
        t = await matchTrack(it);
      } catch {}
    }
    if (t) added.push({ ...t, addedAt: it.addedAt || Date.now(), addedBy: it.addedBy || null });
    else unmatched.push(`${it.artist ? it.artist + ' - ' : ''}${it.title}`);
  }
  return { name: src.name, keys, added, unmatched, sourceCount: items.length, alreadyThere: items.length - fresh.length, skipped: Math.max(0, fresh.length - 600) };
}

// Correspondance en masse (données Spotify) : titres { title, artist } ou artistes { name }.
// results[i] est aligné sur items[i] (null si introuvable).
export function startMatch(items, kind = 'track') {
  const job = { id: uid(), status: 'running', total: items.length, done: 0, results: new Array(items.length).fill(null), error: null };
  jobs.set(job.id, job);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  (async () => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const i = cursor++;
        const it = items[i];
        // Jusqu'à 3 essais : une erreur réseau passagère ne doit pas faire « disparaître » un artiste
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (kind === 'artist') {
              const { items: found } = await search(String(it.name), 'artist');
              // On n'accepte que si le nom correspond (évite de suivre le mauvais artiste)
              job.results[i] = found.find((a) => norm(a.name) === norm(it.name)) || null;
            } else {
              job.results[i] = await matchTrack(it);
            }
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
        job.done++;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    job.status = 'done';
    setTimeout(() => jobs.delete(job.id), 60 * 60e3);
  })();
  return { id: job.id, total: job.total };
}
