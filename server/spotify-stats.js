// Chiffres exacts de Spotify (auditeurs mensuels, nombre d'écoutes des titres), sans compte ni clé :
// le lecteur intégré de Spotify (open.spotify.com/embed) fournit un jeton anonyme, utilisé avec les
// mêmes requêtes que le lecteur web. Résultats gardés une semaine sur le disque.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const HASH = {
  artist: '35648a112beb1794e39ab931365f6ae4a8d45e65396d641eeda94e4003d41497', // queryArtistOverview
  search: '21969b655b795601fb2d2204a4243188e75fdc6d3520e7b9cd3f4db2aff9591e', // searchDesktop
  track: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294', // getTrack
  playlist: '73a3b3470804983e4d55d83cd6cc99715019228fd999d51429cc69473a18789d', // fetchPlaylist
  playlistContents: 'c56c706a062f82052d87fdaeeb300a258d2d54153222ef360682a0ee625284d9', // fetchPlaylistContents
};

let tok = null; // { value, exp }
async function token() {
  if (tok && tok.exp > Date.now() + 60e3) return tok.value;
  const html = await (await fetch('https://open.spotify.com/embed/artist/2UwqpfQtNuhBwviIC0f2ie', { headers: UA })).text();
  const value = html.match(/"accessToken":"([^"]+)"/)?.[1];
  if (!value) throw new Error('jeton Spotify introuvable');
  tok = { value, exp: Number(html.match(/"accessTokenExpirationTimestampMs":(\d+)/)?.[1]) || Date.now() + 30 * 60e3 };
  return value;
}

async function gql(op, variables, hash) {
  const ext = encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }));
  const url = `https://api-partner.spotify.com/pathfinder/v1/query?operationName=${op}&variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${ext}`;
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url, { headers: { ...UA, authorization: `Bearer ${await token()}`, 'app-platform': 'WebPlayer' } });
    if (r.status === 401) { tok = null; continue; }
    if (!r.ok) throw new Error(`Spotify ${r.status}`);
    return (await r.json()).data;
  }
  throw new Error('Spotify refuse le jeton');
}

// Comparaison de titres / noms : sans accents, ponctuation, « feat. », mentions entre parenthèses
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s*[([].*?[)\]]/g, '').replace(/\s+(feat|ft)\.?\s.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---------- Cache disque (une semaine) ----------
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache', 'spotify-stats.json');
const WEEK = 7 * 24 * 3600e3;
let db = { artists: {}, tracks: {} };
try {
  db = { artists: {}, tracks: {}, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db));
  }, 2000);
}
const fresh = (e) => e && Date.now() - e.t < WEEK;
// Fiches d'artiste d'un ancien format (sans photos) : récupérées à nouveau
const freshArtist = (e) => fresh(e) && (e.none || e.v === 3);

