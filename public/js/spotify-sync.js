// Synchro vers Spotify : chaque personne connecte SON compte Spotify (bouton « Se connecter à Spotify »), puis
// - les titres likés dans Boombox sont aussi likés sur Spotify ;
// - les playlists créées dans Boombox (ou envoyées avec « Copier sur Spotify ») sont recréées sur Spotify
//   et les titres qu'on y ajoute suivent.
// Connexion « PKCE » (aucun mot de passe ni secret dans l'appli) ; le jeton est gardé dans le profil Boombox.
// Les sons absents de Spotify (remix YouTube, fichiers du PC) sont simplement ignorés.
import { state, on, updateProfile, updatePlaylist, ls } from './state.js';
import { toast, plural } from './ui.js';

// Identifiant (public) de l'application Spotify « Boombox » du tableau de bord développeur Spotify
export const SPOTIFY_CLIENT_ID = '02d03bc4117947269cbfc2cacc04cfb0';
const SCOPES = 'playlist-modify-private playlist-modify-public user-library-modify user-library-read user-read-private';
const native = () => !!window.Capacitor?.isNativePlatform?.();
// L'appli téléphone tourne aussi sur « localhost » (Capacitor) : ce n'est pas le PC pour autant
const isPc = () => !native() && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// Adresse de retour (à déclarer telle quelle dans le tableau de bord Spotify)
const redirectUri = () => (isPc() ? 'http://127.0.0.1:8787/spotify-callback.html' : 'https://musikal-b72d1.web.app/spotify-callback.html');

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n = 64) => b64url(crypto.getRandomValues(new Uint8Array(n))).slice(0, n);

export const spotifyReady = () => !!SPOTIFY_CLIENT_ID;
export const spotifyAccount = () => state.profile?.spotifyAuth || null;

// ---------- Connexion ----------
export async function connectSpotify() {
  if (!SPOTIFY_CLIENT_ID) return toast('La connexion Spotify n’est pas encore configurée');
  const verifier = rand(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const st = rand(16);
  ls.set('boombox.spotifyPkce', { verifier, state: st, redirect: redirectUri() });
  const url = `https://accounts.spotify.com/authorize?${new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(), code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state: st })}`;
  if (native()) {
    location.href = url; // retour par boombox://spotify?code=… (voir handleSpotifyLink)
    return;
  }
  const win = window.open(url, 'spotify-login', 'width=480,height=720');
  if (!win) location.href = url;
  // Le code revient par message de la fenêtre, ou (PC) par le serveur local
  return new Promise((resolve) => {
    let done = false;
    const finish = async (data) => {
      if (done || !data || data.state !== st) return;
      done = true;
      removeEventListener('message', onMsg);
      clearInterval(poll);
      resolve(await finishLogin(data));
    };
    const onMsg = (e) => e.data?.type === 'boombox-spotify' && finish(e.data);
    addEventListener('message', onMsg);
    const t0 = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - t0 > 5 * 60e3) return clearInterval(poll);
      if (!isPc()) return;
      const r = await fetch(`/api/spotify/code?state=${st}`).then((x) => x.json()).catch(() => ({}));
      if (r.state) finish(r);
    }, 1500);
  });
}

// Appli téléphone : retour de Spotify par le lien boombox://spotify?code=…&state=…
export async function handleSpotifyLink(url) {
  const q = new URLSearchParams(String(url).split('?')[1] || '');
  return finishLogin({ code: q.get('code'), error: q.get('error'), state: q.get('state') });
}

async function finishLogin({ code, error, state: st }) {
  const pk = ls.get('boombox.spotifyPkce', null);
  if (error || !code) return toast('Connexion Spotify annulée'), false;
  if (!pk || pk.state !== st) return toast('Connexion Spotify expirée, réessaie'), false;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: pk.redirect, client_id: SPOTIFY_CLIENT_ID, code_verifier: pk.verifier }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) return toast(`Spotify a refusé la connexion${j.error_description ? ` : ${j.error_description}` : ''}`), false;
  tok = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  const me = await sp('/me').catch(() => null);
  if (!me?.id) return toast('Compte Spotify inaccessible : demande à Matis de t’ajouter dans l’appli Spotify Boombox'), false;
  const auth = { refresh: j.refresh_token, user: me.id, name: me.display_name || me.id, at: Date.now(), device: state.device.id };
  state.profile.spotifyAuth = auth;
  await updateProfile(state.profile.id, { spotifyAuth: auth });
  ls.set('boombox.spotifyPkce', null);
  markCurrentAsSynced();
  toast(`Connecté à Spotify (${auth.name}) : tes nouveaux likes et playlists y seront ajoutés`);
  return true;
}

export async function disconnectSpotify() {
  state.profile.spotifyAuth = null;
  tok = null;
  await updateProfile(state.profile.id, { spotifyAuth: null });
  toast('Compte Spotify déconnecté');
}

