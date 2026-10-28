// Mini-serveur Cloudflare de l'assistant IA de Boombox.
// - La clé Gemini est un secret Cloudflare (GEMINI_KEY) : jamais dans l'appli ni sur GitHub.
// - Seules les applis Boombox connectées passent : le jeton de connexion Firebase est vérifié (signature Google).
// - Limites : questions par personne et par jour, et plafond global par jour (le quota gratuit ne s'épuise pas).
// L'appli envoie la conversation, ce serveur renvoie la réponse de Gemini ; l'appli retrouve ensuite les sons.
import { geminiRequest, parseGemini } from '../../../server/ai-prompt.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

// ---------- Vérification du jeton Firebase (RS256, clés publiques de Google) ----------
let jwks = null;
let jwksAt = 0;
async function googleKeys() {
  if (jwks && Date.now() - jwksAt < 3600e3) return jwks;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  jwks = (await r.json()).keys || [];
  jwksAt = Date.now();
  return jwks;
}
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
async function verifyFirebaseToken(token, projectId) {
  const [h, p, sig] = String(token || '').split('.');
  if (!sig) throw new Error('jeton manquant');
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256') throw new Error('algorithme refusé');
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('jeton d’un autre projet');
  if (!payload.sub || payload.exp < now || payload.iat > now + 300) throw new Error('jeton expiré');
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('clé de signature inconnue');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('signature invalide');
  return payload.sub;
}

