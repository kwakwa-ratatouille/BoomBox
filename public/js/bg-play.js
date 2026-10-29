// PC : fermer la fenêtre Boombox pendant un son ne coupe plus la musique. Le son en cours (au même moment) et la
// suite de la file passent à l'icône près de l'horloge (scripts\tray.ps1), qui les joue en fond ; en rouvrant
// Boombox, la fenêtre reprend la main là où l'icône en est. Serveur : /api/bg.
import { player } from './player.js';
import { emit } from './state.js';
import { toast } from './ui.js';

const slim = (t) => t && { id: t.id, title: t.title, artists: (t.artists || []).map((a) => ({ name: a.name, id: a.id || null })), album: t.album || null, duration: t.duration || 0, thumb: t.thumb || null };

export function setupBackgroundPlay() {
  if (window.Capacitor?.isNativePlatform?.() || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  // Fermeture de la fenêtre pendant la lecture : on passe la main (sendBeacon part même pendant la fermeture)
  window.addEventListener('pagehide', () => {
    if (!player.track || player.paused || player.remoteSender || player.engine?.name !== 'audio') return;
    const queue = (player.upcoming?.() || []).slice(0, 100).map(slim);
    navigator.sendBeacon('/api/bg/play', JSON.stringify({ track: slim(player.track), position: player.time(), queue, context: player.context || null }));
  });
  // Ouverture : la musique jouait en fond → elle revient ici, au même moment
  setTimeout(async () => {
    const s = await fetch('/api/bg').then((r) => r.json()).catch(() => null);
    if (!s?.track) return;
    const b = await fetch('/api/bg/stop', { method: 'POST' }).then((r) => r.json()).catch(() => null);
    if (!b?.track) return;
    const list = [b.track, ...(b.queue || [])];
    Object.assign(player, { list, order: list.map((_, i) => i), pos: 0, userQueue: [], context: b.context || { type: 'bg', name: 'Lecture en fond' } });
    player._load(b.track, { start: b.position || 0, autoplay: !!b.playing });
    emit('player:queue');
    // Lecture automatique refusée par le navigateur (pas encore de clic) : un appui suffit
    if (b.playing) setTimeout(() => player.paused && toast('La musique jouait en fond : appuie sur lecture pour continuer ici', { action: 'Lecture', timeout: 10000, onAction: () => player.play() }), 2500);
  }, 300);
}
