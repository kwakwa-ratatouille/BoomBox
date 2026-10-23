// Un son = une seule fiche, même s'il existe sur YouTube Music et sur SoundCloud.
// - Même version des deux côtés : la fiche YouTube Music fait foi (titre, pochette, album, écoutes justes) et la
//   version SoundCloud y est rattachée (une seule entrée dans les playlists, l'historique et les stats).
// - YouTube n'a qu'un remix / sped up / la version d'un autre : ce n'est pas le même son. La version SoundCloud
//   (publiée par l'artiste) prend sa place dans les résultats, avec ses propres écoutes.
// - Le son peut être joué depuis l'autre version (choix manuel « Écouter la version SoundCloud / YouTube »).
// Les liens trouvés sont gardés dans les réglages du profil (synchronisés entre appareils).
import { setting, saveSettings, ls } from './state.js';

const isSc = (id) => /^sc_/.test(String(id || ''));
// Titre comparable : minuscules, sans accents, sans parenthèses ni « feat. »
export const normTitle = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]|\b(feat|ft)\b\.?.*$/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const REMIX = /\b(remix|rmx|nightcore|slowed|sped up|speed up|reverb|8d|mashup|bootleg|flip|cover|instrumental|karaoke|acapella|live|edit)\b/;
// Remix / version modifiée (le titre complet est regardé, parenthèses comprises) — sauf si c'est ce qu'on cherche
export const isRemix = (t, wanted = '') => REMIX.test(plain(`${t?.title || ''} ${t?.album?.name || ''}`)) && !REMIX.test(plain(wanted));

// ---------- Artistes ----------
// Comptes SoundCloud « PNL Officiel », « pnl music », « Kidashhh Officiel »… → clé « pnl », « kidashhh »
const SUFFIX = /\b(officiel+e?|official|offical|music|musique|musik|tv|vevo|topic|records|prod)\b/g;
export const artistKey = (name) => plain(name).replace(SUFFIX, ' ').replace(/\s+/g, '');
const cleanName = (name) => String(name || '').replace(/\s*[-–|]?\s*\b(officiel+e?|official|offical|music|musique|vevo|topic)\b\.?\s*$/i, '').trim() || name;
// Nom d'artiste de référence (celui de YouTube Music), appris au fil des sons affichés
let names = null;
const loadNames = () => (names ||= ls.get('boombox.artistNames', {}));
let saveT = 0;
export function learnArtists(tracks) {
  const m = loadNames();
  let changed = false;
  for (const t of tracks || []) {
    if (!t?.id || isSc(t.id)) continue;
    for (const a of t.artists || []) {
      const k = artistKey(a?.name);
      if (k && a.name && m[k]?.name !== a.name) ((m[k] = { name: a.name, id: a.id || m[k]?.id || null }), (changed = true));
    }
  }
  if (changed) {
    clearTimeout(saveT);
    saveT = setTimeout(() => ls.set('boombox.artistNames', Object.fromEntries(Object.entries(m).slice(-4000))), 2000);
  }
}
// Artiste affiché : le nom de référence s'il est connu, sinon le nom du compte sans « Officiel »
export function canonArtist(a) {
  if (!a?.name) return a;
  const ref = loadNames()[artistKey(a.name)];
  return ref ? { ...a, name: ref.name, id: a.id || ref.id || null } : { ...a, name: cleanName(a.name) };
}
// Sons SoundCloud : artistes renommés (une seule fiche artiste dans les stats, le classement…)
export function fixTrack(t) {
  if (!t || !isSc(t.id) || !t.artists?.length) return t;
  return { ...t, artists: t.artists.map(canonArtist) };
}

// ---------- Même son ? ----------
export function sameSong(a, b) {
  const ta = normTitle(a?.title);
  const tb = normTitle(b?.title);
  if (!ta || !tb) return false;
  const titleOk = ta === tb || (Math.min(ta.length, tb.length) >= 4 && (ta.includes(tb) || tb.includes(ta)));
  if (!titleOk) return false;
  if (a.duration && b.duration && Math.abs(a.duration - b.duration) > 15) return false;
  const ka = (a.artists || []).map((x) => artistKey(x.name)).filter(Boolean);
  const kb = (b.artists || []).map((x) => artistKey(x.name)).filter(Boolean);
  const fullA = plain(`${a.title} ${(a.artists || []).map((x) => x.name).join(' ')}`).replace(/\s+/g, '');
  const fullB = plain(`${b.title} ${(b.artists || []).map((x) => x.name).join(' ')}`).replace(/\s+/g, '');
  return ka.some((k) => kb.some((j) => k === j || (k.length >= 3 && j.includes(k)) || (j.length >= 3 && k.includes(j)))) || ka.some((k) => k.length >= 3 && fullB.includes(k)) || kb.some((k) => k.length >= 3 && fullA.includes(k));
}