// ---------- Limites quotidiennes (stockage KV de Cloudflare) ----------
async function takeQuota(env, uid) {
  const day = new Date().toISOString().slice(0, 10);
  const perUser = Number(env.PER_USER_DAY || 30);
  const global = Number(env.GLOBAL_DAY || 400);
  const uKey = `u:${day}:${uid}`;
  const gKey = `g:${day}`;
  const [u, g] = await Promise.all([env.LIMITS.get(uKey), env.LIMITS.get(gKey)]);
  if (Number(u || 0) >= perUser) throw Object.assign(new Error(`Tu as atteint la limite de ${perUser} questions à l'IA pour aujourd'hui. Reviens demain !`), { status: 429 });
  if (Number(g || 0) >= global) throw Object.assign(new Error("L'assistant IA a atteint sa limite du jour. Réessaie demain."), { status: 429 });
  const ttl = { expirationTtl: 2 * 86400 };
  await Promise.all([env.LIMITS.put(uKey, String(Number(u || 0) + 1), ttl), env.LIMITS.put(gKey, String(Number(g || 0) + 1), ttl)]);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    // Recherche de GIF (GIPHY) pour les messages : clé GIPHY_KEY en secret Cloudflare, réservé aux applis Boombox
    if (new URL(req.url).pathname === '/gifs') {
      try {
        await verifyFirebaseToken((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.FIREBASE_PROJECT);
      } catch {
        return json({ error: 'Accès réservé à l’appli Boombox' }, 401);
      }
      if (!env.GIPHY_KEY) return json({ error: 'Recherche de GIF pas encore configurée' }, 503);
      const q = String(new URL(req.url).searchParams.get('q') || '').slice(0, 80);
      const api = q ? `search?q=${encodeURIComponent(q)}&` : 'trending?';
      const r = await fetch(`https://api.giphy.com/v1/gifs/${api}api_key=${env.GIPHY_KEY}&limit=30&rating=pg-13&lang=fr`, { cf: { cacheTtl: 600 } });
      const j = await r.json().catch(() => ({}));
      return json((j.data || []).map((g) => ({ id: g.id, preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url, url: g.images?.downsized_medium?.url || g.images?.original?.url, w: Number(g.images?.fixed_width?.width) || 200, h: Number(g.images?.fixed_width?.height) || 200 })));
    }
    // SoundCloud pour les téléphones (sans PC) : recherche, et lien du son pour le télécharger directement chez
    // SoundCloud (le son ne passe pas par ce serveur : rien n'est stocké ici)
    const path = new URL(req.url).pathname;
    if (path === '/sc/search' || path === '/sc/stream') {
      try {
        await verifyFirebaseToken((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.FIREBASE_PROJECT);
      } catch {
        return json({ error: 'Accès réservé à l’appli Boombox' }, 401);
      }
      try {
        const p = new URL(req.url).searchParams;
        return json(path === '/sc/search' ? await scSearch(env, String(p.get('q') || '').slice(0, 100)) : await scStream(env, String(p.get('id') || '')));
      } catch (e) {
        return json({ error: e.message || 'SoundCloud indisponible' }, 502);
      }
    }
    if (req.method !== 'POST') return json({ ok: true, service: 'Boombox IA' });
    try {
      const uid = await verifyFirebaseToken((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.FIREBASE_PROJECT).catch(() => {
        throw Object.assign(new Error('Accès réservé à l’appli Boombox'), { status: 401 });
      });
      if (!env.GEMINI_KEY) return json({ error: "La clé de l'IA n'est pas encore configurée." }, 503);
      const body = await req.json().catch(() => ({}));
      await takeQuota(env, uid);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-flash-latest'}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
        body: JSON.stringify(geminiRequest({ messages: body.messages, context: body.context })),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (r.status === 429) return json({ error: 'Limite gratuite de Gemini atteinte pour le moment : réessaie dans une minute.' }, 429);
        return json({ error: j.error?.message || `Erreur Gemini (${r.status})` }, 502);
      }
      return json(parseGemini(await r.json()));
    } catch (e) {
      return json({ error: e.message || 'Erreur' }, e.status || 401);
    }
  },
};

// ---------- SoundCloud ----------
// Identifiant public du lecteur web de SoundCloud (lu dans ses scripts, gardé 12 h, renouvelé si refusé)
const SC_UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
async function scClientId(env, fresh = false) {
  if (!fresh) {
    const c = await env.LIMITS.get('sc_cid');
    if (c) return c;
  }
  const home = await (await fetch('https://soundcloud.com/', { headers: SC_UA })).text();
  const scripts = [...home.matchAll(/<script crossorigin src="([^"]+\.js)"/g)].map((m) => m[1]).reverse();
  for (const s of scripts) {
    const t = await (await fetch(s, { headers: SC_UA })).text();
    const m = t.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (m) {
      await env.LIMITS.put('sc_cid', m[1], { expirationTtl: 12 * 3600 });
      return m[1];
    }
  }
  throw new Error('SoundCloud indisponible pour le moment');
}
async function scApi(env, url) {
  for (let i = 0; i < 2; i++) {
    const cid = await scClientId(env, i > 0);
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}client_id=${cid}`, { headers: SC_UA });
    if (r.status === 401 || r.status === 403) continue;
    if (!r.ok) throw new Error(`SoundCloud ${r.status}`);
    return r.json();
  }
  throw new Error('SoundCloud refuse la demande');
}
const scId = (n) => 'sc_' + Number(n).toString(36).padStart(8, '0');
const scNum = (id) => parseInt(String(id).replace(/^sc_/, ''), 36);
async function scSearch(env, q) {
  if (!q) return [];
  const [r, album] = await Promise.all([
    scApi(env, `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&limit=15`),
    scAlbumTracks(q, (u) => scApi(env, u)).catch(() => []),
  ]);
  const seen = new Set(album.map((t) => t.id));
  return [...album, ...(r.collection || []).filter((t) => t.streamable !== false && !seen.has(scId(t.id))).map((t) => ({
    id: scId(t.id), title: t.title, artists: [{ name: t.user?.username || 'SoundCloud' }], album: null,
    duration: Math.round((t.full_duration || t.duration || 0) / 1000), thumb: (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t500x500') || null, soundcloud: true,
  }))];
}

// ---------- Albums SoundCloud (sets) ----------
const scWords = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
async function scAlbumTracks(q, api) {
  const qw = new Set(scWords(q));
  if (qw.size < 2) return [];
  const r = await api(`https://api-v2.soundcloud.com/search/playlists?q=${encodeURIComponent(q)}&limit=8`).catch(() => null);
  // Meilleur album : la plupart des mots de son titre sont dans la recherche
  const best = (r?.collection || [])
    .map((p) => {
      const tw = scWords(p.title);
      return { p, score: tw.length ? tw.filter((w) => qw.has(w)).length / tw.length : 0 };
    })
    .filter((x) => x.score >= 0.75)
    .sort((a, b) => b.score - a.score)[0]?.p;
  if (!best) return [];
  const full = await api(`https://api-v2.soundcloud.com/playlists/${best.id}`).catch(() => null);
  let tracks = full?.tracks || [];
  // Les sons au-delà des premiers ne sont que des numéros : on demande le reste
  const missing = tracks.filter((t) => !t.title).map((t) => t.id);
  if (missing.length) {
    const more = await api(`https://api-v2.soundcloud.com/tracks?ids=${missing.slice(0, 50).join(',')}`).catch(() => []);
    const byId = new Map((more || []).map((t) => [t.id, t]));
    tracks = tracks.map((t) => (t.title ? t : byId.get(t.id))).filter(Boolean);
  }
  const art = (best.artwork_url || '').replace('-large', '-t500x500') || null;
  return tracks.filter((t) => t.streamable !== false).map((t) => ({
    id: 'sc_' + Number(t.id).toString(36).padStart(8, '0'), title: t.title, artists: [{ name: t.user?.username || best.user?.username || 'SoundCloud' }],
    album: { name: best.title }, duration: Math.round((t.full_duration || t.duration || 0) / 1000), thumb: (t.artwork_url || '').replace('-large', '-t500x500') || art, soundcloud: true,
  }));
}

async function scStream(env, id) {
  const num = scNum(id);
  if (!num) throw new Error('Son SoundCloud invalide');
  const t = await scApi(env, `https://api-v2.soundcloud.com/tracks/${num}`);
  // Les extraits de 30 s (sons réservés aux abonnés Go+) sont écartés : ils donnaient un « son vide » sur le téléphone
  const list = (t.media?.transcodings || []).filter((x) => !x.snipped && !/preview/.test(x.preset || ''));
  const pick = list.find((x) => x.format?.protocol === 'progressive') || list.find((x) => x.format?.protocol === 'hls' && /mp4|aac/.test(x.format?.mime_type)) || list.find((x) => x.format?.protocol === 'hls');
  if (!pick && t.policy === 'SNIP') throw new Error('Ce son est réservé aux abonnés SoundCloud Go+');
  if (!pick) throw new Error('Ce son n’est pas lisible sur SoundCloud');
  const u = await scApi(env, `${pick.url}?track_authorization=${t.track_authorization || ''}`);
  return { url: u.url, protocol: pick.format.protocol, mime: pick.format.mime_type, duration: Math.round((t.full_duration || 0) / 1000) };
}
