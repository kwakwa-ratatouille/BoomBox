// Mises à jour de l'interface de l'appli mobile, sans réinstallation (voir scripts/publish-web.mjs).
// Au démarrage : on regarde la dernière version en ligne ; si elle est plus récente, on télécharge l'archive
// (~1,5 Mo), on la décompresse dans le stockage de l'appli et Capacitor recharge l'interface depuis ce dossier.
// Sécurité : si une nouvelle version n'arrive pas à démarrer deux fois de suite, on revient à la précédente.
import { isNative } from './native.js';
import { firebaseConfig } from './firebase-config.js';
import { loadJsZip } from './spotify-data.js';

const BASE = `https://${firebaseConfig.projectId}.web.app/`;
const K = { pending: 'boombox.web.pending', tries: 'boombox.web.tries', prev: 'boombox.web.prev', ready: 'boombox.web.ready' };
const ls = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  del: (k) => localStorage.removeItem(k),
};
const plugins = () => window.Capacitor?.Plugins || {};
const webView = () => plugins().WebView || window.Capacitor?.registerPlugin?.('WebView');
const newer = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }) > 0;

export async function currentVersion() {
  try {
    return (await (await fetch('version.json', { cache: 'no-store' })).json()) || {};
  } catch {
    return {};
  }
}

// À appeler tout au début : retour arrière si la version précédente plantait, application d'une mise à jour prête
export async function webUpdateBoot() {
  if (!isNative) return;
  const wv = webView();
  if (!wv) return;
  const tries = Number(ls.get(K.tries) || 0);
  if (ls.get(K.pending) && tries >= 2 && ls.get(K.prev) != null) {
    // La nouvelle version n'a jamais confirmé son démarrage : on remet l'ancienne
    const prev = ls.get(K.prev);
    // Signalé dans les rapports d'erreurs (Firestore « errors ») pour savoir quelle version plante au démarrage
    const bad = ls.get(K.pending);
    setTimeout(() => import('./errors.js').then((m) => m.reportError(`Mise à jour ${bad} annulée : elle ne démarrait pas (retour à la précédente)`, 'updater')).catch(() => {}), 8000);
    ls.del(K.pending);
    ls.del(K.tries);
    await wv.setServerBasePath({ path: prev });
    await wv.persistServerBasePath();
    return;
  }
  if (ls.get(K.pending)) ls.set(K.tries, String(tries + 1));
}

// À appeler quand l'appli a bien démarré (profil chargé, interface affichée)
export function webUpdateConfirm() {
  if (!isNative) return;
  ls.del(K.pending);
  ls.del(K.tries);
}

let running = false;
// Vérifie et prépare une mise à jour. onReady(version) est appelé quand elle peut être appliquée.
export async function checkWebUpdate({ onReady } = {}) {
  if (!isNative || running) return;
  running = true;
  try {
    const { Filesystem, CapacitorHttp, App } = plugins();
    const wv = webView();
    if (!Filesystem || !CapacitorHttp || !wv) throw new Error(`modules natifs manquants (${[!Filesystem && 'Filesystem', !CapacitorHttp && 'CapacitorHttp', !wv && 'WebView'].filter(Boolean).join(', ')})`);
    const cur = await currentVersion();
    const res = await CapacitorHttp.request({ url: `${BASE}app-update/manifest.json?t=${Date.now()}`, method: 'GET', responseType: 'json', connectTimeout: 6000, readTimeout: 8000 });
    const m = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    ls.set('boombox.web.lastCheck', `${new Date().toLocaleString('fr-FR')} : en ligne ${m?.version || '?'} (HTTP ${res.status})`);
    if (!m?.version || !newer(m.version, cur.version || '0')) return;
    // Interface qui demande un appli native plus récente : il faudra passer par SideStore
    const nativeBuild = Number((await App?.getInfo?.().catch(() => null))?.build || 1);
    if ((m.minNative || 1) > nativeBuild) return onReady?.(null, 'native');
    const dir = `web/${m.version}`;
    const zipPath = `web/${m.version}.zip`;
    await Filesystem.downloadFile({ url: BASE + m.url, path: zipPath, directory: 'DATA', recursive: true });
    const { data } = await Filesystem.readFile({ path: zipPath, directory: 'DATA' });
    const JSZip = await loadJsZip();
    const zip = await JSZip.loadAsync(data, { base64: true });
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    for (const name of names) {
      const b64 = await zip.files[name].async('base64');
      await Filesystem.writeFile({ path: `${dir}/${name}`, data: b64, directory: 'DATA', recursive: true });
    }
    await Filesystem.deleteFile({ path: zipPath, directory: 'DATA' }).catch(() => {});
    if (!names.includes('index.html')) throw new Error('archive incomplète');
    const { uri } = await Filesystem.getUri({ path: dir, directory: 'DATA' });
    ls.set(K.ready, JSON.stringify({ version: m.version, path: uri.replace(/^file:\/\//, '') }));
    // Ménage : on ne garde que la version prête et celle en cours
    const keep = new Set([m.version, cur.version]);
    const list = await Filesystem.readdir({ path: 'web', directory: 'DATA' }).catch(() => ({ files: [] }));
    for (const f of list.files || []) {
      const n = typeof f === 'string' ? f : f.name;
      if (!keep.has(n)) await Filesystem.rmdir({ path: `web/${n}`, directory: 'DATA', recursive: true }).catch(() => {});
    }
    onReady?.(m.version);
    ls.del('boombox.web.lastError');
  } catch (e) {
    // Raison gardée et affichée dans Paramètres → Version (pour comprendre une mise à jour qui n'arrive pas)
    ls.set('boombox.web.lastError', `${new Date().toLocaleString('fr-FR')} : ${String(e?.message || e).slice(0, 140)}`);
    console.warn('Mise à jour de l’interface :', e?.message || e);
    import('./errors.js').then((m) => m.reportError(`Mise à jour impossible : ${String(e?.message || e).slice(0, 140)}`, 'updater')).catch(() => {});
  } finally {
    running = false;
  }
}

// Bascule sur la version prête (recharge l'interface tout de suite)
export async function applyWebUpdate() {
  const ready = JSON.parse(ls.get(K.ready) || 'null');
  const wv = webView();
  if (!ready || !wv) return false;
  try {
    ls.set(K.prev, (await wv.getServerBasePath())?.path ?? '');
  } catch {}
  ls.del(K.ready);
  ls.set(K.pending, ready.version);
  ls.set(K.tries, '0');
  await wv.setServerBasePath({ path: ready.path });
  await wv.persistServerBasePath();
  return true;
}
export const webUpdateReady = () => !!localStorage.getItem(K.ready);
