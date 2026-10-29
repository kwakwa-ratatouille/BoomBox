// État global côté client : profil actif, appareil, bibliothèque (Firestore, synchro en direct) et appels au serveur local.
import { toast } from './ui.js';
import { isNative, localApi } from './native.js';
import { firebaseConfig } from './firebase-config.js';
import { cloud, db, getDocsFromCache, getDocsFromServer, where, doc, collection, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, writeBatch, serverTimestamp } from './cloud.js';

import { canonId, artistKey as aKey, canonArtist, fixTrack, learnArtists } from './twins.js';
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

const ls = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};
export { ls };

function makeDeviceId() {
  let id = ls.get('boombox.device');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    ls.set('boombox.device', id);
  }
  return id;
}

const isPhone = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) {
    // Modèle du téléphone quand Android le donne (ex. « SM-S918B », « Pixel 8 »)
    const m = ua.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/|\))/);
    return m && m[1].trim().length > 2 ? m[1].trim() : 'Téléphone Android';
  }
  if (/windows/i.test(ua)) return 'PC Windows';
  if (/mac/i.test(ua)) return 'Mac';
  return 'Navigateur';
}

export const state = {
  profile: null,
  profiles: [],
  device: { id: makeDeviceId(), name: ls.get('boombox.deviceName', defaultDeviceName()), kind: isPhone ? 'mobile' : 'desktop' },
  status: { ytdlp: false, lan: [] },
  library: { liked: [], playlists: [], follows: [], settings: {} },
  likedIds: new Set(),
  newReleases: 0,
  libVersion: 0, // incrémenté à chaque changement de la bibliothèque
};

// Appels au serveur local (recherche YouTube, paroles, import…)
export async function api(path, { method = 'GET', body, raw } = {}) {
  // Appli mobile : le « serveur » tourne dans le téléphone
  if (isNative) return (await localApi()).handle(path, { method, body });
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (raw) return r;
  let data = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) throw new Error(data?.error || `Erreur ${r.status}`);
  return data;
}

// Ne garde que les champs utiles d'un titre
export function cleanTrack(t) {
  if (!t?.id) return null;
  return {
    id: t.id,
    title: String(t.title || '').slice(0, 300),
    artists: (t.artists || []).slice(0, 10).map((a) => ({ name: String(a?.name || ''), id: a?.id || null })),
    album: t.album?.name ? { id: t.album.id || null, name: t.album.name } : null,
    duration: Number(t.duration) || 0,
    thumb: t.thumb || null,
  };
}

// Firestore limite un lot à 500 écritures
async function batched(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(b));
    await b.commit();
  }
}

// ---------- Profils ----------
export async function listProfiles(fresh = false) {
  // Cache local d'abord (démarrage instantané) ; le serveur seulement s'il est vide (première ouverture),
  // ou quand on affiche la liste des profils (un profil supprimé ailleurs ne doit pas réapparaître)
  const sort = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let snap = fresh ? null : await getDocsFromCache(cloud.col('profiles')).catch(() => null);
  if (fresh) snap = await Promise.race([getDocs(cloud.col('profiles')), new Promise((r) => setTimeout(r, 4000))]).catch(() => null);
  if (!snap || snap.empty) snap = (await getDocsFromCache(cloud.col('profiles')).catch(() => null)) || (await getDocs(cloud.col('profiles')));
  if (snap.empty && !fresh) snap = await getDocs(cloud.col('profiles'));
  else if (!fresh) getDocs(cloud.col('profiles')).then((s2) => ((state.profiles = sort(s2)), emit('profiles'))).catch(() => {});
  state.profiles = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return state.profiles;
}

const COLORS = ['#2ef28b', '#e91e63', '#ff9800', '#3f51b5', '#00bcd4', '#9c27b0', '#f44336', '#8bc34a'];
export async function createProfile(name) {
  const ref = doc(cloud.col('profiles'));
  const p = { name: String(name).slice(0, 40), color: COLORS[state.profiles.length % COLORS.length], createdAt: Date.now(), settings: {} };
  await setDoc(ref, p);
  return { id: ref.id, ...p };
}

export async function updateProfile(id, patch) {
  await updateDoc(cloud.ref('profiles', id), patch);
}

export async function deleteProfile(id) {
  const ops = [];
  for (const sub of ['liked', 'playlists', 'items', 'follows', 'history', 'imported', 'folders']) {
    const snap = await getDocs(cloud.col('profiles', id, sub));
    snap.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
  }
  ops.push((b) => b.delete(cloud.ref('profiles', id)));
  await batched(ops);
}

export function setProfile(p) {
  state.profile = p;
  // Nom d'appareil pas encore choisi : modèle + prénom du profil (« iPhone de Matis »)
  if (!localStorage.getItem('boombox.deviceName') && p?.name) {
    state.device.name = `${defaultDeviceName()} de ${p.name}`.slice(0, 40);
    ls.set('boombox.deviceName', state.device.name);
  }
  ls.set('boombox.profile', p.id);
  emit('profile', p);
}

// ---------- Bibliothèque (abonnements temps réel) ----------
const pcol = (sub) => cloud.col('profiles', state.profile.id, sub);
const pref = (sub, id) => cloud.ref('profiles', state.profile.id, sub, id);

let raw = { liked: null, playlists: null, items: null, follows: null, folders: null };
let unsubs = [];
let firstLoad = null;
let emitTimer = null;

