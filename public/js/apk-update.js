// Android : nouvelle version de l'appli (APK) publiée sur GitHub → bandeau « Mettre à jour » qui la télécharge
// et ouvre l'écran d'installation d'Android (l'APK est toujours signé avec la même clé : rien n'est effacé).
// Les mises à jour de l'interface, elles, arrivent toutes seules (updater.js) sans passer par ici.
import { isNative, platform } from './native.js';
import { toast } from './ui.js';

const REPO = 'kwakwa-ratatouille/BoomBox';
const APK_URL = `https://github.com/${REPO}/releases/latest/download/Boombox.apk`;

// { build, version } de la dernière version publiée si elle est plus récente que l'appli installée, sinon null
export async function latestApk() {
  if (!isNative || platform !== 'android') return null;
  const app = await window.Capacitor?.Plugins?.App?.getInfo?.().catch(() => null);
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  const build = Number(String(r?.tag_name || '').split('.').pop());
  if (!build || !app?.build || build <= Number(app.build)) return null;
  return { build, version: r.tag_name.replace(/^v/, '') };
}

let busy = false;
export async function installApk(onProgress) {
  const N = window.Capacitor?.Plugins?.BoomboxNative;
  // Ancienne appli sans le bouton natif : téléchargement classique par le navigateur
  if (!N?.installApk) return void window.open(APK_URL, '_system');
  if (busy) return;
  busy = true;
  const sub = await N.addListener?.('apkProgress', (e) => onProgress?.(e.progress)).catch?.(() => null);
  try {
    await N.installApk({ url: APK_URL });
  } catch (e) {
    if (/permission/.test(e?.code || e?.message)) toast('Autorise Boombox à installer des applis, puis réappuie sur « Mettre à jour »');
    else toast(`Mise à jour impossible : ${e?.message || e}`);
  } finally {
    busy = false;
    sub?.remove?.();
  }
}

// Au lancement : bandeau discret si une nouvelle version existe (une fois par version, refermable)
export async function checkApkUpdate() {
  const v = await latestApk();
  if (!v || localStorage.getItem('boombox.apkDismissed') === String(v.build)) return;
  const b = document.createElement('div');
  b.className = 'expiry-banner apk-banner';
  b.innerHTML = `<span>Nouvelle version de Boombox (${v.version})</span><button>Mettre à jour</button><button aria-label="Fermer" style="background:none;color:#000;padding:0 4px">✕</button>`;
  const [go, close] = b.querySelectorAll('button');
  go.onclick = () => installApk((p) => (go.textContent = `${Math.round(p * 100)} %`)).finally(() => (go.textContent = 'Mettre à jour'));
  close.onclick = () => {
    try { localStorage.setItem('boombox.apkDismissed', String(v.build)); } catch {}
    b.remove();
  };
  document.body.appendChild(b);
}
