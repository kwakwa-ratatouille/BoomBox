// Écoute hors ligne (appli mobile uniquement) : playlists téléchargées, likes téléchargés automatiquement
// (en Wi-Fi par défaut), limite d'espace, et cache intelligent des titres écoutés récemment.
import { state, on, setting, saveSettings, ls } from './state.js';
import { isNative, localApi } from './native.js';
import { toast } from './ui.js';

export const offline = {
  ready: false,
  media: null,
  downloaded: new Set(),
  queue: [],
  running: false,

  async init() {
    if (!isNative) return;
    this.media = (await localApi()).media;
    this.ready = true;
    this.refreshSet();
    document.body.classList.toggle('offline', !this.media.net.connected);
    this.media.net.listeners.add((n) => {
      document.body.classList.toggle('offline', !n.connected);
      toast(n.connected ? 'De nouveau en ligne' : 'Hors ligne : seuls les titres téléchargés sont disponibles');
      if (n.connected) this.sync();
    });
    on('library', () => this.sync());
    this.sync();
  },

  refreshSet() {
    this.downloaded = new Set(Object.keys(this.media.audioIndex));
    window.__bbOffline = this.downloaded;
  },

  limitBytes() {
    return Number(ls.get('boombox.storageLimitGB', 1)) * 1024 ** 3;
  },

  // Titres à garder sur le téléphone selon les réglages
  wanted() {
    const ids = new Map();
    const offPl = setting('offlinePlaylists', []);
    for (const p of state.library.playlists) if (offPl.includes(p.id)) p.tracks.forEach((t) => ids.set(t.id, t));
    // Likes téléchargés automatiquement (par défaut) : écoute possible PC éteint, dans la limite d'espace
    if (setting('offlineLiked', true)) state.library.liked.forEach((t) => ids.set(t.id, t));
    return ids;
  },

  // Télécharge ce qui manque (en Wi-Fi seulement si l'option est active), dans la limite d'espace
  sync() {
    if (!this.ready || !this.media.net.connected) return;
    if (setting('offlineWifiOnly', true) && !this.media.net.wifi) return;
    const want = this.wanted();
    for (const id of Object.keys(this.media.audioIndex)) if (!want.has(id) && this.media.audioIndex[id].keep) this.media.unkeep(id);
    this.queue = [...want.keys()].filter((id) => !this.media.isDownloaded(id));
    this.pump();
  },

  async pump() {
    if (this.running) return;
    this.running = true;
    localStorage.setItem('boombox.storageLimit', String(this.limitBytes()));
    let done = 0;
    let fails = 0;
    while (this.queue.length && this.media.net.connected) {
      // Sans PC joignable, la récupération directe est souvent bloquée par YouTube : on n'insiste pas
      if (!this.media.getRelay() && fails >= 3) break;
      if (this.media.storageUsed() > this.limitBytes() * 0.97) {
        toast('Limite d’espace atteinte : augmente-la dans les Paramètres pour tout télécharger');
        break;
      }
      const id = this.queue.shift();
      try {
        await this.media.downloadAudio(id, { keep: true });
        done++;
        fails = 0;
        this.refreshSet();
        if (done % 5 === 0) document.dispatchEvent(new Event('offline-progress'));
      } catch {
        fails++;
      }
    }
    this.running = false;
    this.refreshSet();
    document.dispatchEvent(new Event('offline-progress'));
  },

  isPlaylistOffline: (id) => setting('offlinePlaylists', []).includes(id),

  async togglePlaylist(id) {
    const list = setting('offlinePlaylists', []);
    const on = !list.includes(id);
    await saveSettings({ offlinePlaylists: on ? [...list, id] : list.filter((x) => x !== id) });
    toast(on ? 'Téléchargement de la playlist…' : 'Playlist retirée des téléchargements');
    this.sync();
    return on;
  },

  // Nombre de titres d'une liste déjà sur le téléphone
  count(tracks) {
    return tracks.filter((t) => this.downloaded.has(t.id)).length;
  },
};