function rebuild() {
  if (Object.values(raw).some((v) => v == null)) return;
  const byPl = new Map();
  for (const it of raw.items) {
    if (!byPl.has(it.playlistId)) byPl.set(it.playlistId, []);
    byPl.get(it.playlistId).push(it);
  }
  learnArtists(raw.liked);
  learnArtists(raw.items);
  const all = raw.playlists
    .map((p) => ({
      ...p,
      tracks: (byPl.get(p.id) || []).sort((a, b) => a.pos - b.pos).map(({ playlistId, pos, updatedAt, ...t }) => fixTrack(t)),
    }))
    // Épinglées d'abord, puis l'ordre choisi par l'utilisateur (glisser-déposer)
    .sort((a, b) => (!!b.pinned - !!a.pinned) || playlistKey(a) - playlistKey(b));
  // Playlists supprimées : gardées 30 jours dans la corbeille (récupérables), hors de la bibliothèque
  const playlists = all.filter((p) => !p.deletedAt);
  const trash = all.filter((p) => p.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  purgeOldTrash(trash);
  state.library = { ...state.library, liked: raw.liked.map(fixTrack), playlists, trash, follows: raw.follows, folders: raw.folders.sort((a, b) => folderKey(a) - folderKey(b)) };
  state.likedIds = new Set(raw.liked.flatMap((t) => [t.id, canonId(t.id)]));
  state.libVersion++;
  firstLoad?.();
  firstLoad = null;
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => emit('library', state.library), 30);
}

// ---------- Lecture économe des grosses collections (titres des playlists, likes) ----------
// Firebase gratuit = 50 000 lectures par jour. Relire 5 000 titres à chaque ouverture de l'appli coûte vite cher :
// on garde tout dans le cache de l'appareil (gratuit) et on ne demande au serveur que les documents modifiés
// depuis la dernière synchro (champ updatedAt). Une suppression = document marqué « deleted » (pour que les
// autres appareils la voient), effacé pour de bon après 30 jours.
const DAY = 86400e3;
const syncKey = (sub) => `boombox.sync.${state.profile.id}.${sub}`;
const now = () => Date.now();
const tomb = () => ({ deleted: true, updatedAt: now() });

function watchDelta(key, sub, map, sort) {
  const docs = new Map();
  let stop = null;
  let alive = true;
  const publish = () => {
    let list = [...docs.values()].filter((d) => !d.deleted);
    if (sort) list = list.sort(sort);
    raw[key] = list;
    rebuild();
  };
  const listen = (since) => {
    if (!alive) return;
    // includeMetadataChanges : on reçoit aussi la confirmation du serveur après nos propres écritures (pour avancer le repère)
    stop = onSnapshot(query(pcol(sub), where('updatedAt', '>', since)), { includeMetadataChanges: true }, (snap) => {
      let max = since;
      for (const d of snap.docs) if ((d.data().updatedAt || 0) > max) max = d.data().updatedAt;
      for (const ch of snap.docChanges()) {
        const d = map(ch.doc);
        docs.set(ch.doc.id, d);
        if (d.updatedAt > max) max = d.updatedAt;
      }
      if (snap.docChanges().length || raw[key] == null) publish();
      if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
        // Marge de 10 min : couvre un petit décalage d'horloge entre appareils (quelques relectures en trop, sans risque)
        ls.set(syncKey(sub), { at: Math.max(since, Math.min(max, now()) - 10 * 60e3), n: docs.size });
      }
    }, (e) => console.error(sub, e));
  };
  const full = async () => {
    const snap = await getDocsFromServer(pcol(sub));
    docs.clear();
    snap.docs.forEach((d) => docs.set(d.id, map(d)));
    publish();
    ls.set(syncKey(sub), { at: now() - 10 * 60e3, n: docs.size });
    purgeTombstones(sub, docs);
    listen(now() - 10 * 60e3);
  };
  (async () => {
    const last = ls.get(syncKey(sub), null);
    // Dernière synchro trop ancienne (plus de 25 jours) : on relit tout (les suppressions de plus de 30 jours ne laissent pas de trace)
    if (last?.at && now() - last.at < 25 * DAY) {
      try {
        const snap = await getDocsFromCache(pcol(sub));
        // Cache incomplet (vidé par le système…) : relecture complète
        if (snap.size >= last.n * 0.98) {
          snap.docs.forEach((d) => docs.set(d.id, map(d)));
          publish();
          return listen(last.at);
        }
      } catch {}
    }
    await full().catch((e) => {
      console.error(sub, e);
      listen(0);
    });
  })();
  return () => {
    alive = false;
    stop?.();
  };
}

// Suppressions de plus de 30 jours : effacées pour de bon (une fois par semaine au plus)
function purgeTombstones(sub, docs) {
  const k = `boombox.purge.${state.profile.id}.${sub}`;
  if (now() - ls.get(k, 0) < 7 * DAY) return;
  ls.set(k, now());
  const old = [...docs.entries()].filter(([, d]) => d.deleted && now() - (d.updatedAt || 0) > 30 * DAY);
  if (old.length) batched(old.map(([id]) => (b) => b.delete(pref(sub, id)))).catch(() => {});
}

export function subscribeLibrary() {
  unsubs.forEach((u) => u());
  raw = { liked: null, playlists: null, items: null, follows: null, folders: null };
  const ready = new Promise((r) => (firstLoad = r));
  const watch = (key, q, map) =>
    onSnapshot(q, { includeMetadataChanges: false }, (snap) => {
      raw[key] = snap.docs.map(map);
      rebuild();
    }, (e) => console.error(key, e));
  unsubs = [
    watchDelta('liked', 'liked', (d) => ({ ...d.data(), id: d.data().id || d.id }), (a, b) => (b.addedAt || 0) - (a.addedAt || 0)),
    watch('playlists', pcol('playlists'), (d) => ({ id: d.id, ...d.data() })),
    watchDelta('items', 'items', (d) => ({ ...d.data(), _item: d.id })),
    watch('follows', query(pcol('follows'), orderBy('followedAt', 'desc')), (d) => d.data()),
    watch('folders', pcol('folders'), (d) => ({ id: d.id, ...d.data() })),
    onSnapshot(cloud.ref('profiles', state.profile.id), (d) => {
      if (!d.exists()) return;
      const data = d.data();
      Object.assign(state.profile, { name: data.name, color: data.color, photo: data.photo || null, pin: data.pin || null, banner: data.banner || null, shareLikes: data.shareLikes !== false, spotifyAuth: data.spotifyAuth || null });
      state.library.settings = data.settings || {};
      emit('settings', state.library.settings);
      emit('profile', state.profile);
    }),
  ];
  return ready;
}
// Compatibilité : la bibliothèque est déjà à jour en temps réel.
export async function loadLibrary() {}

