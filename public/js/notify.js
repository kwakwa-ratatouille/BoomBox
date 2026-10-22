// Notifications de Boombox : nouvelles sorties de tes artistes, rappels des concerts mis en favori.
// Téléphone : notifications de l'appli (même appli fermée pour les rappels programmés) ; PC : notifications du navigateur.
import { ls } from './state.js';

const LN = () => window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.LocalNotifications;
const idOf = (s) => {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 2000000000;
};

export async function askNotifications() {
  const P = LN();
  if (P) return (await P.requestPermissions().catch(() => ({}))).display === 'granted';
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  return Notification.permission === 'granted';
}

// Notification tout de suite (url : page de l'appli à ouvrir au toucher)
export async function notifyNow(title, body, { url = '', icon = '', tag = '' } = {}) {
  const P = LN();
  if (P) {
    if ((await P.checkPermissions().catch(() => ({}))).display !== 'granted') return;
    return P.schedule({ notifications: [{ id: idOf(tag || title + Date.now()), title, body, extra: { url } }] }).catch(() => {});
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, icon: icon || '/assets/logo-symbol.png?v=2', tag: tag || undefined });
  n.onclick = () => (window.focus(), url && (location.hash = url), n.close());
}

// Rappels programmés d'un concert : la veille et le jour même à 10 h (téléphone : même appli fermée)
export async function scheduleConcert(c) {
  const day = new Date(c.date);
  if (isNaN(day)) return;
  const at = (d) => { const x = new Date(day); x.setDate(x.getDate() - d); x.setHours(10, 0, 0, 0); return x; };
  const items = [
    { when: at(1), title: `Demain : ${c.artist || c.title}`, body: `${c.venue}${c.city ? ` · ${c.city}` : ''}` },
    { when: at(0), title: `Ce soir : ${c.artist || c.title}`, body: `${c.venue}${c.city ? ` · ${c.city}` : ''} — bon concert !` },
  ].filter((x) => x.when > new Date());
  const P = LN();
  if (P) {
    if (!(await askNotifications())) return;
    await P.schedule({ notifications: items.map((x, k) => ({ id: idOf(`${c.id}:${k}`), title: x.title, body: x.body, schedule: { at: x.when, allowWhileIdle: true }, extra: { url: '#/concerts' } })) }).catch(() => {});
    return;
  }
  // PC : on garde les rappels et on les affiche à l'ouverture de l'appli le bon jour
  const list = ls.get('boombox.concertReminders', []).filter((r) => !r.id.startsWith(`${c.id}:`));
  items.forEach((x, k) => list.push({ id: `${c.id}:${k}`, at: x.when.getTime(), title: x.title, body: x.body }));
  ls.set('boombox.concertReminders', list);
}

export async function cancelConcert(c) {
  const P = LN();
  if (P) return P.cancel({ notifications: [0, 1].map((k) => ({ id: idOf(`${c.id}:${k}`) })) }).catch(() => {});
  ls.set('boombox.concertReminders', ls.get('boombox.concertReminders', []).filter((r) => !r.id.startsWith(`${c.id}:`)));
}

// PC : rappels arrivés à échéance (affichés à l'ouverture ou pendant que l'appli tourne)
export function checkDueReminders() {
  const now = Date.now();
  const list = ls.get('boombox.concertReminders', []);
  const due = list.filter((r) => r.at <= now && now - r.at < 20 * 3600e3);
  if (!due.length) return;
  due.forEach((r) => notifyNow(r.title, r.body, { url: '#/concerts', tag: r.id }));
  ls.set('boombox.concertReminders', list.filter((r) => !due.includes(r) && r.at > now - 20 * 3600e3));
}

// Toucher une notification sur le téléphone : ouvre la bonne page
export function setupNotificationTaps() {
  const P = LN();
  P?.addListener?.('localNotificationActionPerformed', (e) => {
    const url = e?.notification?.extra?.url;
    if (url && /^[a-z]+:\/\//i.test(url)) location.href = url; // ex. rappel d'expiration → SideStore
    else if (url) location.hash = url;
  });
}
