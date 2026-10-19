// Blend : une playlist commune qui mélange tes goûts et ceux d'un ami.
// L'ami peut être sur Boombox (lien ou code de son profil public) ou sur Spotify (lien de son profil ou d'une
// de ses playlists). Les titres que vous aimez tous les deux passent en premier, puis vos titres s'alternent.
import { state, api, createPlaylist, getStatsFull } from './state.js';
import { db, doc, getDoc } from './cloud.js';
import { html, toast, promptText, plural } from './ui.js';

const key = (t) => `${String(t.title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*[([].*?[)\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, '')}|${String(t.artists?.[0]?.name || '').toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]+/gu, '')}`;
const artistKey = (t) => String(t.artists?.[0]?.name || '').toLowerCase();

async function friendFromBoombox(code) {
  const snap = await getDoc(doc(db, 'publicProfiles', code));
  if (!snap.exists()) throw new Error('Profil Boombox introuvable (il doit être partagé : Profil → Partager mon profil)');
  const p = snap.data();
  const tracks = [...(p.topTracks || []), ...(p.playlists || []).flatMap((pl) => pl.tracks || [])];
  return { name: p.name, tracks };
}

async function friendFromSpotify(url) {
  const job = await api('/api/import', { method: 'POST', body: { input: url } });
  let j;
  const t0 = Date.now();
  do {
    await new Promise((r) => setTimeout(r, 1500));
    j = await api(`/api/import/${job.id}`);
  } while (j.status === 'running' && Date.now() - t0 < 5 * 60e3);
  if (j.status !== 'done') throw new Error(j.error || 'Lecture du profil Spotify impossible');
  return { name: j.owner || 'ton ami', tracks: j.tracks || [] };
}

export async function startBlend() {
  const input = await promptText('Blend avec un ami', {
    multiline: true,
    label: 'Créer le Blend',
    placeholder: 'Colle le lien de son profil Boombox (Profil → Partager mon profil),\nou le lien de son profil Spotify, ou d’une de ses playlists Spotify',
  });
  if (!input || input === 'Annuler') return;
  const text = input.trim();
  const bb = text.match(/[?&]c=([A-Z0-9]{6,12})/i) || (/^[A-Z0-9]{8}$/i.test(text) && [null, text]);
  toast('Préparation du Blend…', { timeout: 8000 });
  try {
    const friend = bb ? await friendFromBoombox(bb[1].toUpperCase()) : /spotify\.com|spotify\.link/i.test(text) ? await friendFromSpotify(text) : null;
    if (!friend) return toast('Lien non reconnu : profil Boombox, profil ou playlist Spotify');
    if (!friend.tracks.length) return toast('Pas assez de titres chez ton ami pour un Blend');
    // Mes goûts : mes titres les plus écoutés (3 mois), puis mes likes récents
    const stats = await getStatsFull(90, null, 60).catch(() => null);
    const mine = [...(stats?.topTracks || []).map((t) => t.track), ...state.library.liked.slice(0, 300)];
    const mineKeys = new Set(mine.map(key));
    const friendKeys = new Set(friend.tracks.map(key));
    const friendArtists = new Set(friend.tracks.map(artistKey));
    const mineArtists = new Set(mine.map(artistKey));
    const used = new Set();
    const take = (t) => {
      const k = key(t);
      if (!t?.id || used.has(k)) return false;
      used.add(k);
      return true;
    };
    // 1. Titres en commun ; 2. tes titres d'artistes qu'il aime aussi, et inversement ; 3. le reste, en alternance
    const common = mine.filter((t) => friendKeys.has(key(t)) && take(t));
    const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    const myRest = shuffle(mine.filter((t) => !friendKeys.has(key(t)))).sort((a, b) => friendArtists.has(artistKey(b)) - friendArtists.has(artistKey(a)));
    const hisRest = shuffle(friend.tracks.filter((t) => !mineKeys.has(key(t)))).sort((a, b) => mineArtists.has(artistKey(b)) - mineArtists.has(artistKey(a)));
    const out = [...common];
    for (let i = 0; out.length < 50 && (i < myRest.length || i < hisRest.length); i++) {
      if (myRest[i] && take(myRest[i])) out.push(myRest[i]);
      if (hisRest[i] && out.length < 50 && take(hisRest[i])) out.push(hisRest[i]);
    }
    const me = state.profile.name;
    const pl = await createPlaylist(`Blend · ${me} + ${friend.name}`, out, `Vos goûts mélangés : ${plural(common.length, 'titre')} en commun, puis vos sons préférés en alternance.`);
    toast(`Blend créé avec ${friend.name}${common.length ? ` · ${plural(common.length, 'titre')} en commun` : ''}`, { action: 'Écouter', onAction: () => (location.hash = `#/playlist/${pl.id}`) });
    location.hash = `#/playlist/${pl.id}`;
  } catch (e) {
    toast('Blend impossible : ' + e.message, { timeout: 7000 });
  }
}
