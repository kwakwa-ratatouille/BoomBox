// Écoute hors ligne (appli mobile uniquement) : playlists téléchargées, likes téléchargés automatiquement
// (en Wi-Fi par défaut), limite d'espace, et cache intelligent des titres écoutés récemment.
import { state, on, setting, saveSettings, ls, getStatsFull } from './state.js';
import { isNative, localApi } from './native.js';
import { toast } from './ui.js';

// Petite taille de pochette (comme les listes de sons) : moins de place sur le téléphone
const sizedThumb = (u) => (/googleusercontent\.com|ggpht\.com/.test(u) ? u.replace(/=w\d+-h\d+/, '=w226-h226').replace(/=s\d+/, '=s226') : /i\.ytimg\.com/.test(u) ? u.replace(/\/(hq|sd|maxres)default\.jpg/, '/mqdefault.jpg') : u);

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
    this.loadCovers();
    this.refreshSet();
    document.body.classList.toggle('offline', !this.media.net.connected);
    // Messages seulement pour une vraie coupure : le réseau change souvent quelques secondes (Wi-Fi ↔ 4G, appli qui
    // revient au premier plan), et chaque micro-coupure affichait « Hors ligne » puis « De nouveau en ligne »
    let offT = 0;
    let warned = false;
    this.media.net.listeners.add((n) => {
      clearTimeout(offT);
      if (!n.connected) {
        offT = setTimeout(() => {
          if (this.media.net.connected) return;
          document.body.classList.add('offline');
          warned = true;
          toast('Hors ligne : seuls les titres téléchargés sont disponibles');
        }, 8000);
        return;
      }
      document.body.classList.remove('offline');
      if (warned) toast('De nouveau en ligne');
      warned = false;
      this.sync();
    });
    on('library', () => this.sync());
    this.sync();
  },

  refreshSet() {
    this.downloaded = new Set(Object.keys(this.media.audioIndex));
    window.__bbOffline = this.downloaded;
    window.__bbOfflineKept = (id) => this.isTrackKept(id);
  },

  // ---------- Pochettes gardées sur le téléphone (affichées même hors ligne, et plus vite) ----------
  // Une petite image (≈ 15 Ko) par son téléchargé, dans Data/covers ; index des pochettes en mémoire locale.
  covers: {},
  coverKey(url) {
    let h = 0;
    for (const ch of String(url)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
    return (h >>> 0).toString(36);
  },
  async loadCovers() {
    const fsys = window.Capacitor?.Plugins?.Filesystem;
    if (!fsys) return;
    const keys = JSON.parse(localStorage.getItem('boombox.covers') || '[]');
    const { uri } = await fsys.getUri({ path: 'covers', directory: 'DATA' }).catch(() => ({}));
    if (!uri) return;
    for (const k of keys) this.covers[k] = window.Capacitor.convertFileSrc(`${uri}/${k}.jpg`);
    window.__bbCoverSrc = (u) => (u && this.covers[this.coverKey(u)]) || null;
  },
  async saveCover(url) {
    const fsys = window.Capacitor?.Plugins?.Filesystem;
    if (!fsys || !url || url.startsWith('data:') || url.startsWith('/')) return;
    const k = this.coverKey(url);
    if (this.covers[k]) return;
    try {
      const blob = await (await fetch(await this.media.imageBlobUrl(url))).blob();
      if (blob.size > 400000) return;
      const b64 = await new Promise((ok, ko) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1]);
        r.onerror = ko;
        r.readAsDataURL(blob);
      });
      const { uri } = await fsys.writeFile({ path: `covers/${k}.jpg`, data: b64, directory: 'DATA', recursive: true });
      this.covers[k] = window.Capacitor.convertFileSrc(uri);
      const keys = JSON.parse(localStorage.getItem('boombox.covers') || '[]');
      keys.push(k);
      localStorage.setItem('boombox.covers', JSON.stringify(keys.slice(-5000)));
      window.__bbCoverSrc ??= (u) => (u && this.covers[this.coverKey(u)]) || null;
    } catch {}
  },

  limitBytes() {
    return Number(ls.get('boombox.storageLimitGB', 4)) * 1024 ** 3;
  },

  // Téléchargement intelligent : les sons les plus écoutés ces 2 derniers mois (recalculés toutes les 6 h)
  smart: [],
  async refreshSmart() {
    if (!setting('offlineSmart', true)) return (this.smart = []);
    const st = await getStatsFull(60, null, 150).catch(() => null);
    this.smart = (st?.topTracks || []).map((x) => x.track).filter((t) => t?.id);
  },

  // Titres à garder sur le téléphone selon les réglages, par ordre de priorité (si la place manque, les derniers
  // attendent) : les plus écoutés, puis les playlists téléchargées, puis les likes
  wanted() {
    const ids = new Map();
    if (setting('offlineSmart', true)) this.smart.forEach((t) => ids.set(t.id, t));
    const offPl = setting('offlinePlaylists', []);
    for (const p of state.library.playlists) if (offPl.includes(p.id)) p.tracks.forEach((t) => ids.set(t.id, t));
    // Likes téléchargés automatiquement (par défaut) : écoute possible PC éteint, dans la limite d'espace
    if (setting('offlineLiked', true)) state.library.liked.forEach((t) => ids.set(t.id, t));
    // Sons téléchargés un par un (menu du son → Télécharger sur le téléphone)
    setting('offlineTracks', []).forEach((t) => t?.id && ids.set(t.id, t));
    return ids;
  },

  // Télécharge ce qui manque (en Wi-Fi seulement si l'option est active), dans la limite d'espace
  sync() {
    if (!this.ready || !this.media.net.connected) return;
    // Liste « les plus écoutés » mise à jour au plus toutes les 6 h
    if (Date.now() - (this._smartAt || 0) > 6 * 3600e3) {
      this._smartAt = Date.now();
      this.refreshSmart().then(() => this.sync()).catch(() => {});
    }
    // Par défaut : aussi en 4G/5G (sinon les sons ne sont pas prêts hors connexion)
    if (setting('offlineWifiOnly', false) && !this.media.net.wifi) return;
    const want = this.wanted();
    this._want = want;
    for (const t of want.values()) this.media.rememberMeta?.(t);
    for (const id of Object.keys(this.media.audioIndex)) if (!want.has(id) && this.media.audioIndex[id].keep) this.media.unkeep(id);
    this.queue = [...want.keys()].filter((id) => !this.media.isDownloaded(id));
    this.pump();
    this.backfillCovers();
  },

  // Pochettes des sons déjà téléchargés : récupérées tranquillement en Wi-Fi (une toutes les 0,3 s)
  async backfillCovers() {
    if (this._coversRunning || !this.media.net.wifi || !this._want) return;
    this._coversRunning = true;
    try {
      for (const [id, t] of this._want) {
        if (!this.media.net.wifi) break;
        if (!t?.thumb || !this.media.isDownloaded(id) || this.covers[this.coverKey(sizedThumb(t.thumb))]) continue;
        await this.saveCover(sizedThumb(t.thumb));
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      this._coversRunning = false;
    }
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
        const t = this._want?.get(id);
        if (t?.thumb) this.saveCover(sizedThumb(t.thumb));
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
  isTrackKept: (id) => setting('offlineTracks', []).some((t) => t?.id === id),

  async toggleTrack(track) {
    const list = setting('offlineTracks', []);
    const on = !list.some((t) => t?.id === track.id);
    const slim = { id: track.id, title: track.title, artists: (track.artists || []).map((a) => ({ name: a.name, id: a.id || null })), thumb: track.thumb || null, duration: track.duration || 0 };
    await saveSettings({ offlineTracks: on ? [...list, slim].slice(-500) : list.filter((t) => t?.id !== track.id) });
    if (on) {
      this.media?.rememberMeta?.(track);
      toast('Téléchargement du son…');
      // Tout de suite, même hors Wi-Fi : c'est une demande explicite
      this.media?.downloadAudio(track.id, { keep: true }).then(() => (this.refreshSet(), document.dispatchEvent(new Event('offline-progress')), toast('Son téléchargé : écoute possible hors ligne'))).catch((e) => toast(`Téléchargement impossible : ${e.message}`));
    } else {
      this.media?.unkeep?.(track.id);
      toast('Son retiré des téléchargements');
    }
  },

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