// ---------- Actions ----------
// Liké sous sa version YouTube ou SoundCloud : c'est le même son
export const isLiked = (id) => state.likedIds.has(id) || state.likedIds.has(canonId(id));

export async function toggleLike(track) {
  if (!track) return;
  const liked = isLiked(track.id);
  try {
    if (liked) {
      const c = canonId(track.id);
      for (const t of state.library.liked.filter((x) => x.id === track.id || canonId(x.id) === c)) await setDoc(pref('liked', t.id), { id: t.id, ...tomb() });
    }
    else await setDoc(pref('liked', track.id), { ...cleanTrack(track), addedAt: Date.now(), updatedAt: Date.now() });
    toast(liked ? 'Retiré des Titres likés' : 'Ajouté aux Titres likés');
  } catch (e) {
    toast(e.message);
  }
}

// La date d'ajout d'origine est conservée si elle existe (import), sinon c'est maintenant.
function itemOps(playlistId, tracks, startPos) {
  const now = Date.now();
  return tracks.map((t, i) => (b) => b.set(doc(pcol('items')), { ...cleanTrack(t), playlistId, pos: startPos + i, addedAt: t.addedAt || now, updatedAt: now }));
}

// extra : { cover, source: { platform, url, owner } } pour les playlists importées
// Ajoute plusieurs titres aux Titres likés en gardant leur date d'ajout d'origine (import des likes Spotify…)
export async function likeMany(tracks) {
  const fresh = tracks.filter((t) => t?.id && !isLiked(t.id));
  const now = Date.now();
  await batched(fresh.map((t) => (b) => b.set(pref('liked', t.id), { ...cleanTrack(t), addedAt: t.addedAt || now, updatedAt: now })));
  return fresh.length;
}

// Like tous les titres de toutes les playlists (sans doublons, date d'ajout d'origine conservée)
export async function likeAllPlaylistTracks() {
  const seen = new Set();
  const tracks = [];
  for (const p of state.library.playlists) for (const t of p.tracks) if (!seen.has(t.id)) (seen.add(t.id), tracks.push(t));
  return likeMany(tracks);
}

// ---------- Partage de playlist avec un ami ----------
// La playlist est copiée dans shares/{code} ; l'ami saisit le code dans « Importer » pour en avoir sa propre copie.
// ---------- Profil public (lien partageable) ----------
// Une copie « vitrine » du profil est publiée dans publicProfiles/{code} : nom, photo, tops du mois, playlists.
// Lisible par n'importe qui ayant le lien (page web /u?c=CODE), sans compte. Rien d'autre n'est exposé.
export const publicProfileUrl = (code) => `https://${firebaseConfig.projectId}.web.app/u?c=${code}`;
export async function publishProfile() {
  const p = state.profile;
  const code = p.publicCode || Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const s = await getStatsFull(30, null, 10).catch(() => null);
  const slim = (t) => ({ id: t.id, title: t.title, artists: (t.artists || []).map((a) => ({ name: a.name })), thumb: t.thumb || null });
  const thumbs = (pl) => [...new Set(pl.tracks.map((t) => t.thumb).filter(Boolean))].slice(0, 4);
  await setDoc(doc(db, 'publicProfiles', code), {
    by: cloud.uid,
    name: p.name,
    photo: p.photo || null,
    color: p.color || '#2ef28b',
    updatedAt: Date.now(),
    counts: { playlists: state.library.playlists.filter((pl) => pl.visibility === 'public').length, follows: state.library.follows.length, liked: state.library.liked.length },
    minutes: s?.minutes || 0,
    topArtists: (s?.topArtists || []).slice(0, 10).map((a) => ({ name: a.artist.name, thumb: a.thumb || null, count: a.count })),
    topTracks: (s?.topTracks || []).slice(0, 10).map((t) => ({ ...slim(t.track), count: t.count })),
    follows: state.library.follows.slice(0, 30).map((f) => ({ name: f.name, thumb: f.thumb || null })),
    // Seulement les playlists publiques (les privées n'apparaissent jamais sur le profil partagé)
    playlists: state.library.playlists.filter((pl) => pl.visibility === 'public').slice(0, 30).map((pl) => ({ name: pl.name, cover: pl.cover && pl.cover.length < 60000 ? pl.cover : null, thumbs: thumbs(pl), count: pl.tracks.length, tracks: pl.tracks.slice(0, 30).map(slim) })),
  });
  if (!p.publicCode) {
    await updateProfile(p.id, { publicCode: code, publicAt: Date.now() });
    p.publicCode = code;
  } else await updateProfile(p.id, { publicAt: Date.now() });
  p.publicAt = Date.now();
  return code;
}
export async function unpublishProfile() {
  const p = state.profile;
  if (!p.publicCode) return;
  await deleteDoc(doc(db, 'publicProfiles', p.publicCode)).catch(() => {});
  await updateProfile(p.id, { publicCode: null, publicAt: null });
  p.publicCode = null;
}
// Profil public mis à jour une fois par jour (tops, playlists), si l'utilisateur l'a activé
export function refreshPublicProfile() {
  const p = state.profile;
  if (p?.publicCode && Date.now() - (p.publicAt || 0) > 86400e3) publishProfile().catch(() => {});
}
export async function sharePlaylist(p) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => A[b % A.length]).join('');
  await setDoc(doc(db, 'shares', code), {
    by: cloud.uid,
    owner: state.profile.name,
    name: p.name,
    description: p.description || '',
    cover: p.cover && p.cover.length < 200000 ? p.cover : null,
    tracks: p.tracks.slice(0, 3000).map((t) => ({ ...cleanTrack(t), addedAt: t.addedAt || null })),
    createdAt: Date.now(),
  });
  return code;
}
export async function getShare(code) {
  const s = await getDoc(doc(db, 'shares', code.toUpperCase()));
  return s.exists() ? s.data() : null;
}

