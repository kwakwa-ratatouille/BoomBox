// Serveur local de Boombox : sert l'interface et fait le lien avec YouTube (recherche, audio, paroles, import).
// La bibliothèque (profils, playlists, likes…) n'est plus ici : elle est dans Firebase et se synchronise
// entre appareils même quand ce serveur est éteint.
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yt from './yt.js';
import { startImport, getJob, spotifyApiToken, startMatch, syncPlaylist } from './importers.js';
import { concertsFor, spotifyLatest, norm, searchSpotifyUsers, spotifyUserProfile } from './spotify-stats.js';
import { autostartStatus, setAutostart } from './autostart.js';
import { streamHandler, prefetchHandler, audioFileHandler, ytDlpPath, predownload, predownloadStatus } from './stream.js';
import { askAi, pickModel, resolveAiResult } from './ai.js';
import { findLyrics, searchByLyrics } from './lyrics.js';
import { discover } from './discover.js';
import { resolveInput } from './resolve.js';
import * as relay from './relay.js';
import { setPresence } from './discord.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
} catch {}
const PORT = Number(process.env.PORT || cfg.port || 8787);

// Le serveur ne doit jamais s'arrêter à cause d'une erreur réseau ponctuelle (YouTube injoignable, etc.)
process.on('uncaughtException', (e) => console.error('Erreur inattendue (le serveur continue) :', e.message));
process.on('unhandledRejection', (e) => console.error('Erreur inattendue (le serveur continue) :', e?.message || e));

const app = express();
app.use(relay.guard); // requêtes arrivant par le tunnel Internet : clé secrète obligatoire
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(req.path, e.message);
    res.status(500).json({ error: e.message || 'Erreur' });
  });

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  }
  return out;
}

