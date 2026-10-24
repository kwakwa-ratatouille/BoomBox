// Rapports de bugs automatiques : plantages, erreurs JavaScript et sons qui refusent de se lire.
// Anti-spam : une erreur identique ne crée jamais de nouvelle fiche, elle augmente seulement son compteur
// (fiche = empreinte du message), et chaque appareil envoie au plus 30 rapports par jour et la même erreur
// au plus une fois par heure. Aucune donnée personnelle (pas de nom, ni de bibliothèque).
import { db, doc, setDoc, arrayUnion } from './cloud.js';
import { increment } from '../vendor/firebase/firebase-firestore.js';

const DAY_KEY = 'boombox.errors.day';
const SEEN_KEY = 'boombox.errors.seen';
let version = '';
const platform = window.Capacitor?.getPlatform?.() || (/android|iphone|ipad/i.test(navigator.userAgent) ? 'mobile-web' : 'pc');
const device = (() => { try { return String(JSON.parse(localStorage.getItem('boombox.device')) || 'inconnu').slice(0, 12); } catch { return 'inconnu'; } })();

async function hash(s) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 10).map((x) => x.toString(16).padStart(2, '0')).join('');
}
const clean = (s, n) => String(s || '').replace(/https?:\/\/\S+/g, (u) => u.split('?')[0]).slice(0, n);

export async function reportError(message, where = 'js', stack = '') {
  try {
    message = clean(message, 500);
    if (!message || /ResizeObserver loop|Script error\.?$|AbortError|play\(\) request was interrupted|signal is aborted|aborted without reason|Failed to fetch|Load failed|NetworkError|network connection was lost|requête a expiré|request timed out|Internet connection appears to be offline/i.test(message)) return;
    const today = new Date().toISOString().slice(0, 10);
    const day = JSON.parse(localStorage.getItem(DAY_KEY) || '{}');
    if (day.d !== today) Object.assign(day, { d: today, n: 0 });
    if (day.n >= 30) return;
    const id = await hash(`${where}|${message.replace(/\d+/g, '#')}`);
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    if (Date.now() - (seen[id] || 0) < 3600e3) return;
    seen[id] = Date.now();
    day.n++;
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(Object.entries(seen).filter(([, t]) => Date.now() - t < 86400e3))));
    localStorage.setItem(DAY_KEY, JSON.stringify(day));
    await setDoc(doc(db, 'errors', id), {
      message,
      where: clean(where, 60),
      stack: clean(stack, 2000),
      count: increment(1),
      last: Date.now(),
      version: version || 'inconnue',
      platform,
      devices: arrayUnion(device),
    }, { merge: true });
  } catch {}
}

export function setupErrorReports() {
  // Version de l'appli = dernière entrée des nouveautés
  fetch('changelog.json').then((r) => r.json()).then((j) => (version = j?.[0]?.version || '')).catch(() => {});
  addEventListener('error', (e) => reportError(e.message || e.error?.message, `js:${(e.filename || '').split('/').pop()}:${e.lineno || 0}`, e.error?.stack));
  addEventListener('unhandledrejection', (e) => reportError(e.reason?.message || String(e.reason), 'promise', e.reason?.stack));
  // Android : plantage de l'appli au lancement précédent (enregistré par le module natif)
  window.Capacitor?.Plugins?.BoomboxNative?.takeCrash?.().then((r) => {
    if (!r?.crash) return;
    const [head, ...trace] = String(r.crash).split('\n');
    reportError(`Plantage natif : ${(trace.find((l) => /Exception|Error/.test(l)) || trace[0] || '').trim()}`, `natif:${head.slice(0, 50)}`, trace.join('\n'));
    // Affiché à l'écran aussi (capture à envoyer si le rapport automatique ne part pas)
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:12px;z-index:99999;background:#1e1828;color:#fff;border-radius:14px;padding:16px;overflow:auto;font:12px/1.4 monospace;box-shadow:0 10px 40px #000';
    box.innerHTML = '<b style="font:700 16px sans-serif">Boombox a planté la dernière fois</b><p style="font:14px sans-serif;opacity:.8">Fais une capture d’écran et envoie-la. Appuie ici pour fermer.</p>';
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = String(r.crash).slice(0, 2500);
    box.appendChild(pre);
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  }).catch(() => {});
}
