// Réveil en musique : à l'heure choisie, une playlist (ou tes titres likés) se lance en aléatoire, avec un volume
// qui monte doucement pendant 1 minute. Sur téléphone, une notification programmée sonne aussi (même appli fermée) :
// la toucher ouvre Boombox et lance la musique.
import { state, setting, saveSettings } from './state.js';
import { player, ctl, startAt } from './player.js';
import { toast } from './ui.js';

const LN = () => window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.LocalNotifications;
const NOTIF_ID = 770077;

export const alarmConf = () => ({ on: false, time: '07:30', source: 'liked', ...(setting('alarm', null) || {}) });

function tracksOf(source) {
  if (source === 'liked') return state.library.liked || [];
  return state.library.playlists.find((p) => p.id === source)?.tracks || state.library.liked || [];
}

// Lance le réveil : musique en aléatoire, volume de 10 % jusqu'au volume habituel en 60 s
export function ring() {
  const a = alarmConf();
  const tracks = tracksOf(a.source);
  if (!tracks.length) return toast('Réveil : la playlist choisie est vide');
  const target = player.volume || 0.8;
  if (!player.shuffle) ctl.toggleShuffle();
  ctl.setVolume(0.1);
  ctl.playList(tracks, startAt(tracks), { type: 'alarm', name: 'Réveil' });
  const t0 = Date.now();
  const iv = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / 60e3);
    if (player.paused && k > 0.05) return clearInterval(iv);
    ctl.setVolume(0.1 + (target - 0.1) * k);
    if (k >= 1) clearInterval(iv);
  }, 1000);
  toast('⏰ Bonjour ! Ton réveil Boombox', { timeout: 8000 });
}

// Notification quotidienne programmée (téléphone)
export async function scheduleAlarm() {
  const P = LN();
  if (!P) return;
  await P.cancel({ notifications: [{ id: NOTIF_ID }] }).catch(() => {});
  const a = alarmConf();
  if (!a.on) return;
  const [hour, minute] = a.time.split(':').map(Number);
  await P.requestPermissions?.().catch(() => {});
  await P.schedule({ notifications: [{ id: NOTIF_ID, title: '⏰ Réveil Boombox', body: 'Touche pour lancer ta musique', schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true }, extra: { alarm: true } }] }).catch(() => {});
}

export async function saveAlarm(patch) {
  await saveSettings({ alarm: { ...alarmConf(), ...patch } });
  await scheduleAlarm();
}

// Vérification à l'heure dite quand l'appli est ouverte (PC laissé allumé, téléphone au premier plan)
export function startAlarm() {
  const fired = () => localStorage.getItem('boombox.alarmFired');
  setInterval(() => {
    const a = alarmConf();
    if (!a.on) return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const key = `${now.toISOString().slice(0, 10)} ${a.time}`;
    if (hm === a.time && fired() !== key) {
      localStorage.setItem('boombox.alarmFired', key);
      ring();
    }
  }, 15e3);
  // Notification de réveil touchée : on lance la musique
  LN()?.addListener?.('localNotificationActionPerformed', (e) => {
    if (!e?.notification?.extra?.alarm) return;
    localStorage.setItem('boombox.alarmFired', `${new Date().toISOString().slice(0, 10)} ${alarmConf().time}`);
    setTimeout(ring, 800);
  });
  scheduleAlarm();
}