app.get('/api/status', (req, res) => res.json({ ytdlp: !!ytDlpPath, lan: lanUrls(), spotifyApi: !!cfg.spotifyClientId, ai: true, aiModel: cfg.geminiModel || null, ...(relay.isLocal(req) ? { publicUrl: relay.publicUrl } : {}) }));
// Relais Internet : l'appli du PC transmet la bibliothèque à laquelle le serveur doit s'annoncer (depuis ce PC seulement)
app.post('/api/relay/config', (req, res) => {
  if (!relay.isLocal(req)) return res.status(403).json({ error: 'Depuis ce PC uniquement' });
  try {
    relay.configure(req.body || {});
    res.json({ ok: true, publicUrl: relay.publicUrl });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- YouTube ----------
app.get('/api/search', wrap(async (req, res) => res.json(await yt.search(String(req.query.q || '').slice(0, 200), req.query.type || 'all'))));
app.get('/api/suggest', wrap(async (req, res) => res.json(await yt.suggest(String(req.query.q || '').slice(0, 200)))));
app.get('/api/artist/:id', wrap(async (req, res) => res.json(await yt.artist(req.params.id))));
// Statut Discord « Écoute Boombox » (seulement depuis ce PC, là où Discord est ouvert)
app.post('/api/discord/presence', wrap(async (req, res) => {
  if (!relay.isLocal(req)) return res.status(403).json({ error: 'Depuis ce PC uniquement' });
  res.json(await setPresence(req.body?.title ? req.body : null));
}));
app.get('/api/spotify/users', wrap(async (req, res) => res.json(await searchSpotifyUsers(String(req.query.q || '')))));
app.get('/api/spotify/user/:id', wrap(async (req, res) => res.json(await spotifyUserProfile(req.params.id))));
app.get('/api/new-releases', wrap(async (req, res) => res.json(await yt.newReleases())));
app.get('/api/discography/:id', wrap(async (req, res) => res.json(await yt.discography(req.params.id))));
app.get('/api/album/:id',wrap(async (req, res) => res.json(await yt.album(req.params.id))));
app.get('/api/ytplaylist/:id', wrap(async (req, res) => res.json(await yt.ytPlaylist(req.params.id, 300))));
app.get('/api/radio/:id', wrap(async (req, res) => res.json(await yt.radio(req.params.id))));
app.get('/api/stream/:id', streamHandler);
app.post('/api/prefetch/:id', prefetchHandler);
app.get('/api/audio-file/:id', audioFileHandler);

// Proxy d'images (pochettes) : permet au navigateur d'en lire les pixels pour extraire la couleur dominante.
app.get('/api/img', wrap(async (req, res) => {
  const u = new URL(String(req.query.u || ''));
  if (!/(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com|scdn\.co|spotifycdn\.com|dzcdn\.net)$/.test(u.hostname)) return res.status(400).end();
  const r = await fetch(u);
  if (!r.ok) return res.status(r.status).end();
  res.setHeader('content-type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('cache-control', 'public, max-age=86400');
  res.end(Buffer.from(await r.arrayBuffer()));
}));

// Paroles : plusieurs sources (lrclib, NetEase, YouTube Music/Musixmatch, lyrics.ovh), voir lyrics.js
app.get('/api/lyrics', wrap(async (req, res) => {
  const { videoId = '', title = '', artist = '', album = '', duration = '' } = req.query;
  res.json(await findLyrics({ videoId: /^[\w-]{11}$/.test(videoId) ? videoId : null, title, artist, album, duration }));
}));

// Accueil : nouveautés et tendances (YouTube Music France) + playlists thématiques (requêtes envoyées par l'appli)
app.post('/api/home', wrap(async (req, res) => {
  const queries = (Array.isArray(req.body.playlists) ? req.body.playlists : []).map(String).slice(0, 6);
  const [ex, ...lists] = await Promise.all([yt.explore().catch(() => ({})), ...queries.map((q) => yt.search(q, 'playlist').then((r) => r.items || []).catch(() => []))]);
  res.json({ ...ex, playlists: Object.fromEntries(queries.map((q, k) => [q, lists[k].slice(0, 12)])) });
}));

// Recherche par paroles : « je me souviens d'une phrase »
app.get('/api/lyrics-search', wrap(async (req, res) => {
  res.json(await searchByLyrics(String(req.query.q || '').slice(0, 200), (q) => yt.search(q)));
}));

// Nouveautés : le client envoie ses artistes suivis (avec les sorties déjà connues) ;
// on renvoie leurs sorties, celles absentes de « known » étant marquées nouvelles.
app.post('/api/releases', wrap(async (req, res) => {
  const follows = (req.body.follows || []).slice(0, 300);
  const out = [];
  const current = {};
  const thumbs = {};
  await Promise.all(
    follows.map(async (f) => {
      try {
        const a = await yt.artist(String(f.id), { light: true });
        const releases = [];
        for (const s of a.sections) {
          if (!/album|single|\bep\b/i.test(s.title)) continue;
          for (const it of s.items) if (it.type === 'album' && !releases.some((r) => r.id === it.id)) releases.push(it);
        }
        current[f.id] = releases.map((r) => r.id);
        if (a.thumb) thumbs[f.id] = a.thumb;
        const known = Array.isArray(f.known) ? f.known : current[f.id];
        for (const r of releases) out.push({ ...r, artist: { id: f.id, name: a.name || f.name }, isNew: !known.includes(r.id) });
      } catch (e) {
        console.warn('releases', f.name, e.message);
      }
    }),
  );
  // Spotify : sorties du jour avec leur date exacte (YouTube Music les affiche parfois en retard). Une sortie
  // récente absente de la liste YouTube est retrouvée sur YouTube Music (jouable) ; les autres reçoivent leur date.
  const recent = Date.now() - 45 * 86400e3;
  const queue = follows.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let f; (f = queue.shift()); ) {
      let sp = [];
      try {
        sp = await spotifyLatest(String(f.name || ''));
      } catch {
        continue;
      }
      const mine = out.filter((r) => r.artist.id === f.id);
      for (const s of sp) {
        const same = mine.find((r) => norm(r.title) === norm(s.name));
        if (same) {
          same.date ||= s.date;
          continue;
        }
        if (!s.date || Date.parse(s.date) < recent) continue;
        try {
          const { items } = await yt.search(`${f.name} ${s.name}`, 'album');
          const hit = (items || []).find((it) => it.type === 'album' && norm(it.title) === norm(s.name));
          if (!hit || out.some((r) => r.id === hit.id)) continue;
          const known = Array.isArray(f.known) ? f.known : current[f.id] || [];
          (current[f.id] ||= []).push(hit.id);
          out.push({ ...hit, year: s.date.slice(0, 4), date: s.date, kind: s.type === 'single' ? 'Single' : s.type === 'ep' ? 'EP' : hit.kind || 'Album', thumb: hit.thumb || s.cover, artist: { id: f.id, name: f.name }, isNew: !known.includes(hit.id) });
        } catch {}
      }
    }
  }));
  const when = (r) => (r.date ? Date.parse(r.date) : (Number(r.year) || 0) ? Date.UTC(Number(r.year), 0, 1) : 0);
  out.sort((x, y) => (y.isNew - x.isNew) || when(y) - when(x));
  res.json({ releases: out, newCount: out.filter((r) => r.isNew).length, current, thumbs });
}));

// Clés API Spotify (gratuites, developer.spotify.com) : permettent d'importer les dates d'ajout et les grandes playlists.
// Stockées uniquement sur ce PC, dans config.json.
app.post('/api/config/spotify', wrap(async (req, res) => {
  const clientId = String(req.body.clientId || '').trim();
  const clientSecret = String(req.body.clientSecret || '').trim();
  if (!clientId && !clientSecret) {
    delete cfg.spotifyClientId;
    delete cfg.spotifyClientSecret;
  } else {
    const ok = await spotifyApiToken({ spotifyClientId: clientId, spotifyClientSecret: clientSecret }, true);
    if (!ok) return res.status(400).json({ error: 'Clés refusées par Spotify : vérifie le Client ID et le Client Secret.' });
    Object.assign(cfg, { spotifyClientId: clientId, spotifyClientSecret: clientSecret });
  }
  fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(cfg, null, 2));
  res.json({ ok: true, spotifyApi: !!cfg.spotifyClientId });
}));

