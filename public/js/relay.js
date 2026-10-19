// Appli mobile : trouve le PC Boombox sur le même Wi-Fi pour lire l'audio par lui (yt-dlp, fiable et instantané).
// Sans PC joignable (4G/5G, PC éteint), le téléphone récupère l'audio lui-même.
import { isNative, localApi } from './native.js';
import { cloud, getDocs } from './cloud.js';

let timer = null;

// Le PC répond-il ? (requête « no-cors » : on ne lit pas la réponse, on vérifie juste qu'il est joignable)
async function reachable(base) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1800);
  try {
    await fetch(`${base}/api/status`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function findRelay() {
  if (!isNative || !cloud.spaceId) return null;
  const media = (await localApi()).media;
  if (!media.net.connected || !media.net.wifi) {
    media.setRelay(null);
    return null;
  }
  try {
    const snap = await getDocs(cloud.col('devices'));
    const pcs = snap.docs.map((d) => d.data()).filter((d) => (d.lan || []).length).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    for (const pc of pcs) for (const base of pc.lan) if (await reachable(base)) return (media.setRelay(base), base);
  } catch {}
  media.setRelay(null);
  return null;
}

// Au démarrage, à chaque changement de réseau, puis toutes les 2 minutes (PC allumé entre-temps…)
export async function startRelay() {
  if (!isNative) return;
  const media = (await localApi()).media;
  findRelay();
  media.net.listeners.add(() => findRelay());
  clearInterval(timer);
  timer = setInterval(() => findRelay(), 120e3);
}