export async function createPlaylist(name, tracks = [], description = '', extra = {}) {
  const n = state.library.playlists.length + 1;
  const ref = doc(pcol('playlists'));
  const p = {
    // Nouvelle playlist : en haut de la liste (juste sous les épinglées)
    order: Math.min(0, ...state.library.playlists.map(playlistKey)) - 1000,
    name: String(name || `Ma playlist n°${n}`).slice(0, 100),
    description: String(description || '').slice(0, 500),
    pinned: false,
    createdAt: Date.now(),
    ...(extra.cover ? { cover: extra.cover } : {}),
    ...(extra.source ? { source: extra.source } : {}),
    ...(extra.banner ? { banner: extra.banner } : {}),
    ...(extra.playCounts ? { playCounts: extra.playCounts } : {}),
    ...(extra.topYear ? { topYear: extra.topYear } : {}),
  };
  const seen = new Set();
  const uniq = tracks.filter((t) => t?.id && !seen.has(t.id) && seen.add(t.id));
  await batched([(b) => b.set(ref, p), ...itemOps(ref.id, uniq, 0)]);
  // Option (activée par défaut) : tout titre ajouté à une playlist est aussi liké
  if (uniq.length && setting('autoLike', true) && setting('likeSavedPlaylists', true)) likeMany(uniq).catch(() => {});
  return { id: ref.id, ...p };
}

export async function addToPlaylist(playlistId, tracks, { quiet = false } = {}) {
  const pl = state.library.playlists.find((p) => p.id === playlistId);
  if (!pl) return;
  const have = new Set(pl.tracks.map((t) => t.id));
  const fresh = tracks.filter((t) => t?.id && !have.has(t.id) && have.add(t.id));
  const dupes = tracks.length - fresh.length;
  const maxPos = pl.tracks.length ? Math.max(...raw.items.filter((i) => i.playlistId === playlistId).map((i) => i.pos)) : -1;
  if (fresh.length) await batched(itemOps(playlistId, fresh, maxPos + 1));
  if (fresh.length && setting('autoLike', true)) likeMany(fresh).catch(() => {});
  if (quiet) return fresh.length;
  if (fresh.length) toast(`Ajouté à ${pl.name}${dupes ? ` (${dupes} déjà présent${dupes > 1 ? 's' : ''})` : ''}`);
  else toast(`Déjà dans ${pl.name}`);
  return fresh.length;
}

export async function removeFromPlaylist(playlistId, track) {
  const pl = state.library.playlists.find((p) => p.id === playlistId);
  const item = track?._item || pl?.tracks.find((t) => t.id === track?.id)?._item;
  if (!item) return toast('Titre introuvable dans la playlist');
  await updateDoc(pref('items', item), tomb());
  toast('Retiré de la playlist');
}

// Retire plusieurs titres d'un coup (détecteur de doublons) : _item = identifiant de la ligne dans la playlist
export async function removeItems(itemIds) {
  await batched(itemIds.map((id) => (b) => b.update(pref('items', id), tomb())));
}

// Même son ajouté sous sa version YouTube et sa version SoundCloud : on garde la première entrée (sa place dans la
// playlist et sa date d'ajout), l'autre est retirée. Deux ajouts du même identifiant ne sont pas touchés.
export async function mergeDuplicates() {
  const drop = [];
  for (const p of state.library.playlists) {
    const first = new Map();
    for (const t of p.tracks) {
      const c = canonId(t.id);
      const f = first.get(c);
      if (!f) first.set(c, t);
      else if (f.id !== t.id && t._item) drop.push(t._item);
    }
  }
  // Likes : la fiche principale reste likée, l'autre version est retirée
  const groups = new Map();
  for (const t of state.library.liked) groups.set(canonId(t.id), [...(groups.get(canonId(t.id)) || []), t.id]);
  const unlike = [];
  for (const [c, ids] of groups) {
    const uniq = [...new Set(ids)];
    if (uniq.length < 2) continue;
    const keep = uniq.includes(c) ? c : uniq[0];
    unlike.push(...uniq.filter((id) => id !== keep));
  }
  if (drop.length) await removeItems(drop);
  if (unlike.length) await batched(unlike.map((id) => (b) => b.set(pref('liked', id), { id, ...tomb() })));
  return drop.length + unlike.length;
}

export async function movePlaylistItem(playlistId, from, to) {
  const items = raw.items.filter((i) => i.playlistId === playlistId).sort((a, b) => a.pos - b.pos);
  const [moved] = items.splice(from, 1);
  if (!moved) return;
  items.splice(to, 0, moved);
  const prev = items[to - 1]?.pos;
  const next = items[to + 1]?.pos;
  const pos = prev == null ? (next ?? 0) - 1 : next == null ? prev + 1 : (prev + next) / 2;
  await updateDoc(pref('items', moved._item), { pos, updatedAt: Date.now() });
}

export async function updatePlaylist(id, patch) {
  await updateDoc(pref('playlists', id), patch);
}

// Supprimer = mettre à la corbeille (30 jours) ; on peut restaurer, ou supprimer définitivement
export const TRASH_DAYS = 30;
export const deletePlaylist = (id) => updateDoc(pref('playlists', id), { deletedAt: Date.now(), pinned: false });
export const restorePlaylist = (id) => updateDoc(pref('playlists', id), { deletedAt: null, order: Math.min(0, ...state.library.playlists.map(playlistKey)) - 1000 });
export async function purgePlaylist(id) {
  const ops = raw.items.filter((i) => i.playlistId === id).map((i) => (b) => b.update(pref('items', i._item), tomb()));
  ops.push((b) => b.delete(pref('playlists', id)));
  await batched(ops);
}
let purged = false;
function purgeOldTrash(trash) {
  if (purged) return;
  purged = true;
  const limit = Date.now() - TRASH_DAYS * 86400e3;
  for (const p of trash) if (p.deletedAt < limit) purgePlaylist(p.id).catch(() => {});
}