// Assistant IA (Gemini). La clé est stockée uniquement sur ce PC, dans config.json.
app.post('/api/config/gemini', wrap(async (req, res) => {
  const key = String(req.body.key || '').trim();
  if (!key) {
    delete cfg.geminiApiKey;
    delete cfg.geminiModel;
  } else {
    let model;
    try {
      model = await pickModel(key);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    Object.assign(cfg, { geminiApiKey: key, geminiModel: model });
  }
  fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(cfg, null, 2));
  res.json({ ok: true, ai: !!cfg.geminiApiKey, model: cfg.geminiModel || null });
}));
// Analyses audio de l'automix (tempo, tonalité…), gardées sur ce PC pour ne pas recalculer
const ANALYSIS_FILE = path.join(ROOT, 'cache', 'analysis.json');
let analysis = {};
try {
  analysis = JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf8'));
} catch {}
let analysisTimer = null;
app.get('/api/analysis', (req, res) => {
  const out = {};
  for (const id of String(req.query.ids || '').split(',').slice(0, 300)) if (analysis[id]) out[id] = analysis[id];
  res.json(out);
});
app.post('/api/analysis', (req, res) => {
  for (const [id, r] of Object.entries(req.body || {})) if (/^[\w-]{11}$/.test(id) && r && typeof r === 'object') analysis[id] = r;
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(ANALYSIS_FILE), { recursive: true });
    fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(analysis));
  }, 2000);
  res.json({ ok: true });
});

// Mode soirée : un invité envoie un lien ou un texte, on renvoie le titre jouable correspondant
app.post('/api/resolve', wrap(async (req, res) => {
  const track = await resolveInput(req.body.input);
  if (!track) return res.status(404).json({ error: 'Titre introuvable' });
  res.json(track);
}));
app.post('/api/discover', wrap(async (req, res) => res.json(await discover(req.body || {}))));
// Assistant IA : clé de ce PC si elle existe, sinon le mini-serveur Cloudflare (clé secrète, jeton de l'appli vérifié)
const AI_WORKER = 'https://boombox-ai.boombox-matis.workers.dev';
app.post('/api/ai', wrap(async (req, res) => {
  const { idToken, ...body } = req.body || {};
  if (cfg.geminiApiKey) return res.json(await askAi(cfg, body));
  if (!idToken) throw new Error("L'assistant IA a besoin d'une connexion à Boombox : recharge la page.");
  const r = await fetch(AI_WORKER, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return res.status(r.status).json({ error: data.error || `Assistant IA : erreur ${r.status}` });
  res.json(await resolveAiResult(data));
}));

// Import de playlists (Spotify, Deezer, YouTube, texte) : tâche en arrière-plan, le client suit la progression.
app.post('/api/import', (req, res) => {
  const input = String(req.body.input || '');
  if (!input.trim()) return res.status(400).json({ error: 'Rien à importer' });
  res.json(startImport(input, cfg, String(req.body.name || '').slice(0, 100)));
});
app.post('/api/match', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 5000) : [];
  res.json(startMatch(items, req.body.kind === 'artist' ? 'artist' : 'track'));
});
// Pré-téléchargement des titres likés (lecture instantanée, moins de requêtes à YouTube)
app.get('/api/predownload', (req, res) => res.json(predownloadStatus()));
app.post('/api/predownload', (req, res) => res.json(predownload((Array.isArray(req.body.ids) ? req.body.ids : []).map(String).slice(0, 3000))));
// Lancement automatique avec Windows (Paramètres)
app.get('/api/autostart', (req, res) => res.json(autostartStatus()));
app.post('/api/autostart', async (req, res) => {
  try {
    res.json(await setAutostart(!!req.body.on, !!req.body.openWindow));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Concerts à venir des artistes suivis (données Spotify)
app.post('/api/concerts', (req, res) => {
  const names = (Array.isArray(req.body.names) ? req.body.names : []).map(String).slice(0, 500);
  res.json(concertsFor(names));
});
app.post('/api/sync', async (req, res) => {
  const url = String(req.body.url || '');
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Lien de playlist manquant' });
  try {
    res.json(await syncPlaylist({ url, seen: Array.isArray(req.body.seen) ? req.body.seen : null, have: Array.isArray(req.body.have) ? req.body.have.slice(0, 5000) : [] }, cfg));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.get('/api/import/:job', (req, res) => {
  const j = getJob(req.params.job);
  if (!j) return res.status(404).end();
  res.json(j);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));
app.get(/.*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

http.createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ♫ Boombox est lancé`);
  console.log(`  Sur ce PC :        http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  Sur ton téléphone : ${u}  (même Wi-Fi)`);
  console.log(`  Lecture audio directe (yt-dlp) : ${ytDlpPath ? 'activée' : 'non installée → lecteur YouTube intégré'}\n`);
  relay.startTunnel(PORT, lanUrls);
  relay.announce().catch(() => {});
});
