import { isLocalId, localPath } from './localfiles.js';
// Lecture audio directe via yt-dlp (optionnel). Permet la lecture écran éteint sur téléphone
// et les contrôles sur l'écran de verrouillage. Sans yt-dlp, l'app utilise le lecteur YouTube intégré.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findYtDlp() {
  const local = path.join(ROOT, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(local)) return local;
  try {
    execFileSync('yt-dlp', ['--version'], { stdio: 'ignore', windowsHide: true });
    return 'yt-dlp';
  } catch {}
  // Installé avec winget mais pas encore dans le PATH de ce processus
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet');
    const link = path.join(base, 'Links', 'yt-dlp.exe');
    if (fs.existsSync(link)) return link;
    try {
      const pkgs = path.join(base, 'Packages');
      const dir = fs.readdirSync(pkgs).find((d) => /^yt-dlp\.yt-dlp/i.test(d));
      if (dir && fs.existsSync(path.join(pkgs, dir, 'yt-dlp.exe'))) return path.join(pkgs, dir, 'yt-dlp.exe');
    } catch {}
  }
  return null;
}

export const ytDlpPath = findYtDlp();

const urlCache = new Map(); // videoId -> { url, exp }
const pending = new Map();

function resolveUrl(id) {
  const hit = urlCache.get(id);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url);
  if (pending.has(id)) return pending.get(id);
  const p = new Promise((resolve, reject) => {
    execFile(
      ytDlpPath,
      // --js-runtimes node : yt-dlp utilise Node (déjà installé) pour déchiffrer les liens YouTube
      ['--js-runtimes', 'node', '-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-playlist', '--no-warnings', `https://www.youtube.com/watch?v=${id}`],
      { timeout: 30e3, windowsHide: true },
      (err, stdout) => {
        pending.delete(id);
        const url = stdout?.trim().split('\n')[0];
        if (err || !url) return reject(err || new Error('URL audio introuvable'));
        urlCache.set(id, { url, exp: Date.now() + 4 * 3600e3 });
        resolve(url);
      },
    );
  });
  pending.set(id, p);
  return p;
}

// Fichier audio complet (pour l'analyse de l'automix, et plus tard l'écoute hors ligne) : téléchargé par yt-dlp,
// qui contourne le bridage de vitesse de YouTube, puis gardé en cache (4 Go max, les moins écoutés récemment sont supprimés).
const AUDIO_DIR = path.join(ROOT, 'cache', 'audio');
const CACHE_MAX = 4 * 1024 ** 3;
const cacheSize = () => { try { return fs.readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.m4a')).reduce((s, f) => s + fs.statSync(path.join(AUDIO_DIR, f)).size, 0); } catch { return 0; } };
let lastStream = 0; // dernière lecture : le pré-téléchargement se met en pause pendant l'écoute active
const downloads = new Map();
export function download(id) {
  const file = path.join(AUDIO_DIR, `${id}.m4a`);
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (downloads.has(id)) return downloads.get(id);
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const p = new Promise((resolve, reject) => {
    // Téléchargé sous un nom temporaire, renommé seulement une fois complet
    const tmp = file + '.dl';
    fs.rmSync(tmp, { force: true });
    execFile(ytDlpPath, ['--js-runtimes', 'node', '-f', 'bestaudio[ext=m4a]/bestaudio', '-o', tmp, '--no-part', '--no-playlist', '--no-warnings', '--quiet', `https://www.youtube.com/watch?v=${id}`], { timeout: 150e3, windowsHide: true }, (err) => {
      downloads.delete(id);
      if (err || !fs.existsSync(tmp) || !fs.statSync(tmp).size) {
        fs.rmSync(tmp, { force: true });
        return reject(err || new Error('téléchargement impossible'));
      }
      fs.renameSync(tmp, file);
      pruneAudioCache();
      resolve(file);
    });
  });
  downloads.set(id, p);
  return p;
}
function pruneAudioCache() {
  const files = fs.readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.m4a')).map((f) => ({ f, ...fs.statSync(path.join(AUDIO_DIR, f)) })).sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = files.reduce((s, x) => s + x.size, 0);
  for (const x of files) {
    if (total < CACHE_MAX) break;
    fs.rmSync(path.join(AUDIO_DIR, x.f), { force: true });
    total -= x.size;
  }
}
export async function audioFileHandler(req, res) {
  const { id } = req.params;
  if (isLocalId(id)) return localPath(id) ? res.sendFile(localPath(id)) : res.status(404).end();
  if (!ytDlpPath) return res.status(501).json({ error: 'yt-dlp non installé' });
  if (!/^[\w-]{11}$/.test(id)) return res.status(400).end();
  try {
    res.sendFile(await download(id));
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message });
  }
}