// Artiste Spotify correspondant à un nom : auditeurs mensuels, abonnés et écoutes de ses titres phares
async function fetchArtist(name) {
  const s = await gql('searchDesktop', { searchTerm: name, offset: 0, limit: 5, numberOfTopResults: 5, includeAudiobooks: false, includeArtistHasConcertsField: false, includePreReleases: false, includeLocalConcertsField: false }, HASH.search);
  const hits = (s?.searchV2?.artists?.items || []).map((i) => i.data).filter(Boolean);
  const hit = hits.find((a) => norm(a.profile?.name) === norm(name));
  if (!hit) return { t: Date.now(), none: true };
  const a = (await gql('queryArtistOverview', { uri: hit.uri, locale: '', includePrerelease: true }, HASH.artist))?.artistUnion;
  const top = {};
  for (const it of a?.discography?.topTracks?.items || []) if (it.track?.name) top[norm(it.track.name)] = Number(it.track.playcount) || 0;
  // Photos à jour (celles de la page Spotify) et biographie écrite par l'artiste
  const biggest = (img) => (img?.sources || []).slice().sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url || null;
  const bio = String(a?.profile?.biography?.text || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
  // Concerts annoncés sur Spotify (salle, ville, coordonnées, date) : pour « Concerts près de chez toi »
  const concerts = (a?.goods?.events?.concerts?.items || []).map((c) => ({
    id: c.id, title: c.title, festival: !!c.festival, venue: c.venue?.name || '', city: c.venue?.location?.name || '',
    lat: c.venue?.coordinates?.latitude ?? null, lon: c.venue?.coordinates?.longitude ?? null, date: c.date?.isoString || null,
    url: `https://open.spotify.com/concert/${c.id}`,
  })).filter((c) => c.date);
  return { v: 3, t: Date.now(), id: hit.uri.split(':').pop(), listeners: a?.stats?.monthlyListeners || 0, followers: a?.stats?.followers || 0, top, avatar: biggest(a?.visuals?.avatarImage), header: biggest(a?.visuals?.headerImage), bio, concerts };
}

// ---------- Dernières sorties d'un artiste (pour les Nouveautés, plus rapide et fiable que YouTube Music) ----------
// Spotify publie les sorties à minuit avec leur date exacte : on lit la fiche de l'artiste (dernière sortie, singles,
// albums). Gardé 3 h. Renvoie [{ name, type, date: 'AAAA-MM-JJ', cover }].
const coverOf = (img) => (img?.sources || []).slice().sort((x, y) => (y.width || 0) - (x.width || 0))[0]?.url || null;
const dateOf = (d) => (d?.isoString ? d.isoString.slice(0, 10) : d?.year ? `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}` : null);
export async function spotifyLatest(name) {
  const ka = artistKey(name);
  db.releases ??= {};
  const c = db.releases[ka];
  if (c && Date.now() - c.t < 3 * 3600e3) return c.items;
  let ar = db.artists[ka];
  if (!freshArtist(ar)) {
    ar = await fetchArtist(name);
    db.artists[ka] = ar;
  }
  if (!ar || ar.none || !ar.id) return [];
  const a = (await gql('queryArtistOverview', { uri: `spotify:artist:${ar.id}`, locale: '', includePrerelease: true }, HASH.artist))?.artistUnion;
  const d = a?.discography || {};
  const seen = new Set();
  const items = [];
  const push = (r) => {
    if (!r?.name || seen.has(r.uri || r.name)) return;
    seen.add(r.uri || r.name);
    items.push({ name: r.name, type: String(r.type || '').toLowerCase(), date: dateOf(r.date), cover: coverOf(r.coverArt) });
  };
  push(d.latest);
  for (const g of [d.singles, d.albums, d.popularReleasesAlbums]) for (const it of g?.items || []) for (const r of it.releases?.items || [it]) push(r);
  items.sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')));
  db.releases[ka] = { t: Date.now(), items: items.slice(0, 12) };
  save();
  return db.releases[ka].items;
}

// Nombre d'écoutes exact d'un titre (recherche « titre artiste », puis fiche du titre)
async function fetchTrack(title, artist) {
  const s = await gql('searchDesktop', { searchTerm: `${title} ${artist}`, offset: 0, limit: 5, numberOfTopResults: 5, includeAudiobooks: false, includeArtistHasConcertsField: false, includePreReleases: false, includeLocalConcertsField: false }, HASH.search);
  const items = (s?.searchV2?.tracksV2?.items || []).map((i) => i.item?.data).filter(Boolean);
  const byArtist = items.filter((t) => (t.artists?.items || []).some((a) => norm(a.profile?.name) === norm(artist)));
  // Titre identique, sinon l'un contient l'autre (préfixe « Σ. », mention de version…)
  const nt = norm(title);
  const hit = byArtist.find((t) => norm(t.name) === nt) || (nt.length >= 4 && byArtist.find((t) => norm(t.name).includes(nt) || nt.includes(norm(t.name))));
  if (!hit) return { t: Date.now(), none: true };
  const tr = (await gql('getTrack', { uri: hit.uri }, HASH.track))?.trackUnion;
  return { t: Date.now(), plays: Number(tr?.playcount) || 0 };
}

// File d'attente en arrière-plan : une requête à la fois, sans bloquer l'affichage
const queue = [];
const queued = new Set();
let running = false;
function enqueue(key, job) {
  if (queued.has(key)) return;
  queued.add(key);
  queue.push([key, job]);
  pump();
}
async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const [key, job] = queue.shift();
    try {
      await job();
    } catch {}
    queued.delete(key);
    await new Promise((r) => setTimeout(r, 250));
  }
  running = false;
}

const artistKey = (name) => norm(name);
const trackKey = (title, artist) => `${norm(title)}|${norm(artist)}`;

