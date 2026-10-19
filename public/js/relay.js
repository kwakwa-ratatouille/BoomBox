// Appli mobile : trouve ton PC Boombox pour lire l'audio par lui (yt-dlp, fiable et instantané).
// 1. Même Wi-Fi : adresse du PC sur le réseau local.  2. Partout (4G/5G) : tunnel Internet du serveur, avec sa clé.
// Sans PC joignable, le téléphone lit ce qui est déjà téléchargé et tente la récupération directe.
import { isNative, localApi } from './native.js';
import { cloud, getDocs } from './cloud.js';

let timer = null;

// Le PC répond-il ? (requête « no-cors » : on ne lit pas la réponse, on vérifie juste qu'il est joignable)
async function reachable(base, key) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), base.startsWith('https') ? 4000 : 1800);
  try {
    await fetch(`${base}/api/status${key ? `?k=${encodeURIComponent(key)}` : ''}`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// Serveurs connus de la bibliothèque, le plus récemment vu d'abord
async function servers() {
  const snap = await getDocs(cloud.col('devices'));
  return snap.docs
    .map((d) => d.data())
    .filter((d) => (d.lan || []).length || d.publicUrl)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

export async function findRelay() {
  if (!isNative || !cloud.spaceId) return null;
  const media = (await localApi()).media;
  if (!media.net.connected) return (media.setRelay(null), null);
  try {
    const list = await servers();
    // Réseau local d'abord (en Wi-Fi), puis le tunnel Internet
    if (media.net.wifi) for (const s of list) for (const base of s.lan || []) if (await reachable(base)) return found(media, base, null);
    for (const s of list) if (s.publicUrl && s.relayKey && (await reachable(s.publicUrl, s.relayKey))) return found(media, s.publicUrl, s.relayKey);
  } catch {}
  media.setRelay(null);
  return null;
}
async function found(media, base, key) {
  const was = media.getRelay();
  media.setRelay(base, key);
  // PC joignable : le téléphone en profite pour télécharger tes likes (écoute ensuite possible PC éteint)
  if (was !== base) import('./offline.js').then(({ offline }) => offline.sync()).catch(() => {});
  return base;
}

// Diagnostic : serveurs annoncés et réponse de chacun
export async function relayReport(log) {
  try {
    const list = await servers();
    if (!list.length) log("Aucun PC n'a annoncé son adresse : lance le serveur Boombox sur le PC (et ouvre Boombox une fois sur le PC).");
    for (const s of list) {
      for (const base of s.lan || []) log(`${s.name} · local ${base} : ${(await reachable(base)) ? 'joignable ✓' : 'injoignable ✗'}`);
      if (s.publicUrl) log(`${s.name} · Internet : ${(await reachable(s.publicUrl, s.relayKey)) ? 'joignable ✓' : 'injoignable ✗'}`);
      if (s.lastSeen) log(`   vu il y a ${Math.round((Date.now() - s.lastSeen) / 60000)} min`);
    }
  } catch (e) {
    log(`Liste des appareils : ${e.message}`);
  }
  return findRelay();
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