// ---------- Liens entre versions ----------
// twins : { id d'une version : id de la fiche principale } ; audioPick : { fiche principale : version jouée }
const twins = () => setting('twins', {});
export const canonId = (id) => twins()[id] || id;
export const playId = (id) => setting('audioPick', {})[canonId(id)] || id;
// Autre version connue d'un son (pour le choix manuel)
export function otherVersion(id) {
  const c = canonId(id);
  if (c !== id) return c;
  return Object.keys(twins()).find((k) => twins()[k] === id) || null;
}
let pending = {};
let pendT = 0;
export function linkTwin(otherId, mainId) {
  if (!otherId || !mainId || otherId === mainId || twins()[otherId] === mainId) return;
  pending[otherId] = mainId;
  clearTimeout(pendT);
  pendT = setTimeout(() => {
    const all = Object.entries({ ...twins(), ...pending }).slice(-3000);
    pending = {};
    saveSettings({ twins: Object.fromEntries(all) }).catch(() => {});
  }, 1500);
}
export async function setAudioPick(id, versionId) {
  const c = canonId(id);
  const pick = { ...setting('audioPick', {}) };
  if (versionId) pick[c] = versionId;
  else delete pick[c];
  await saveSettings({ audioPick: pick });
}

// ---------- Résultats de recherche ----------
// yt : titres YouTube Music, sc : sons SoundCloud. Renvoie { songs, scOnly } :
// - SoundCloud identique à un titre YouTube Music → masqué et rattaché (stats YouTube Music) ;
// - le titre YouTube n'est qu'un remix / la version d'un autre alors que SoundCloud a le vrai son (compte de
//   l'artiste) → la version SoundCloud prend sa place ;
// - le reste de SoundCloud (sons absents de YouTube Music) → scOnly.
export function mergeResults(yt, sc, query = '') {
  learnArtists(yt);
  const songs = [...yt];
  const scOnly = [];
  const qk = plain(query).replace(/\s+/g, '');
  for (const raw of sc || []) {
    const s = fixTrack(raw);
    if (isRemix(s, query)) {
      scOnly.push(s);
      continue;
    }
    const twin = songs.find((t) => !isSc(t.id) && sameSong(t, s) && !isRemix(t, query));
    if (twin) {
      linkTwin(s.id, twin.id);
      continue;
    }
    // Même titre côté YouTube, mais remix ou artiste différent, alors que le compte SoundCloud est celui de
    // l'artiste cherché : c'est SoundCloud qui a le vrai son
    const sk = artistKey(s.artists?.[0]?.name);
    const remixIdx = songs.findIndex((t) => !isSc(t.id) && normTitle(t.title) === normTitle(s.title) && isRemix(t, query));
    const otherIdx = songs.findIndex((t) => !isSc(t.id) && normTitle(t.title) === normTitle(s.title) && !sameSong(t, { ...s, duration: 0 }));
    const fake = remixIdx >= 0 ? remixIdx : sk.length >= 2 && qk.includes(sk) ? otherIdx : -1;
    if (fake >= 0) {
      songs.splice(fake, 1, s);
      continue;
    }
    scOnly.push(s);
  }
  // Vraies versions avant les remix
  return { songs, scOnly: [...scOnly.filter((x) => !isRemix(x, query)), ...scOnly.filter((x) => isRemix(x, query))] };
}

// Sons SoundCloud de la bibliothèque : on cherche s'ils existent tels quels sur YouTube Music (même titre, même
// artiste, même durée, pas un remix). Si oui, ils sont rattachés à la fiche YouTube Music. 25 sons par lancement.
export async function discoverTwins(library, search) {
  const done = new Set(ls.get('boombox.twinChecked', []));
  const seen = new Set();
  const todo = [...(library.liked || []), ...(library.playlists || []).flatMap((p) => p.tracks)]
    .filter((t) => isSc(t?.id) && !twins()[t.id] && !done.has(t.id) && !seen.has(t.id) && seen.add(t.id))
    .slice(0, 25);
  let found = 0;
  for (const t of todo) {
    done.add(t.id);
    const r = await search(`${t.artists?.[0]?.name || ''} ${t.title}`).catch(() => null);
    const yt = (r?.items || []).map(({ type: _t, ...x }) => x).filter((x) => x.id && !isSc(x.id));
    learnArtists(yt);
    const twin = yt.find((x) => sameSong(x, t) && !isRemix(x, t.title));
    if (twin && !isRemix(t)) (linkTwin(t.id, twin.id), found++);
    await new Promise((res) => setTimeout(res, 1200));
  }
  if (todo.length) ls.set('boombox.twinChecked', [...done].slice(-5000));
  return found;
}

// Liste de sons sans doublons (deux versions du même son → la fiche principale, à sa première place)
export function dedupe(tracks) {
  const seen = new Set();
  return (tracks || []).filter((t) => {
    const k = canonId(t?.id);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