// ---------- Dossiers de playlists ----------
export async function createFolder(name) {
  const ref = doc(pcol('folders'));
  await setDoc(ref, { name: String(name).slice(0, 80), createdAt: Date.now() });
  return ref.id;
}
export const renameFolder = (id, name) => updateDoc(pref('folders', id), { name: String(name).slice(0, 80) });
export async function deleteFolder(id) {
  // Les playlists du dossier reviennent à la racine de la bibliothèque
  const ops = state.library.playlists.filter((p) => p.folderId === id).map((p) => (b) => b.update(pref('playlists', p.id), { folderId: null }));
  ops.push((b) => b.delete(pref('folders', id)));
  await batched(ops);
}
export const movePlaylistToFolder = (playlistId, folderId) => updateDoc(pref('playlists', playlistId), { folderId: folderId || null });

// Ordre des playlists : champ « order » (fixé par glisser-déposer), sinon date de création
export const playlistKey = (p) => p.order ?? p.createdAt ?? 0;

// ids : toutes les playlists dans le nouvel ordre voulu
export async function reorderPlaylists(ids) {
  await batched(ids.map((id, i) => (b) => b.update(pref('playlists', id), { order: i * 1000 })));
}

// Les dossiers sans ordre choisi restent en haut, du plus ancien au plus récent
export const folderKey = (f) => f.order ?? -1e12 + (f.createdAt || 0) / 1e3;
const folderIds = () => new Set((state.library.folders || []).map((f) => f.id));
export const folderOf = (p, known = folderIds()) => (p?.folderId && known.has(p.folderId) ? p.folderId : null);

// Racine de la bibliothèque en ordre perso : playlists épinglées, puis dossiers et playlists hors dossier mélangés
export function rootEntries() {
  const known = folderIds();
  const pls = state.library.playlists.filter((p) => !folderOf(p, known)).map((p) => ({ kind: 'playlist', id: p.id, pinned: !!p.pinned, key: playlistKey(p) }));
  const fos = (state.library.folders || []).map((f) => ({ kind: 'folder', id: f.id, pinned: false, key: folderKey(f) }));
  return [...pls, ...fos].sort((a, b) => b.pinned - a.pinned || a.key - b.key);
}
const entryRef = (e) => pref(e.kind === 'folder' ? 'folders' : 'playlists', e.id);
const sameEntry = (a, b) => a && b && a.kind === b.kind && a.id === b.id;

// Déplace un dossier ou une playlist à la racine : avant un autre élément ({ kind, id }), tout en haut / en bas, ou d'un cran (step ±1)
export async function moveRoot(item, { before = null, edge = null, step = 0 } = {}) {
  const all = rootEntries();
  const me = all.find((e) => sameEntry(e, item)) || { ...item, pinned: false };
  const list = all.filter((e) => !sameEntry(e, item));
  let at;
  if (step) {
    const j = all.indexOf(me) + step;
    if (!all.includes(me) || j < 0 || j >= all.length || all[j].pinned !== me.pinned) return;
    at = j;
  } else at = edge === 'top' ? 0 : edge === 'bottom' ? list.length : list.findIndex((e) => sameEntry(e, before));
  if (at < 0) at = list.length;
  list.splice(at, 0, me);
  const ops = list.map((e, i) => (b) => b.update(entryRef(e), { order: i * 1000 }));
  if (item.kind === 'playlist') {
    const extra = {};
    if (state.library.playlists.find((p) => p.id === item.id)?.folderId) extra.folderId = null; // sortie du dossier
    // Déposée parmi les épinglées → épinglée ; parmi les autres → désépinglée
    const target = before && all.find((e) => sameEntry(e, before));
    if (target && target.kind === 'playlist' && target.pinned !== me.pinned) extra.pinned = target.pinned;
    if (Object.keys(extra).length) ops.push((b) => b.update(entryRef(item), extra));
  }
  await batched(ops);
}

// Déplace une playlist avant une autre (ou tout en haut / tout en bas de son niveau). Déposée sur une playlist
// d'un dossier, elle entre dans ce dossier ; sur une playlist de la racine, elle en sort.
export async function movePlaylist(id, { before = null, edge = null } = {}) {
  const pls = state.library.playlists;
  const me = pls.find((p) => p.id === id);
  if (!me) return;
  const known = folderIds();
  const target = before && pls.find((p) => p.id === before);
  const dest = target ? folderOf(target, known) : folderOf(me, known);
  if (!dest) return moveRoot({ kind: 'playlist', id }, { before: target ? { kind: 'playlist', id: before } : null, edge });
  const list = pls.filter((p) => folderOf(p, known) === dest && p.id !== id).map((p) => p.id);
  let at = edge === 'top' ? 0 : edge === 'bottom' ? list.length : list.indexOf(before);
  if (at < 0) at = list.length;
  list.splice(at, 0, id);
  const ops = list.map((pid, i) => (b) => b.update(pref('playlists', pid), { order: i * 1000 }));
  const extra = {};
  if (me.folderId !== dest) extra.folderId = dest;
  if (target && !!target.pinned !== !!me.pinned) extra.pinned = !!target.pinned;
  if (Object.keys(extra).length) ops.push((b) => b.update(pref('playlists', id), extra));
  await batched(ops);
}

export const isFollowing = (id) => state.library.follows.some((f) => f.id === id);

export async function toggleFollow(artist) {
  const following = isFollowing(artist.id);
  if (following) await deleteDoc(pref('follows', artist.id));
  else await setDoc(pref('follows', artist.id), { id: artist.id, name: artist.name || '', thumb: artist.thumb || null, followedAt: Date.now(), known: null });
  toast(following ? `Tu ne suis plus ${artist.name}` : `Tu suis ${artist.name} — ses sorties apparaîtront dans Nouveautés`);
}