// Complète un artiste (et ses titres populaires) avec les chiffres Spotify déjà connus ;
// lance en arrière-plan la récupération de ceux qui manquent (visibles à l'affichage suivant).
export function applyArtistStats(a) {
  const ka = artistKey(a.name);
  const ar = db.artists[ka];
  if (!freshArtist(ar)) {
    enqueue(`a:${ka}`, async () => {
      db.artists[ka] = await fetchArtist(a.name);
      save();
    });
  }
  if (ar && !ar.none) {
    a.monthlyListeners = ar.listeners;
    a.spotifyFollowers = ar.followers;
    if (ar.avatar) a.thumb = ar.avatar;
    if (ar.header) a.banner = ar.header;
    if (ar.bio && ar.bio.length > (a.description || '').length / 2) a.description = ar.bio;
    a.concerts = (ar.concerts || []).filter((c) => Date.parse(c.date) > Date.now());
  }
  for (const t of a.topTracks || []) {
    const fromTop = ar?.top?.[norm(t.title)];
    if (fromTop) {
      t.playsSpotify = fromTop;
      continue;
    }
    const artist = t.artists?.[0]?.name || a.name;
    const kt = trackKey(t.title, artist);
    const tr = db.tracks[kt];
    if (tr?.plays) t.playsSpotify = tr.plays;
    if (!fresh(tr) && fresh(ar)) {
      enqueue(`t:${kt}`, async () => {
        db.tracks[kt] = await fetchTrack(t.title, artist);
        save();
      });
    }
  }
  return a;
}

// Des chiffres manquent encore (récupération en cours) ?
export const artistStatsPending = (a) => !freshArtist(db.artists[artistKey(a.name)]) || (a.topTracks || []).some((t) => !t.playsSpotify && !fresh(db.tracks[trackKey(t.title, t.artists?.[0]?.name || a.name)]) && !db.artists[artistKey(a.name)]?.top?.[norm(t.title)]);

// Concerts à venir des artistes demandés (ceux que tu suis). Les artistes pas encore connus sont récupérés en
// arrière-plan : `pending` indique combien il en reste (la page se rafraîchit).
export function concertsFor(names) {
  const out = [];
  let pending = 0;
  for (const name of names) {
    const ka = artistKey(name);
    const ar = db.artists[ka];
    if (!freshArtist(ar)) {
      pending++;
      enqueue(`a:${ka}`, async () => {
        db.artists[ka] = await fetchArtist(name);
        save();
      });
    }
    for (const c of ar?.concerts || []) if (Date.parse(c.date) > Date.now()) out.push({ ...c, artist: name, artistImg: ar.avatar || null });
  }
  out.sort((x, y) => Date.parse(x.date) - Date.parse(y.date));
  return { concerts: out, pending };
}
// Playlist Spotify complète sans clé API (le lecteur intégré, lui, s'arrête à 100 titres) : titres, artistes,
// album, durée, date d'ajout et qui l'a ajouté (playlists collaboratives). Pages de 100 titres.
export async function spotifyPlaylist(id) {
  const uri = `spotify:playlist:${id}`;
  const meta = (await gql('fetchPlaylist', { uri, offset: 0, limit: 1, enableWatchFeedEntrypoint: false }, HASH.playlist))?.playlistV2;
  if (!meta || meta.__typename === 'NotFound') throw new Error('Playlist Spotify introuvable (est-elle publique ?)');
  const items = [];
  let total = Infinity;
  for (let offset = 0; offset < total && offset < 10000; offset += 100) {
    const c = (await gql('fetchPlaylistContents', { uri, offset, limit: 100 }, HASH.playlistContents))?.playlistV2?.content;
    if (!c) break;
    total = c.totalCount ?? 0;
    for (const it of c.items || []) {
      const t = it.itemV2?.data;
      if (!t?.name || it.itemV2.__typename !== 'TrackResponseWrapper') continue;
      items.push({
        title: t.name,
        artist: (t.artists?.items || []).map((a) => a.profile?.name).filter(Boolean).join(' ') || (t.albumOfTrack?.artists?.items || []).map((a) => a.profile?.name).join(' '),
        album: t.albumOfTrack?.name || null,
        duration: Math.round((t.trackDuration?.totalMilliseconds || 0) / 1000),
        addedAt: Date.parse(it.addedAt?.isoString) || null,
        addedBy: it.addedBy?.data?.name || null,
      });
    }
    if (!c.items?.length) break;
  }
  const img = (meta.images?.items?.[0]?.sources || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
  return { name: meta.name || 'Import Spotify', description: String(meta.description || '').replace(/<[^>]+>/g, ''), cover: img, owner: meta.ownerV2?.data?.name || null, items, hasDates: items.some((i) => i.addedAt) };
}