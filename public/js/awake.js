// Écran gardé allumé tant qu'au moins une raison le demande (paroles affichées pendant la lecture).
// Navigateur, PC et iPhone récent : API Wake Lock. Appli téléphone : module natif en plus
// (la WebView Android n'a pas l'API ; sur iPhone elle n'existe que depuis iOS 18.4).
import { isNative } from './native.js';

const want = new Set();
let lock = null;
let asking = false;
let nativeOn = false;

const wanted = () => want.size > 0 && !document.hidden;

function sync() {
  const v = wanted();
  if (isNative && v !== nativeOn) {
    nativeOn = v;
    window.Capacitor?.Plugins?.BoomboxNative?.setKeepAwake?.({ on: v })?.catch?.(() => {}); // appli d'avant : sans effet
  }
  if (v && !lock && !asking && navigator.wakeLock) {
    asking = true;
    navigator.wakeLock.request('screen').then((l) => {
      lock = l;
      l.addEventListener('release', () => lock === l && (lock = null));
      if (!wanted()) sync();
    }).catch(() => {}).finally(() => (asking = false));
  } else if (!v && lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}

// key : n'importe quel objet propre à l'appelant ; on = true pour demander, false pour rendre la main
export function keepAwake(key, on) {
  if (on === want.has(key)) return;
  on ? want.add(key) : want.delete(key);
  sync();
}

// Retour sur l'appli : le navigateur a relâché le verrou en arrière-plan, on le reprend
document.addEventListener('visibilitychange', sync);