// Met à jour la photo des artistes suivis (récupérée sur YouTube Music)
export async function setFollowThumbs(map) {
  const ops = Object.entries(map)
    .filter(([id, thumb]) => state.library.follows.some((f) => f.id === id && f.thumb !== thumb))
    .map(([id, thumb]) => (b) => b.update(pref('follows', id), { thumb }));
  if (ops.length) await batched(ops);
}

export async function setKnownReleases(map) {
  const ops = Object.entries(map).map(([id, known]) => (b) => b.update(pref('follows', id), { known }));
  if (ops.length) await batched(ops);
}

export async function saveSettings(patch) {
  Object.assign(state.library.settings, patch);
  emit('settings', state.library.settings);
  const flat = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`settings.${k}`, v]));
  await updateDoc(cloud.ref('profiles', state.profile.id), flat);
}

// « Ne plus proposer ce titre » : exclu de la lecture automatique, des radios et sauté dans les playlists
export async function toggleBan(track) {
  const banned = setting('banned', []);
  const on = banned.includes(track.id);
  await saveSettings({ banned: on ? banned.filter((id) => id !== track.id) : [...banned, track.id].slice(-2000) });
  toast(on ? `« ${track.title} » est de nouveau proposé` : `« ${track.title} » ne sera plus proposé (masqué des recherches et suggestions)`);
  emit('library');
  toast(on ? `« ${track.title} » pourra de nouveau être proposé` : `« ${track.title} » ne sera plus proposé`);
  return !on;
}

export function setting(key, def) {
  return state.library.settings?.[key] ?? def;
}

