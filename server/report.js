// Rapports de plantage du PC (Boombox installé avec l'installateur Windows) : erreurs du serveur, mise à jour
// automatique ratée, serveur qui ne démarre pas (lanceur) ou qui s'arrête en boucle (icône). Même collection
// Firestore « errors » que l'appli (public/js/errors.js), même anti-spam : une erreur identique augmente seulement
// son compteur. Chaque rapport emporte la fin du journal du serveur (cache/boombox.log) pour comprendre la cause.
// En ligne de commande (lanceur, icône) : node server/report.js "message" "où"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'cache');
export const LOG = path.join(CACHE, 'boombox.log');
const AUTH = path.join(CACHE, 'report-auth.json');
const KEY = 'AIzaSyBxEJ9tJLxVsFi-qxqmg9WcdYut2CJ6DJQ'; // clé publique de l'appli web (comme dans public/js)
const DOCS = 'projects/musikal-b72d1/databases/(default)/documents';

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
// Version installée (setup Windows) ; dans le dossier de développement il n'y en a pas : aucun rapport envoyé
const version = () => readJson(path.join(ROOT, 'pc-version.json'))?.version || null;

// ---------- Journal : tout ce que le serveur écrit part aussi dans cache/boombox.log (1 Mo max, puis .old) ----------
export function startLog() {
  if (!version()) return;
  fs.mkdirSync(CACHE, { recursive: true });
  try {
    if (fs.statSync(LOG).size > 1048576) fs.renameSync(LOG, LOG + '.old');
  } catch {}
  for (const k of ['log', 'warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      orig(...a);
      try {
        fs.appendFileSync(LOG, `${new Date().toISOString()} ${a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
      } catch {}
    };
  }
  console.log(`--- Démarrage de Boombox ${version()} (Windows ${os.release()}, Node ${process.version}) ---`);
}

const tail = (f, n) => {
  try {
    const s = fs.readFileSync(f, 'utf8');
    return s.slice(-n);
  } catch {
    return '';
  }
};
// Pas d'adresses complètes (lien du relais Internet, clés) dans les rapports
const clean = (s, n) => String(s || '').replace(/https?:\/\/\S+/g, (u) => u.split('?')[0].replace(/\/\/[^/]*trycloudflare\.com/, '//…trycloudflare.com')).slice(0, n);

// Connexion anonyme Firebase (les règles exigent un utilisateur connecté), gardée dans cache/report-auth.json
async function token() {
  const a = readJson(AUTH);
  if (a?.id && a.exp > Date.now() + 60e3) return a.id;
  const r = a?.refresh
    ? await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${a.refresh}` }).then((x) => x.json())
    : await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"returnSecureToken":true}' }).then((x) => x.json());
  const id = r.id_token || r.idToken;
  if (!id) throw new Error('connexion Firebase impossible');
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(AUTH, JSON.stringify({ id, refresh: r.refresh_token || r.refreshToken, exp: Date.now() + Number(r.expires_in || r.expiresIn || 3600) * 1000 }));
  return id;
}

const device = () => {
  const f = path.join(CACHE, 'install-id');
  let id = '';
  try {
    id = fs.readFileSync(f, 'utf8').trim();
  } catch {}
  if (!id) {
    id = `pc-${crypto.randomBytes(4).toString('hex')}`;
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(f, id);
  }
  return id;
};

const NOISE = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EPIPE|socket hang up|aborted|fetch failed|network/i;
const sent = new Map();
let count = 0;

export async function report(message, where = 'serveur', stack = '') {
  try {
    const v = version();
    message = clean(message, 500);
    if (!v || !message || NOISE.test(message)) return;
    const id = crypto.createHash('sha1').update(`${where}|${message.replace(/\d+/g, '#')}`).digest('hex').slice(0, 20);
    if (Date.now() - (sent.get(id) || 0) < 3600e3 || count >= 30) return;
    sent.set(id, Date.now());
    count++;
    const log = tail(LOG, 1500);
    const fields = {
      message: { stringValue: message },
      where: { stringValue: clean(where, 60) },
      stack: { stringValue: clean(`${stack || ''}${log ? `\n--- journal ---\n${log}` : ''}`, 2000) },
      last: { integerValue: String(Date.now()) },
      version: { stringValue: v },
      platform: { stringValue: `pc-windows ${os.release()}` },
    };
    const r = await fetch(`https://firestore.googleapis.com/v1/${DOCS}:commit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        writes: [{
          update: { name: `${DOCS}/errors/${id}`, fields },
          updateMask: { fieldPaths: Object.keys(fields) },
          updateTransforms: [
            { fieldPath: 'count', increment: { integerValue: '1' } },
            { fieldPath: 'devices', appendMissingElements: { values: [{ stringValue: device() }] } },
          ],
        }],
      }),
    });
    if (!r.ok) throw new Error(`Firestore ${r.status}`);
  } catch (e) {
    try {
      fs.appendFileSync(LOG, `${new Date().toISOString()} Rapport non envoyé : ${e.message}\n`);
    } catch {}
  }
}

// Ligne de commande : node server/report.js "message" "où"
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await report(process.argv[2] || 'Rapport', process.argv[3] || 'pc');
}