// ---------- Appels à l'API Spotify ----------
let tok = null;
async function token() {
  if (tok && tok.exp > Date.now()) return tok.value;
  const a = spotifyAccount();
  if (!a?.refresh) throw new Error('Spotify non connecté');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: SPOTIFY_CLIENT_ID }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('Reconnecte ton compte Spotify (Paramètres)');
  tok = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  if (j.refresh_token && j.refresh_token !== a.refresh) {
    const auth = { ...a, refresh: j.refresh_token };
    state.profile.spotifyAuth = auth;
    updateProfile(state.profile.id, { spotifyAuth: auth }).catch(() => {});
  }
  return tok.value;
}
async function sp(path, { method = 'GET', body } = {}) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.spotify.com/v1${path}`, { method, headers: { authorization: `Bearer ${await token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, (Number(r.headers.get('retry-after')) || 2) * 1000));
      continue;
    }
    if (r.status === 401) tok = null;
    if (!r.ok) throw new Error(`Spotify ${r.status}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  throw new Error('Spotify trop sollicité');
}

// Titre Boombox → titre Spotify (recherche titre + artiste, gardée en mémoire)
const uriCache = ls.get('boombox.spotifyUris', {}) || {};
const saveUris = () => ls.set('boombox.spotifyUris', uriCache);
const cleanTitle = (s) => String(s || '').replace(/\s*[([].*?(official|clip|audio|lyrics|paroles|video|visualizer).*?[)\]]/gi, '').replace(/\s+-\s+topic$/i, '').trim();
async function uriOf(t) {
  if (!t?.id || /^lf_/.test(t.id)) return null;
  if (t.id in uriCache) return uriCache[t.id];
  const artist = t.artists?.[0]?.name || '';
  const q = `track:${cleanTitle(t.title)}${artist ? ` artist:${artist}` : ''}`;
  const r = await sp(`/search?type=track&limit=1&q=${encodeURIComponent(q)}`).catch(() => null);
  let uri = r?.tracks?.items?.[0]?.uri || null;
  if (!uri && artist) {
    const r2 = await sp(`/search?type=track&limit=1&q=${encodeURIComponent(`${cleanTitle(t.title)} ${artist}`)}`).catch(() => null);
    uri = r2?.tracks?.items?.[0]?.uri || null;
  }
  uriCache[t.id] = uri;
  saveUris();
  return uri;
}

// ---------- Synchro (sur l'appareil qui a connecté le compte, pour ne rien envoyer en double) ----------
const SKEY = () => `boombox.spotifySynced.${state.profile?.id}`;
const synced = () => ls.get(SKEY(), { likes: [], pl: {} }) || { likes: [], pl: {} };
function markCurrentAsSynced() {
  // Au moment de la connexion : seuls les likes et playlists SUIVANTS partent (pas tout l'historique d'un coup)
  ls.set(SKEY(), { likes: state.library.liked.map((t) => t.id), pl: {} });
}
const myDevice = () => spotifyAccount()?.device === state.device.id;

let running = false;
async function syncNow() {
  const a = spotifyAccount();
  if (!a || !SPOTIFY_CLIENT_ID || !myDevice() || running) return;
  running = true;
  try {
    const s = synced();
    // Likes ajoutés depuis la dernière fois
    const known = new Set(s.likes);
    const fresh = state.library.liked.filter((t) => !known.has(t.id)).slice(0, 100);
    const ids = [];
    for (const t of fresh) {
      const uri = await uriOf(t);
      if (uri) ids.push(uri.split(':')[2]);
      s.likes.push(t.id);
    }
    for (let i = 0; i < ids.length; i += 50) await sp(`/me/tracks?ids=${ids.slice(i, i + 50).join(',')}`, { method: 'PUT' });
    // Playlists : créées après la connexion, ou envoyées avec « Copier sur Spotify »
    for (const p of state.library.playlists) {
      const want = p.spotifySync || (p.createdAt || 0) > a.at;
      if (!want) continue;
      let pid = p.spotifyId;
      if (!pid) {
        const created = await sp('/me/playlists', { method: 'POST', body: { name: p.name, description: (p.description || 'Créée avec Boombox').slice(0, 300), public: false } });
        pid = created?.id;
        if (!pid) continue;
        await updatePlaylist(p.id, { spotifyId: pid, spotifySync: true });
      }
      const done = new Set(s.pl[p.id] || []);
      const add = [];
      for (const t of p.tracks) {
        if (done.has(t.id)) continue;
        const uri = await uriOf(t);
        if (uri) add.push(uri);
        done.add(t.id);
      }
      for (let i = 0; i < add.length; i += 100) await sp(`/playlists/${pid}/tracks`, { method: 'POST', body: { uris: add.slice(i, i + 100) } });
      s.pl[p.id] = [...done];
    }
    ls.set(SKEY(), s);
  } catch (e) {
    console.warn('Spotify :', e.message);
  } finally {
    running = false;
  }
}

// Envoyer une playlist existante sur Spotify (menu de la playlist)
export async function copyPlaylistToSpotify(p) {
  if (!spotifyAccount()) return toast('Connecte d’abord ton compte Spotify (Paramètres → Spotify)');
  await updatePlaylist(p.id, { spotifySync: true });
  toast(`« ${p.name} » part sur Spotify (${plural(p.tracks.length, 'titre')})…`);
  setTimeout(syncNow, 1500);
}

// Envoyer tous mes likes d'avant la connexion
export async function pushAllLikes() {
  const s = synced();
  s.likes = [];
  ls.set(SKEY(), s);
  toast(`Envoi de tes ${state.library.liked.length} likes sur Spotify (ça prend quelques minutes)…`);
  for (let k = 0; k < 40 && synced().likes.length < state.library.liked.length; k++) await syncNow();
  toast('Likes envoyés sur Spotify');
}

let timer = null;
export function startSpotifySync() {
  on('library', () => (clearTimeout(timer), (timer = setTimeout(syncNow, 5000))));
  setTimeout(syncNow, 15e3);
}