// ---------- Rapports d'import et de synchronisation ----------
// Chaque import ou mise à jour d'une playlist laisse un rapport : titres ajoutés, titres déjà présents, titres
// introuvables (et pourquoi). Consultables dans « Rapports d'import » et depuis la playlist.
export async function addReport(r) {
  const clip = (a) => (a || []).slice(0, 400);
  const ref = await addDoc(pcol('reports'), { ...r, added: clip(r.added), missing: clip(r.missing), at: Date.now() });
  return ref.id;
}
export async function getReports(n = 60) {
  const snap = await getDocs(query(pcol('reports'), orderBy('at', 'desc'), limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Historique & stats ----------
// Renvoie de quoi noter ensuite le temps réellement écouté (setHeard), à la fin de l'écoute
export function addHistory(track) {
  const h = { ...cleanTrack(track), playedAt: Date.now() };
  if (hist?.pid === state.profile.id) hist.list.unshift(h);
  const ref = addDoc(pcol('history'), h).catch(() => null);
  emit('history', h);
  return { h, ref };
}
// Temps réellement écouté (secondes) : les minutes du classement et des stats comptent ce temps-là, pas la durée
// entière du son (avant : 30 s d'écoute d'un son de 4 min comptaient 4 min)
export function setHeard(entry, sec) {
  if (!entry?.h || !(sec > 0)) return;
  entry.h.heard = Math.round(sec);
  entry.ref.then((r) => r && updateDoc(r, { heard: entry.h.heard })).catch(() => {});
}
// Durée comptée d'une écoute : le temps écouté s'il est connu (au plus la durée du son), sinon la durée du son
const listenSec = (x) => (x.heard != null ? Math.min(x.heard, x.duration || x.heard) : x.duration || 0);

// Historique : les écoutes ne changent jamais une fois écrites. On garde tout dans le cache de l'appareil et on ne
// demande au serveur que les écoutes plus récentes que la dernière synchro (au lieu de relire 5 000 documents
// à chaque visite des stats ou de l'accueil).
let hist = null; // { pid, list (plus récentes d'abord), checked }
let histLoading = null;
async function loadHistory() {
  if (hist?.pid === state.profile.id && Date.now() - hist.checked < 60e3) return hist.list;
  if (histLoading) return histLoading;
  histLoading = (async () => {
    const key = `boombox.sync.${state.profile.id}.history`;
    const last = ls.get(key, null);
    let list = hist?.pid === state.profile.id ? hist.list : null;
    let since = list ? last?.at || 0 : 0;
    if (!list && last?.at) {
      const snap = await getDocsFromCache(pcol('history')).catch(() => null);
      if (snap && snap.size >= last.n * 0.98) {
        list = snap.docs.map((d) => d.data());
        since = last.at;
      }
    }
    if (list) {
      const fresh = await getDocsFromServer(query(pcol('history'), where('playedAt', '>', since))).catch(() => null);
      const seen = new Set(list.map((h) => `${h.id}|${h.playedAt}`));
      for (const d of fresh?.docs || []) {
        const h = d.data();
        if (!seen.has(`${h.id}|${h.playedAt}`)) list.push(h);
      }
    } else {
      list = (await getDocs(query(pcol('history'), orderBy('playedAt', 'desc'), limit(10000)))).docs.map((d) => d.data());
    }
    list.sort((a, b) => b.playedAt - a.playedAt);
    hist = { pid: state.profile.id, list, checked: Date.now() };
    ls.set(key, { at: (list[0]?.playedAt || 0) - 60e3, n: list.length });
    return list;
  })().finally(() => (histLoading = null));
  return histLoading;
}

export async function getHistory(n = 200) {
  return (await loadHistory()).slice(0, n);
}

// ---------- Historique importé (données Spotify) ----------
// Pour rester dans les limites gratuites de Firestore, les écoutes importées sont regroupées par titre
// et par période (jour pour le dernier mois, mois avant), dans quelques gros documents.
// entry : { id (YouTube ou null), title, artists, album, thumb, duration, b: { période: écoutes }, s: { période: secondes } }
let importedCache = null;
export async function getImported() {
  if (importedCache?.pid === state.profile.id) return importedCache.entries;
  const snap = await getDocs(pcol('imported'));
  const entries = snap.docs.flatMap((d) => d.data().entries || []);
  importedCache = { pid: state.profile.id, entries };
  return entries;
}

export async function saveImported(entries) {
  const old = await getDocs(pcol('imported'));
  const ops = old.docs.map((d) => (b) => b.delete(d.ref));
  for (let i = 0, n = 0; i < entries.length; i += 600, n++) {
    const chunk = entries.slice(i, i + 600);
    ops.push((b) => b.set(pref('imported', `c${n}`), { entries: chunk, importedAt: Date.now() }));
  }
  await batched(ops);
  importedCache = { pid: state.profile.id, entries };
}

// Années où il y a des écoutes (Boombox + historique Spotify importé), de la plus récente à la plus ancienne
export async function listeningYears() {
  const years = new Set([new Date().getFullYear()]);
  for (const h of await loadHistory().catch(() => [])) if (h.playedAt) years.add(new Date(h.playedAt).getFullYear());
  for (const e of await getImported().catch(() => [])) for (const k of Object.keys(e.b || {})) years.add(Number(k.slice(0, 4)));
  return [...years].filter((y) => y > 2000).sort((a, b) => b - a);
}

// Fin (en ms) d'une période « AAAA-MM » ou « AAAA-MM-JJ »
const bucketEnd = (k) => (k.length === 7 ? new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 1).getTime() : Date.parse(k) + 86400e3);

export async function followMany(artists) {
  const fresh = artists.filter((a) => a?.id && !isFollowing(a.id));
  const now = Date.now();
  await batched(fresh.map((a) => (b) => b.set(pref('follows', a.id), { id: a.id, name: a.name || '', thumb: a.thumb || null, followedAt: now, known: null })));
  return fresh.length;
}

export async function getStats(days = 30) {
  const since = Date.now() - days * 86400e3;
  const h = (await getHistory(5000)).filter((x) => x.playedAt >= since);
  const imported = await getImported().catch(() => []);
  const tracks = new Map();
  const artists = new Map();
  let seconds = 0;
  let plays = 0;
  const count = (t, n, sec) => {
    plays += n;
    seconds += sec;
    const key = canonId(t.id) || `${t.artists?.[0]?.name}|${t.title}`;
    const e = tracks.get(key) || { track: fixTrack(t), count: 0 };
    if (e.track.id !== key && t.id === key) e.track = t; // fiche principale (YouTube Music) de préférence
    e.count += n;
    tracks.set(key, e);
    const a = canonArtist(t.artists?.[0]);
    if (a?.name) {
      const k = aKey(a.name);
      const ea = artists.get(k) || { artist: a, count: 0, thumb: t.thumb };
      ea.count += n;
      if (!ea.artist.id && a.id) ea.artist = a;
      if (!ea.thumb && t.thumb) ea.thumb = t.thumb;
      artists.set(k, ea);
    }
  };
  for (const x of h) count(x, 1, listenSec(x));
  for (const e of imported) {
    let n = 0;
    let sec = 0;
    for (const [k, c] of Object.entries(e.b || {})) {
      if (bucketEnd(k) > since) {
        n += c;
        sec += e.s?.[k] || 0;
      }
    }
    if (n) count(e, n, sec);
  }
  const top = (m, filter = () => true) => [...m.values()].filter(filter).sort((a, b) => b.count - a.count).slice(0, 10);
  return {
    days,
    plays,
    minutes: Math.round(seconds / 60),
    // Seuls les titres retrouvés sur YouTube peuvent être lus
    topTracks: top(tracks, (e) => e.track.id && e.track.id.length === 11),
    topArtists: top(artists),
    hasImported: imported.length > 0,
  };
}

// Statistiques détaillées pour la page « Ton récap » : chiffres clés, comparaison avec la période
// précédente, écoutes par jour/mois, heures et jours de la semaine, tops, série de jours, découvertes.
// range (facultatif) : { since, until } en ms, pour une période précise (ex. une année) ; top : taille des classements
export async function getStatsFull(days = 30, range = null, top = 10) {
  const DAY = 86400e3;
  const now = range?.until ?? Date.now();
  const all = !range && days >= 3650;
  const since = range ? range.since : all ? 0 : now - days * DAY;
  if (range) days = Math.max(1, Math.round((now - since) / DAY));
  const prevSince = all ? 0 : since - days * DAY;
  const [live, imported] = await Promise.all([getHistory(5000).catch(() => []), getImported().catch(() => [])]);
  const events = [];
  for (const x of live) events.push({ ts: x.playedAt, n: 1, sec: listenSec(x), t: x, exact: true });
  for (const e of imported) {
    for (const [k, c] of Object.entries(e.b || {})) {
      const month = k.length === 7;
      const ts = month ? new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 15).getTime() : Date.parse(k) + 12 * 3600e3;
      events.push({ ts, n: c, sec: e.s?.[k] || 0, t: e, month });
    }
  }
  const cur = events.filter((e) => e.ts >= since && e.ts <= now);
  const prev = all ? [] : events.filter((e) => e.ts >= prevSince && e.ts < since);
  const sum = (arr, f) => arr.reduce((s, e) => s + f(e), 0);
  const artistKey = (t) => aKey(t.artists?.[0]?.name);
  const trackKey = (t) => canonId(t.id) || `${artistKey(t)}|${t.title}`;

  const tops = (keyOf, mk) => {
    const m = new Map();
    for (const e of cur) {
      const k = keyOf(e.t);
      if (!k) continue;
      const x = m.get(k) || mk(e.t);
      if (x.track && x.track.id !== k && e.t.id === k) x.track = e.t; // fiche principale (YouTube Music) de préférence
      x.count += e.n;
      x.seconds += e.sec;
      if (!x.thumb && e.t.thumb) x.thumb = e.t.thumb;
      if (x.artist && !x.artist.id && e.t.artists?.[0]?.id) x.artist = e.t.artists[0];
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  };
  const topArtists = tops(artistKey, (t) => ({ artist: canonArtist(t.artists?.[0]) || { name: '?' }, count: 0, seconds: 0, thumb: t.thumb }));
  const topTracksAll = tops(trackKey, (t) => ({ track: fixTrack(t), count: 0, seconds: 0 }));
  const topAlbums = tops((t) => (t.album?.name ? `${artistKey(t)}|${t.album.name.toLowerCase()}` : ''), (t) => ({ album: t.album, artist: t.artists?.[0], count: 0, seconds: 0, thumb: t.thumb }));

  // Série temporelle : par jour (≤ 31 jours) sinon par mois
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const monthKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const daily = days <= 31;
  const buckets = new Map();
  if (daily) {
    for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(now - i * DAY), 0);
    for (const e of cur) if (!e.month) buckets.set(dayKey(e.ts), (buckets.get(dayKey(e.ts)) || 0) + e.n);
  } else {
    const first = all ? cur.reduce((m, e) => Math.min(m, e.ts), now) : since;
    const d = new Date(first);
    for (let y = d.getFullYear(), m = d.getMonth(); new Date(y, m, 1).getTime() <= now; m === 11 ? (y++, (m = 0)) : m++) buckets.set(`${y}-${pad(m + 1)}`, 0);
    for (const e of cur) buckets.set(monthKey(e.ts), (buckets.get(monthKey(e.ts)) || 0) + e.n);
  }

  // Heures (écoutes faites dans Boombox, horodatées) et jours de la semaine
  const hours = new Array(24).fill(0);
  const weekdays = new Array(7).fill(0);
  for (const e of cur) {
    if (e.exact) hours[new Date(e.ts).getHours()] += e.n;
    if (!e.month) weekdays[(new Date(e.ts).getDay() + 6) % 7] += e.n;
  }

  // Série : jours consécutifs avec au moins une écoute
  const activeDays = new Set(events.filter((e) => !e.month).map((e) => dayKey(e.ts)));
  let streak = 0;
  for (let i = activeDays.has(dayKey(now)) ? 0 : 1; activeDays.has(dayKey(now - i * DAY)); i++) streak++;
  let best = 0;
  let run = 0;
  for (const k of [...activeDays].sort()) {
    const prevDay = dayKey(Date.parse(k) - DAY + 12 * 3600e3);
    run = activeDays.has(prevDay) ? run + 1 : 1;
    best = Math.max(best, run);
  }

  // Découvertes : artistes écoutés pour la première fois pendant la période
  const firstSeen = new Map();
  for (const e of events) {
    const k = artistKey(e.t);
    if (k && (!firstSeen.has(k) || e.ts < firstSeen.get(k))) firstSeen.set(k, e.ts);
  }
  const discoveries = all ? [] : topArtists.filter((a) => firstSeen.get(aKey(a.artist.name)) >= since);

  const plays = sum(cur, (e) => e.n);
  const prevPlays = sum(prev, (e) => e.n);
  const seconds = sum(cur, (e) => e.sec);
  const prevSeconds = sum(prev, (e) => e.sec);
  const dayCounts = [...buckets.entries()];
  const peak = daily ? dayCounts.reduce((m, x) => (x[1] > m[1] ? x : m), ['', 0]) : null;
  return {
    days, daily, plays, prevPlays, minutes: Math.round(seconds / 60), prevMinutes: Math.round(prevSeconds / 60),
    uniqueTracks: topTracksAll.length, uniqueArtists: topArtists.length,
    perDay: plays / (all ? Math.max(1, activeDays.size) : days),
    series: dayCounts, hours, weekdays, streak, bestStreak: best, peak,
    topArtists: topArtists.slice(0, top),
    topTracks: topTracksAll.filter((x) => x.track.id && x.track.id.length === 11).slice(0, top),
    topAlbums: topAlbums.slice(0, 6),
    discoveries: discoveries.slice(0, 12),
    hasImported: imported.length > 0,
    hasLive: live.length > 0,
  };
}

// ---------- Sauvegarde ----------
export async function exportLibrary() {
  const { liked, playlists, follows, settings } = state.library;
  return {
    boombox: 1,
    exportedAt: new Date().toISOString(),
    liked,
    playlists: playlists.map(({ tracks, ...p }) => ({ ...p, tracks: tracks.map(({ _item, ...t }) => t) })),
    follows,
    settings,
    history: await getHistory(5000),
  };
}

export async function restoreLibrary(data) {
  if (!data?.boombox && !data?.musikal) throw new Error('Fichier de sauvegarde invalide');
  const ops = [];
  for (const t of data.liked || []) if (t?.id) ops.push((b) => b.set(pref('liked', t.id), { ...cleanTrack(t), addedAt: t.addedAt || Date.now(), updatedAt: Date.now() }));
  for (const f of data.follows || []) if (f?.id) ops.push((b) => b.set(pref('follows', f.id), { id: f.id, name: f.name || '', thumb: f.thumb || null, followedAt: f.followedAt || Date.now(), known: f.known || null }));
  for (const p of data.playlists || []) {
    const ref = doc(pcol('playlists'));
    ops.push((b) => b.set(ref, { name: p.name || 'Playlist', description: p.description || '', pinned: !!p.pinned, cover: p.cover || null, createdAt: p.createdAt || Date.now() }));
    (p.tracks || []).forEach((t, i) => t?.id && ops.push((b) => b.set(doc(pcol('items')), { ...cleanTrack(t), playlistId: ref.id, pos: i, addedAt: t.addedAt || Date.now(), updatedAt: Date.now() })));
  }
  for (const h of (data.history || []).slice(0, 3000)) if (h?.id) ops.push((b) => b.set(doc(pcol('history')), { ...cleanTrack(h), playedAt: h.playedAt || Date.now() }));
  await batched(ops);
}

export { serverTimestamp, collection };