// Prépare à l'avance l'URL audio d'un titre (le suivant dans la file) pour un démarrage instantané.
export function prefetchHandler(req, res) {
  const { id } = req.params;
  // Le titre suivant est aussi téléchargé en entier en arrière-plan : il démarrera instantanément depuis le disque
  if (ytDlpPath && /^[\w-]{11}$/.test(id)) resolveUrl(id).then(() => download(id)).catch(() => {});
  res.status(204).end();
}

export async function streamHandler(req, res) {
  const { id } = req.params;
  lastStream = Date.now();
  // Fichier de « Mes fichiers » (musique déjà sur le PC) : lu directement
  if (isLocalId(id)) return localPath(id) ? res.sendFile(localPath(id)) : res.status(404).end();
  if (!ytDlpPath) return res.status(501).json({ error: 'yt-dlp non installé' });
  if (!/^[\w-]{11}$/.test(id)) return res.status(400).end();
  // Déjà téléchargé (analyse automix, écoute précédente) : lecture immédiate depuis le disque
  const local = path.join(AUDIO_DIR, `${id}.m4a`);
  if (fs.existsSync(local)) {
    fs.utimes(local, new Date(), new Date(), () => {}); // « récemment utilisé » pour le nettoyage du cache
    return res.sendFile(local, { headers: { 'content-type': 'audio/mp4' } });
  }
  // Nouvel essai demandé par le lecteur après une coupure : on repart d'un lien YouTube neuf
  if (req.query.fresh) urlCache.delete(id);
  // Dernier recours : téléchargement complet par yt-dlp puis lecture depuis le disque
  const fromDisk = async () => res.sendFile(await download(id), { headers: { 'content-type': 'audio/mp4' } });
  try {
    let url, upstream;
    const headers = {};
    if (req.headers.range) headers.range = req.headers.range;
    try {
      url = await resolveUrl(id);
      upstream = await fetch(url, { headers });
      if (upstream.status === 403 || upstream.status >= 500) {
        urlCache.delete(id);
        url = await resolveUrl(id);
        upstream = await fetch(url, { headers });
      }
    } catch (e) {
      console.warn(`[lecture] ${id} : lien audio indisponible (${e.message?.split('\n')[0]}), téléchargement complet`);
      return await fromDisk();
    }
    if (!upstream.ok) {
      console.warn(`[lecture] ${id} : YouTube répond ${upstream.status}, téléchargement complet`);
      urlCache.delete(id);
      return await fromDisk();
    }
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) return res.end();
    const body = Readable.fromWeb(upstream.body);
    // Coupure réseau pendant la lecture : on ferme proprement au lieu de faire planter le serveur
    body.on('error', () => res.destroy());
    res.on('error', () => body.destroy());
    req.on('close', () => body.destroy());
    body.pipe(res);
  } catch (e) {
    console.warn(`[lecture] ${id} : illisible (${e.message?.split('\n')[0]})`);
    if (!res.headersSent) res.status(502).json({ error: e.message });
  }
}

// ---------- Pré-téléchargement des titres likés ----------
// Les likes (les plus récents d'abord) sont téléchargés en arrière-plan, un par un, quand le PC ne lit rien :
// lecture instantanée ensuite, et beaucoup moins de requêtes à YouTube. On s'arrête avant de remplir le cache
// (90 % de 4 Go) pour garder de la place aux écoutes du moment.
const pre = { queue: [], done: 0, failed: 0, running: false };
export function predownload(ids) {
  const have = new Set(fs.existsSync(AUDIO_DIR) ? fs.readdirSync(AUDIO_DIR).map((f) => f.replace(/\.m4a$/, '')) : []);
  pre.queue = ids.filter((id) => /^[\w-]{11}$/.test(id) && !have.has(id));
  pre.total = ids.length;
  pre.cached = ids.length - pre.queue.length;
  if (!pre.running && ytDlpPath) runPre();
  return predownloadStatus();
}
export const predownloadStatus = () => ({ queued: pre.queue.length, total: pre.total || 0, cached: (pre.cached || 0) + pre.done, failed: pre.failed, sizeMB: Math.round(cacheSize() / 1048576), maxMB: Math.round(CACHE_MAX / 1048576), running: pre.running });
async function runPre() {
  pre.running = true;
  while (pre.queue.length) {
    if (Date.now() - lastStream < 20e3) {
      await new Promise((r) => setTimeout(r, 15e3)); // une écoute est en cours : on laisse la bande passante
      continue;
    }
    if (cacheSize() > CACHE_MAX * 0.9) break;
    const id = pre.queue.shift();
    try {
      await download(id);
      pre.done++;
    } catch {
      pre.failed++;
    }
    await new Promise((r) => setTimeout(r, 4000)); // doucement, pour ne pas se faire bloquer par YouTube
  }
  pre.running = false;
}