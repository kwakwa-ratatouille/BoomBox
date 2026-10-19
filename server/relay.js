// Relais Internet : les téléphones lisent l'audio par ce PC même en 4G/5G.
// - Tunnel Cloudflare gratuit (cloudflared, sans compte) : une adresse https joignable de partout.
// - Clé secrète : toute requête arrivant par le tunnel doit la fournir (sinon refusée).
// - Annonce : le serveur se lie à ta bibliothèque Firebase comme un appareil (« Serveur Boombox (PC) ») et y
//   publie ses adresses (réseau local + tunnel) et la clé, lisibles uniquement par tes appareils.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'relay.json');
let conf = {};
try {
  conf = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {}
const save = () => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(conf, null, 2));
};
if (!conf.relayKey) {
  conf.relayKey = crypto.randomBytes(24).toString('base64url');
  save();
}

export const relayKey = () => conf.relayKey;
export let publicUrl = null;
let lanList = () => [];

// Requête arrivée par le tunnel (Cloudflare ajoute ces en-têtes) : clé obligatoire
const viaTunnel = (req) => !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray']);
export function guard(req, res, next) {
  if (viaTunnel(req) && (req.query.k || req.headers['x-boombox-key']) !== conf.relayKey) return res.status(403).json({ error: 'Accès refusé' });
  next();
}
// Requête faite depuis ce PC lui-même (pas le réseau local, pas le tunnel)
export function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return !viaTunnel(req) && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1');
}

// ---------- Tunnel ----------
function findCloudflared() {
  const cands = [path.join(ROOT, 'bin', 'cloudflared.exe'), 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe', path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe')];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  try {
    execFileSync('cloudflared', ['--version'], { stdio: 'ignore', windowsHide: true });
    return 'cloudflared';
  } catch {}
  return null;
}
export function startTunnel(port, getLan) {
  lanList = getLan;
  const bin = findCloudflared();
  if (!bin) return console.log('  Relais Internet : cloudflared non installé (lecture par le PC en Wi-Fi seulement)');
  const run = () => {
    const p = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { windowsHide: true });
    const onData = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && m[0] !== publicUrl) {
        publicUrl = m[0];
        console.log(`  Relais Internet (4G/5G) : ${publicUrl}`);
        announce().catch((e) => console.warn('  Annonce du relais :', e.message));
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', () => {
      publicUrl = null;
      setTimeout(run, 30e3); // tunnel coupé : on le relance
    });
  };
  run();
  // Présence régulière (le téléphone choisit le serveur vu le plus récemment)
  setInterval(() => announce().catch(() => {}), 5 * 60e3);
}

// ---------- Annonce dans Firebase (API REST, connexion anonyme propre au serveur) ----------
export function configure({ projectId, apiKey, spaceId, secret }) {
  if (!projectId || !apiKey || !spaceId || !secret) throw new Error('Configuration incomplète');
  const changed = conf.spaceId !== spaceId || conf.secret !== secret;
  Object.assign(conf, { projectId, apiKey, spaceId, secret });
  save();
  if (changed) announce().catch((e) => console.warn('  Annonce du relais :', e.message));
}

let token = null;
async function idToken() {
  if (token && token.exp > Date.now()) return token;
  let r;
  if (conf.refreshToken) {
    r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${conf.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(conf.refreshToken)}` }).then((x) => x.json());
    if (r.id_token) return (token = { id: r.id_token, uid: r.user_id, exp: Date.now() + 50 * 60e3 });
  }
  r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${conf.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) }).then((x) => x.json());
  if (!r.idToken) throw new Error(r.error?.message || 'connexion anonyme impossible');
  conf.refreshToken = r.refreshToken;
  save();
  return (token = { id: r.idToken, uid: r.localId, exp: Date.now() + 50 * 60e3 });
}
const val = (v) => (Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(Math.round(v)) } : v == null ? { nullValue: null } : { stringValue: String(v) });
async function patch(t, docPath, fields) {
  const base = `https://firestore.googleapis.com/v1/projects/${conf.projectId}/databases/(default)/documents`;
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const r = await fetch(`${base}/${docPath}?${mask}`, { method: 'PATCH', headers: { authorization: `Bearer ${t.id}`, 'content-type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)])) }) });
  if (!r.ok) throw new Error(`${docPath.split('/').slice(-2, -1)[0]} : HTTP ${r.status}`);
}
export async function announce() {
  if (!conf.spaceId || !conf.secret || !conf.apiKey) return;
  const t = await idToken();
  const name = `Serveur Boombox (${os.hostname()})`;
  // Lien à la bibliothèque (avec le code secret, comme un appareil qu'on lie), puis fiche du serveur
  await patch(t, `spaces/${conf.spaceId}/members/${t.uid}`, { secret: conf.secret, deviceName: name });
  await patch(t, `spaces/${conf.spaceId}/devices/server-${t.uid}`, { name, kind: 'server', lan: lanList(), publicUrl, relayKey: conf.relayKey, lastSeen: Date.now(), online: true });
}
