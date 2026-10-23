// Lecteur : moteurs de lecture (YouTube intégré ou audio direct via yt-dlp), file d'attente,
// aléatoire, répétition, lecture automatique, minuteur de sommeil, contrôles système.
import { state, emit, bus, api, ls, setting, addHistory } from './state.js';
import { toast, artistNames } from './ui.js';
import { automix } from './automix.js';
import { isNative, localApi } from './native.js';

// Source audio d'un titre : serveur du PC (flux yt-dlp) ou, dans l'appli, fichier téléchargé sur le téléphone
// Connexion faible : son plus léger (~50 kb/s au lieu de ~130) plutôt qu'une lecture qui bloque.
// Activé tout seul après des blocages répétés, ou forcé dans les Paramètres (Qualité du son).
let lowQuality = false;
const wantLow = () => lowQuality || setting('audioQuality', 'auto') === 'low' || !!navigator.connection?.saveData || /(^|-)2g$|^3g$/.test(navigator.connection?.effectiveType || '');
async function audioSrc(id, fresh = false, stream = false) {
  const low = setting('audioQuality', 'auto') !== 'high' && wantLow();
  // Appli : fichier du téléphone, ou streaming immédiat la première fois (sauf nouvel essai → fichier local)
  if (isNative) return (await localApi()).media.localAudioSrc(id, { stream: stream && !fresh, low });
  const q = [fresh && `fresh=${Date.now()}`, low && 'q=low'].filter(Boolean).join('&');
  return `/api/stream/${id}${q ? `?${q}` : ''}`;
}

// ---------- Moteur YouTube (iframe) ----------
let ytApiPromise = null;
function loadYtApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = resolve;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytApiPromise;
}

class YouTubeEngine {
  name = 'youtube';
  constructor(h) {
    this.h = h;
    this.ready = loadYtApi().then(
      () =>
        new Promise((resolve) => {
          this.p = new YT.Player('yt-player', {
            width: '100%',
            height: '100%',
            playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0, origin: location.origin },
            events: {
              onReady: () => resolve(),
              onStateChange: (e) => this.onState(e.data),
              onError: (e) => this.h.onError(e.data),
            },
          });
        }),
    );
  }
  onState(s) {
    if (s === 0) this.h.onEnded();
    else if (s === 1) this.h.onPlaying();
    else if (s === 2) this.h.onPaused();
    else if (s === 3) this.h.onBuffering();
    else if (s === 5) this.h.onPaused();
  }
  async load(id, start = 0, autoplay = true) {
    await this.ready;
    if (autoplay) this.p.loadVideoById({ videoId: id, startSeconds: start });
    else this.p.cueVideoById({ videoId: id, startSeconds: start });
  }
  play() { this.p?.playVideo?.(); }
  pause() { this.p?.pauseVideo?.(); }
  stop() { this.p?.stopVideo?.(); }
  seek(s) { this.p?.seekTo?.(s, true); }
  setVolume(v) { this.p?.setVolume?.(Math.round(v * 100)); }
  setRate(r) { this.p?.setPlaybackRate?.(r); }
  time() { return this.p?.getCurrentTime?.() || 0; }
  duration() { return this.p?.getDuration?.() || 0; }
}

// ---------- Transitions du mix (comme le mix de Spotify) ----------
// levels(k, a) → [volume entrant, volume sortant], k = avancement du mix (0 → 1), a = moment où l'entrant démarre.
// setup() programme les filtres et l'écho sur toute la durée.
const PI2 = Math.PI / 2;
const ease = (x) => Math.sin(Math.min(1, Math.max(0, x)) * PI2);
export const TRANSITIONS = {
  // Fondu enchaîné : les deux se croisent à puissance constante
  crossfade: { name: 'Fondu enchaîné', levels: (k) => [ease(k), Math.cos(Math.min(1, k) * PI2)] },
  // Fondu : le premier s'éteint, puis le suivant arrive (léger recouvrement)
  fade: { name: 'Fondu', levels: (k, a) => [k < a ? 0 : ease((k - a) / (1 - a)), Math.max(0, 1 - ease(k / Math.min(1, a + 0.15)))] },
  // Blend : tempos calés, le suivant monte sans ses basses, échange des basses à mi-parcours
  blend: { name: 'Blend', bassSwap: true, levels: (k) => [ease(k * 2), k < 0.5 ? 1 : Math.cos((k - 0.5) * 2 * PI2)] },
  // Amplification : le suivant monte en s'ouvrant (filtre qui se lève) avec un petit surcroît de volume
  rise: { name: 'Amplification', setup: (e, o, i, len) => (e._sweep(i, 'hp', 1200, 10, len * 0.75), e._sweep(o, 'lp', 20000, 1200, len)), levels: (k) => [Math.min(1.15, ease(k * 1.3) * (1 + 0.15 * Math.sin(Math.min(1, k) * Math.PI))), Math.cos(Math.min(1, k) * PI2)] },
  // Montée en puissance : le titre en cours se filtre et s'emballe (écho qui monte), puis le suivant tombe d'un coup
  powerup: { name: 'Montée en puissance', setup: (e, o, i, len, beat, a) => (e._sweep(o, 'hp', 10, 2200, len * a), e._echo(o, 0, 0.75, len * a, beat / 2)), levels: (k, a) => [k < a ? 0 : 1, k < a ? 1 : 0] },
  // Wave : le titre en cours s'étouffe (comme sous l'eau) pendant que le suivant s'éclaircit
  wave: { name: 'Wave', setup: (e, o, i, len) => (e._sweep(o, 'lp', 18000, 300, len), e._sweep(i, 'lp', 500, 18000, len * 0.8)), levels: (k) => [ease((k - 0.15) / 0.85), Math.cos(Math.min(1, k) * PI2)] },
  // Melt : les deux fondent l'un dans l'autre, le sortant perd ses basses et se dissout dans un écho
  melt: { name: 'Melt', setup: (e, o, i, len, beat) => (e._sweep(o, 'hp', 10, 500, len), e._echo(o, 0, 0.6, len, beat * 0.75), e._sweep(i, 'lp', 900, 18000, len)), levels: (k) => [ease(k), Math.cos(Math.min(1, k) * PI2)] },
  // Slam : coupure sèche sur le temps fort, un dernier écho du titre précédent, le suivant démarre plein pot
  slam: { name: 'Slam', setup: (e, o, i, len, beat) => e._echo(o, 0.9, 0.9, beat * 0.5, beat), levels: (k) => [1, k < 0.12 ? 1 - k / 0.12 : 0] },
  // Rémanence : le titre en cours part en écho (il continue de résonner), puis le suivant s'installe
  echo: { name: 'Rémanence', setup: (e, o, i, len, beat, a) => e._echo(o, 0.3, 0.9, len * a * 0.6, beat * 0.75), levels: (k, a) => [k < a ? 0 : ease((k - a) / (1 - a)), Math.max(0, 1 - k / a)] },
};
export const TRANSITION_NAMES = { auto: 'Auto (le meilleur choix)', ...Object.fromEntries(Object.entries(TRANSITIONS).map(([k, v]) => [k, v.name])), none: 'Aucune transition' };

// ---------- Moteur audio direct (serveur + yt-dlp) ----------
// Deux lecteurs <audio> qui se relaient : pendant un fondu ou un mix, le titre suivant démarre sur le
// second lecteur pendant que le premier s'éteint. Avec l'automix, le son passe par Web Audio
// (filtre passe-haut pour l'échange des basses, gain par titre pour égaliser les volumes).
class AudioEngine {
  name = 'audio';
  constructor(h) {
    this.h = h;
    this.base = 1; // volume voulu (0..1)
    this.fade = null;
    this.graph = null;
    this.preloaded = null;
    this.pending = null; // titre entrant d'un fondu / mix pas encore lancé : { start }
    this.gen = 0; // incrémenté à chaque changement de titre : annule les mix / fondus devenus obsolètes
    const a1 = document.getElementById('audio');
    const a2 = a1.cloneNode();
    a2.id = 'audio2';
    a1.after(a2);
    this.els = [a1, a2];
    this.norm = [1, 1];
    this.level = [1, 1];
    this.cur = 0;
    for (const el of this.els) {
      // Seuls les événements du lecteur actif comptent (l'autre est en train de s'éteindre)
      const mine = () => el === this.a;
      el.addEventListener('ended', () => mine() && h.onEnded());
      el.addEventListener('playing', () => mine() && h.onPlaying());
      el.addEventListener('pause', () => mine() && !el.ended && h.onPaused());
      el.addEventListener('waiting', () => mine() && h.onBuffering());
      // Code du lecteur : 2 = réseau, 3 = décodage, 4 = format non pris en charge (ou fichier invalide)
      el.addEventListener('error', () => mine() && el.getAttribute('src') && h.onError(`lecteur ${el.error?.code || '?'}${el.error?.message ? ' : ' + el.error.message.slice(0, 50) : ''}`));
    }
  }
  get a() { return this.els[this.cur]; }
  get other() { return this.els[1 - this.cur]; }

  // Active la chaîne Web Audio (une seule fois, irréversible pour la page)
  enableGraph() {
    if (this.graph) return;
    const ctx = new AudioContext();
    // Un contexte audio créé sans geste de l'utilisateur démarre « suspendu » : tout le son passerait
    // par lui et deviendrait muet. On le relance dès que possible (clic, touche, retour sur l'appli).
    const wake = () => ctx.state !== 'running' && ctx.state !== 'closed' && ctx.resume().catch(() => {});
    ['pointerdown', 'keydown', 'touchend'].forEach((ev) => document.addEventListener(ev, wake, { capture: true }));
    document.addEventListener('visibilitychange', wake);
    ctx.addEventListener('statechange', () => !this.a.paused && setTimeout(wake, 300));
    wake();
    // Par lecteur : passe-haut (couper les basses) → passe-bas (étouffer) → volume → sortie,
    // et un départ vers un écho calé sur le tempo (rémanence, melt, slam…) qui continue de sonner après la coupure.
    this.graph = { ctx, nodes: this.els.map((el) => {
      const src = ctx.createMediaElementSource(el);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 10;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      const gain = ctx.createGain();
      src.connect(hp).connect(lp).connect(gain).connect(ctx.destination);
      const send = ctx.createGain();
      send.gain.value = 0;
      const delay = ctx.createDelay(2);
      delay.delayTime.value = 0.375;
      const fb = ctx.createGain();
      fb.gain.value = 0.45;
      const wet = ctx.createGain();
      wet.gain.value = 0.8;
      gain.connect(send).connect(delay).connect(wet).connect(ctx.destination);
      delay.connect(fb).connect(delay);
      el.volume = 1;
      return { hp, lp, gain, send, delay, fb, wet };
    }) };
    this.els.forEach((_, i) => this._apply(i));
  }
  _idx(el) { return this.els.indexOf(el); }
  _apply(i) {
    // Appli mobile sans Web Audio : l'égalisation baisse seulement les sons trop forts (volume du lecteur, max 1)
    const v = this.base * this.level[i] * (this.graph ? this.norm[i] : isNative ? Math.min(1, this.norm[i]) : 1);
    if (this.graph) this.graph.nodes[i].gain.gain.value = Math.min(2, v);
    else this.els[i].volume = Math.min(1, v);
  }
  _setLevel(el, k) { const i = this._idx(el); this.level[i] = k; this._apply(i); }
  // Volume égalisé du titre en cours ; smooth : glisse en 1,5 s (quand l'analyse arrive pendant l'écoute)
  setNorm(g, smooth = false) {
    const i = this.cur;
    clearInterval(this._normTimer);
    if (!smooth || this.fade) {
      this.norm[i] = g;
      return this._apply(i);
    }
    const from = this.norm[i];
    const t0 = performance.now();
    this._normTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / 1500);
      this.norm[i] = from + (g - from) * k;
      this._apply(i);
      if (k >= 1) clearInterval(this._normTimer);
    }, 50);
  }
  _hp(el, freq, ramp = 0) {
    if (!this.graph) return;
    const f = this.graph.nodes[this._idx(el)].hp.frequency;
    const now = this.graph.ctx.currentTime;
    f.cancelScheduledValues(now);
    if (ramp) f.setTargetAtTime(freq, now, ramp / 3);
    else f.setValueAtTime(freq, now);
  }

  // ----- Effets des transitions -----
  _node(el) { return this.graph?.nodes[this._idx(el)]; }
  // Balayage exponentiel d'un filtre ('hp' ou 'lp') de `from` à `to` Hz en `secs` secondes
  _sweep(el, type, from, to, secs, wait = 0) {
    const n = this._node(el);
    if (!n) return;
    const f = n[type].frequency;
    const now = this.graph.ctx.currentTime + wait;
    f.cancelScheduledValues(this.graph.ctx.currentTime);
    f.setValueAtTime(from, now);
    f.exponentialRampToValueAtTime(Math.max(10, to), now + Math.max(0.05, secs));
  }
  // Écho : quantité envoyée qui passe de `from` à `to` en `secs` secondes, répétitions toutes les `delay` s
  _echo(el, from, to, secs, delay) {
    const n = this._node(el);
    if (!n) return;
    const now = this.graph.ctx.currentTime;
    n.delay.delayTime.setValueAtTime(Math.min(1.5, Math.max(0.08, delay)), now);
    n.send.gain.cancelScheduledValues(now);
    n.send.gain.setValueAtTime(from, now);
    n.send.gain.linearRampToValueAtTime(to, now + Math.max(0.05, secs));
  }
  // Remet un lecteur « à plat » (sans filtre ni écho ; la queue d'écho déjà partie s'éteint d'elle-même)
  _resetFx(el) {
    const n = this._node(el);
    if (!n) return;
    const now = this.graph.ctx.currentTime;
    for (const [p, v] of [[n.hp.frequency, 10], [n.lp.frequency, 20000], [n.send.gain, 0]]) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, now);
    }
  }

  // Balayage du filtre d'une fréquence à une autre (programmé d'un bloc : deux réglages successifs s'annuleraient)
  _hpSweep(el, from, to, secs) {
    if (!this.graph) return;
    const f = this.graph.nodes[this._idx(el)].hp.frequency;
    const now = this.graph.ctx.currentTime;
    f.cancelScheduledValues(now);
    f.setValueAtTime(from, now);
    f.setTargetAtTime(to, now, secs / 3);
  }

  async _setSrc(el, id, start, fresh = false) {
    el.dataset.track = id;
    // Streaming direct seulement hors chaîne Web Audio (un flux d'un autre domaine y serait muet) et pour le titre lancé
    const src = await audioSrc(id, fresh, !this.graph && el === this.a);
    if (el.dataset.track !== id) return; // un autre titre a été demandé entre-temps
    if (start) el.addEventListener('loadedmetadata', () => (el.currentTime = start), { once: true });
    el.src = src;
  }
  async load(id, start = 0, autoplay = true, fresh = false) {
    this._endFade();
    this.gen++;
    this.pending = null;
    this.preloaded = null;
    const el = this.a;
    // Raison précise affichée (ex. « IOS : réponse invalide ») : utile pour comprendre un échec sur téléphone
    await this._setSrc(el, id, start, fresh).catch((e) => this.h.onError(String(e?.message || 'audio').slice(0, 80)));
    if (el !== this.a) return;
    el.playbackRate = 1;
    this._setLevel(this.a, 1);
    this._hp(this.a, 10);
    if (autoplay) await this.play(true);
  }
  // Prépare le titre suivant sur le lecteur libre (pour un démarrage instantané au bon temps)
  preload(id, start = 0) {
    if (this.preloaded?.id === id || this.fade) return;
    this.preloaded = { id, start };
    const el = this.other;
    this._setSrc(el, id, start).then(() => {
      el.preload = 'auto';
      el.load();
    }).catch(() => (this.preloaded = null));
  }
  // Fondu enchaîné de `seconds` secondes vers le titre `id`
  async crossfade(id, seconds, rate = 1, gainIn = 1) {
    this._endFade();
    const gen = ++this.gen;
    this.pending = { start: 0 }; // l'affichage passe tout de suite au titre suivant, à 0:00
    const out = this.a;
    const inn = this.other;
    if (this.preloaded?.id !== id) await this._setSrc(inn, id, 0).catch(() => {});
    if (gen !== this.gen) return; // un autre titre a été lancé entre-temps
    this.preloaded = null;
    this.norm[this._idx(inn)] = gainIn; // volume égalisé du titre entrant (sinon celui d'un ancien titre)
    this._setLevel(inn, 0);
    inn.playbackRate = rate;
    inn.preservesPitch = inn.webkitPreservesPitch = true;
    this.cur = 1 - this.cur;
    this.pending = null;
    try {
      await inn.play();
    } catch {
      this.h.onPaused();
    }
    const t0 = performance.now();
    const dur = seconds * 1000;
    // setInterval (et non requestAnimationFrame) pour que le fondu continue onglet en arrière-plan
    this.fade = { out, inn, timer: setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      // Courbe « puissance constante » : le volume perçu reste stable pendant le fondu
      this._setLevel(inn, Math.sin((k * Math.PI) / 2));
      this._setLevel(out, Math.cos((k * Math.PI) / 2));
      if (k >= 1) this._endFade();
    }, 40) };
  }
  // Mix façon DJ : le titre entrant démarre sur un temps fort (après delayMs), éventuellement au tempo du sortant,
  // puis la transition choisie (voir TRANSITIONS) joue sur les volumes, les filtres et l'écho.
  // inAt : secondes après le début du mix où l'entrant démarre (0 = tout de suite).
  async mixTo({ id, inStart, rate = 1, mixLen, delayMs = 0, gainIn = 1, beatOut = 0.5, style = 'blend', inAt = 0 }) {
    // Téléphone : pas de calage du tempo (le lecteur de l'iPhone ne préserve pas bien la hauteur : le son semblait
    // accélérer puis ralentir pendant les transitions). La transition elle-même reste.
    if (isNative) rate = 1;
    this._endFade();
    const gen = ++this.gen;
    this.pending = { start: inStart };
    const out = this.a;
    const inn = this.other;
    const T = TRANSITIONS[style] || TRANSITIONS[{ beatmatch: 'blend', filter: 'wave' }[style]] || TRANSITIONS.crossfade;
    if (this.preloaded?.id !== id || inn.readyState < 1) {
      // Titre pas encore préparé : on attend ses métadonnées (8 s max, sinon simple fondu)
      const ready = new Promise((r) => {
        inn.addEventListener('loadedmetadata', () => r(true), { once: true });
        inn.addEventListener('error', () => r(false), { once: true });
        setTimeout(() => r(inn.readyState >= 1), 8000);
      });
      if (this.preloaded?.id !== id) await this._setSrc(inn, id, 0).catch(() => {});
      const ok = await ready;
      if (gen !== this.gen) return;
      if (!ok) return this.crossfade(id, Math.min(6, mixLen), 1, gainIn);
    }
    if (gen !== this.gen) return;
    this.preloaded = null;
    inn.currentTime = inStart;
    inn.playbackRate = rate * (this.userRate || 1); // calage du tempo, par-dessus la vitesse choisie
    inn.preservesPitch = inn.webkitPreservesPitch = true;
    this._setLevel(inn, 0);
    this._resetFx(inn);
    const iIn = this._idx(inn);
    this.norm[iIn] = gainIn;
    if (T.bassSwap) this._hp(inn, 220);
    await new Promise((r) => setTimeout(r, Math.max(0, delayMs)));
    // Titre suivant / pause demandés pendant l'attente du temps fort : on abandonne ce mix
    if (gen !== this.gen || out.paused) {
      if (gen === this.gen) this.pending = null;
      this._resetFx(inn);
      return;
    }
    this.cur = iIn;
    this.pending = null;
    this.graph?.ctx.resume();
    const startIn = async () => {
      try {
        await inn.play();
      } catch {
        this.h.onPaused();
      }
    };
    const a = Math.min(0.95, Math.max(0, inAt / mixLen));
    if (!a) await startIn();
    else this.pending = { start: inStart }; // affichage : le titre entrant (à son départ) pendant la montée
    T.setup?.(this, out, inn, mixLen, beatOut, a);
    const t0 = performance.now();
    const dur = mixLen * 1000;
    let swapped = false;
    let started = !a;
    this.fade = { out, inn, rate, timer: setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      if (!started && k >= a) {
        started = true;
        this.pending = null;
        startIn();
      }
      const [li, lo] = T.levels(k, a);
      this._setLevel(inn, li);
      this._setLevel(out, lo);
      if (T.bassSwap && !swapped && k >= 0.5) {
        swapped = true;
        this._hp(inn, 10, beatOut);
        this._hp(out, 220, beatOut);
      }
      if (k >= 1) this._endFade();
    }, 30) };
  }  _endFade() {
    if (!this.fade) return;
    const { out, inn, timer, rate } = this.fade;
    clearInterval(timer);
    this.fade = null;
    out.pause();
    out.removeAttribute('src');
    out.load();
    this._resetFx(out);
    this._resetFx(inn);
    if (inn.paused && this.a === inn) inn.play().catch(() => {});
    this._setLevel(out, 1);
    this._setLevel(inn, 1);
    // Tempo ajusté pendant le mix : retour progressif à la vitesse choisie (×1 par défaut, sur ~10 s)
    const base = this.userRate || 1;
    if (rate && rate !== 1) {
      const from = inn.playbackRate;
      const steps = 40;
      let n = 0;
      const t = setInterval(() => {
        n++;
        if (this.a !== inn) return clearInterval(t);
        inn.playbackRate = from + ((base - from) * n) / steps;
        if (n >= steps) clearInterval(t);
      }, 250);
    }
  }
  play(fromLoad = false) {
    this.graph?.ctx.resume();
    const p = this.a.play();
    return fromLoad ? p.catch(() => this.h.onPaused()) : p.catch(() => {});
  }
  pause() { this._endFade(); this.a.pause(); }
  stop() { this._endFade(); this.gen++; this.a.pause(); this.a.removeAttribute('src'); this.a.load(); }
  seek(s) { this._endFade(); this.a.currentTime = s; }
  setVolume(v) { this.base = v; this.els.forEach((_, i) => this._apply(i)); }
  setRate(r) { this.userRate = r; this.a.playbackRate = r; this.a.preservesPitch = this.a.webkitPreservesPitch = true; }
  // Pendant la préparation d'un fondu / mix, on montre déjà le titre entrant (temps de départ, durée du titre)
  time() { return this.pending ? this.pending.start : this.a.currentTime || 0; }
  duration() { return this.pending ? 0 : isFinite(this.a.duration) ? this.a.duration : 0; }
}// ---------- Lecteur ----------
const isBanned = (id) => !!id && setting('banned', []).includes(id);
const shuffleArr = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const player = {
  track: null,
  list: [], // titres du contexte (playlist, album…)
  order: [], // ordre de lecture (indices dans list)
  pos: -1,
  userQueue: [], // « Ajouter à la file d'attente » : joué avant la suite du contexte
  context: null, // { type, id, name }
  shuffle: false,
  repeat: 'off', // off | all | one
  volume: 0.8,
  muted: false,
  rate: 1, // vitesse de lecture
  paused: true,
  buffering: false,
  engine: null,
  engines: {},
  sleep: null, // { at: timestamp } ou { endOfTrack: true }
  remoteSender: null, // défini par sync.js quand on pilote un autre appareil
  jamNext: null, // défini par sync.js quand on héberge une Jam
  jamPeek: null, // idem : prochain titre de la file de la Jam, sans le retirer
  jamFollow: null, // défini par sync.js : vrai quand on écoute la Jam de quelqu'un d'autre en même temps
  _logged: false,
  _played: new Set(), // titres déjà écoutés depuis le lancement de la playlist (pas de répétition en aléatoire)
  _restoreAt: 0,
  _fallbackTried: null,

  init() {
    const handlers = {
      onEnded: () => this._onEnded(),
      onPlaying: () => {
        // iPhone : Boombox prend la main sur le son seulement quand une lecture démarre vraiment
        if (isNative && !this._audioOwned) {
          this._audioOwned = true;
          window.Capacitor?.Plugins?.BoomboxNative?.setAudioMode?.({ mix: false }).catch?.(() => {});
        }
        if (this.rate !== 1) this.engine.setRate(this.rate);
        this._failStreak = 0;
        this._offlineSkips = 0;
        this._prepareAutomix();
        this._prepareNormalize();
        // Audio direct : on prépare le titre suivant pour qu'il démarre sans attendre
        const nextId = this._nextTrack()?.id;
        if (this.engine.name === 'audio' && nextId && nextId !== this._prefetched) {
          this._prefetched = nextId;
          fetch(`/api/prefetch/${nextId}`, { method: 'POST' }).catch(() => {});
        }
        this.paused = false;
        this.buffering = false;
        emit('player:state');
      },
      onPaused: () => {
        if (this._drunkHold) return; // mode bourré (iPhone) : le lecteur normal est mis en silence exprès
        // Téléphone, appli en arrière-plan : iOS met parfois le son en pause sans interruption (ouverture d'une
        // autre appli). Si ce n'est ni une pause voulue ni une vraie interruption, on relance (2 essais max).
        if (isNative && !this._interruptedAt && this.engine?.name === 'audio' && Date.now() - (this._userPauseAt || 0) > 2000 && (this._autoResumes || 0) < 2) {
          this._autoResumes = (this._autoResumes || 0) + 1;
          setTimeout(() => (this._autoResumes = 0), 30e3);
          return void this.engine.play().catch?.(() => ((this.paused = true), emit('player:state')));
        }
        if (Date.now() - (this._userPauseAt || 0) > 2000) this._systemPauseAt = Date.now(); // pause imposée (pas par toi)
        this.paused = true;
        this.buffering = false;
        emit('player:state');
      },
      onBuffering: () => {
        this.buffering = true;
        emit('player:state');
        this._noteStall();
      },
      onError: (code) => this._onError(code),
    };
    this.engines.youtube = new YouTubeEngine(handlers);
    this.engines.audio = new AudioEngine(handlers);
    this.engine = this._preferredEngine();
    const saved = ls.get(`boombox.player.${state.profile.id}`);
    if (saved) {
      Object.assign(this, { list: saved.list || [], order: saved.order || [], pos: saved.pos ?? -1, userQueue: saved.userQueue || [], context: saved.context, shuffle: !!saved.shuffle, repeat: saved.repeat || 'off', volume: saved.volume ?? 0.8, muted: !!saved.muted, rate: saved.rate || 1 });
      this.track = saved.track || null;
      this._restoreAt = saved.position || 0;
      this._played = new Set(this.order.slice(0, this.pos + 1).map((i) => this.list[i]?.id));
    }
    this._applyVolume();
    if (this.track) {
      this.engine.load(this.track.id, this._restoreAt, false);
      this._updateMediaSession();
    }
    setInterval(() => this._tick(), 250);
    // File modifiée (ajout, saut…) : on recalcule l'enchaînement prévu
    bus.addEventListener('player:queue', () => this._mixPlan !== undefined && this._automixOn() && setTimeout(() => this._planNext(), 0));
    this._setupMediaSession();
    window.addEventListener('beforeunload', () => this._persist());
    emit('player:track');
    emit('player:queue');
  },

  _preferredEngine() {
    const pref = setting('engine', 'auto');
    if (isNative) return this.engines.audio; // l'appli lit toujours les fichiers audio
    if (pref === 'audio' && state.status.ytdlp) return this.engines.audio;
    if (pref === 'auto' && state.status.ytdlp) return this.engines.audio;
    return this.engines.youtube;
  },

  setEnginePreference() {
    const next = this._preferredEngine();
    if (next === this.engine) return;
    const t = this.time();
    const wasPlaying = !this.paused;
    this.engine.stop();
    this.engine = next;
    this._applyVolume();
    if (this.track) this.engine.load(this.track.id, t, wasPlaying);
  },

  // ----- Lecture -----
  // Ordre aléatoire de la suite : chaque titre une seule fois (doublons de la playlist retirés), sans ceux déjà
  // écoutés depuis le lancement de la playlist, ni l'index « except » (titre en cours)
  _shuffledRest(except = -1) {
    const seen = new Set(this._played);
    if (except >= 0) seen.add(this.list[except]?.id);
    const idx = [];
    this.list.forEach((t, i) => {
      if (i === except || !t || seen.has(t.id)) return;
      seen.add(t.id);
      idx.push(i);
    });
    return shuffleArr(idx);
  },

  playList(tracks, index = 0, context = null) {
    if (!tracks?.length) return;
    this.list = tracks.slice();
    this.context = context;
    this._played = new Set(); // nouvelle écoute de la playlist : tout redevient jouable
    this.order = this.list.map((_, i) => i);
    if (this.shuffle) {
      this.order = [index, ...this._shuffledRest(index)];
      this.pos = 0;
    } else this.pos = index;
    this._load(this.list[this.order[this.pos]]);
    emit('player:queue');
  },

  playTrack(track, context) {
    this.playList([track], 0, context || { type: 'track', name: track.title });
  },

  async playRadio(track) {
    try {
      toast(`Radio basée sur « ${track.title} »…`);
      const tracks = await api(`/api/radio/${track.id}`);
      const list = [track, ...tracks.filter((t) => t.id !== track.id && !isBanned(t.id))];
      this.playList(list, 0, { type: 'radio', name: `Radio · ${track.title}` });
    } catch (e) {
      toast('Impossible de lancer la radio : ' + e.message);
    }
  },

  addToQueue(tracks) {
    tracks = [].concat(tracks);
    // En party : « Ajouter à la file d'attente » ajoute à la file de la party (celle que tout le monde voit)
    if (this.jamQueue) return this.jamQueue(tracks);
    this.userQueue.push(...tracks.map((t) => ({ ...t, qid: Math.random().toString(36).slice(2) })));
    toast(tracks.length > 1 ? `${tracks.length} titres ajoutés à la file d'attente` : "Ajouté à la file d'attente");
    if (!this.track) this.next();
    emit('player:queue');
    this._persist();
  },

  playNext(tracks) {
    tracks = [].concat(tracks);
    this.userQueue.unshift(...tracks.map((t) => ({ ...t, qid: Math.random().toString(36).slice(2) })));
    toast('Sera lu ensuite');
    if (!this.track) this.next();
    emit('player:queue');
    this._persist();
  },

  removeFromQueue(qid) {
    this.userQueue = this.userQueue.filter((t) => t.qid !== qid);
    emit('player:queue');
  },

  clearQueue() {
    this.userQueue = [];
    emit('player:queue');
  },

  // Saute directement à un titre de la file (n = position dans upcoming())
  jumpTo(n) {
    const up = this.upcoming();
    const target = up[n];
    if (!target) return;
    if (target.qid) {
      const i = this.userQueue.findIndex((t) => t.qid === target.qid);
      const [t] = this.userQueue.splice(i, 1);
      this._load(t);
    } else {
      const uq = this.userQueue.length;
      this.pos = this.pos + 1 + (n - uq);
      this._load(this.list[this.order[this.pos]]);
    }
    emit('player:queue');
  },

  // Réordonne la file : from/to sont des positions dans upcoming() (file perso puis suite du contexte)
  moveUpcoming(from, to) {
    if (from === to) return;
    const uq = this.userQueue.length;
    const takeAt = (i) => (i < uq ? this.userQueue.splice(i, 1)[0] : this.list[this.order.splice(this.pos + 1 + (i - this.userQueue.length), 1)[0]]);
    const item = takeAt(from);
    if (!item) return;
    const uq2 = this.userQueue.length;
    // Déposé dans la zone « file d'attente » (ou juste après) : il y reste / y entre
    if (to < uq2 || (to === uq2 && from < uq)) this.userQueue.splice(to, 0, item.qid ? item : { ...item, qid: Math.random().toString(36).slice(2) });
    else {
      let li = this.list.indexOf(item);
      if (li < 0) li = this.list.push(item) - 1;
      this.order.splice(this.pos + 1 + (to - uq2), 0, li);
    }
    this._preparedFor = this.track?.id; // l'ordre choisi à la main est respecté par l'automix
    emit('player:queue');
    this._persist();
  },

  // Prochain titre réellement joué : celui de la file de la Jam (si on l'héberge) passe avant la suite.
  // Sert au préchargement, à l'automix, au fondu et à l'égalisation du volume.
  _nextTrack() {
    return this.jamPeek?.() || this.upcoming(1)[0];
  },
  // Invité d'une Jam qui écoute en même temps : c'est l'hôte qui décide de l'enchaînement
  _followsJam() {
    return !!this.jamFollow?.();
  },

  upcoming(limit = 80) {
    // Un son retiré ou masqué de la liste laisse une case vide dans l'ordre de lecture : on l'ignore
    const ctx = this.order.slice(this.pos + 1, this.pos + 1 + limit).map((i) => this.list[i]).filter(Boolean);
    return [...this.userQueue.filter(Boolean), ...ctx].slice(0, limit);
  },

  _load(track, { autoplay = true, start = 0, crossfade = 0, mix = null } = {}) {
    if (!track) return;
    this.track = track;
    if (!crossfade && !mix) this._presetNorm(track.id);
    this._played.add(track.id);
    this._xfading = false;
    this._mixPlan = null;
    this._preparedFor = null;
    this._logged = false;
    this._heard = 0; // secondes réellement écoutées de ce son (pour les stats)
    this._heardAt = 0;
    this._heardPos = null;
    this._fallbackTried = null;
    this._retryTried = null;
    this.buffering = true;
    this._loadAt = Date.now();
    this._restoreAt = 0;
    if (this.engine.name === 'audio' && this._preferredEngine().name !== 'audio') this.engine = this._preferredEngine();
    if (mix && mix.id === track.id && this.engine.name === 'audio' && !this.paused) this.engine.mixTo(mix);
    else if ((crossfade || mix) && this.engine.name === 'audio' && !this.paused) this.engine.crossfade(track.id, crossfade || 6, this.rate, this._gainFor(track.id));
    else {
      this.engine.load(track.id, start, autoplay);
      if (this.engine.graph) this.engine.setNorm(this._gainFor(track.id));
    }
    this.paused = !autoplay;
    this._updateMediaSession();
    emit('player:track');
    emit('player:state');
    this._persist();
    document.title = `${track.title} · ${artistNames(track)}`;
  },

  toggle() {
    if (!this.track) return this.next();
    if (this.paused) this.play();
    else this.pause();
  },
  play() {
    if (!this.track) return;
    if (this.engine.name === 'audio' && this._normSetFor !== this.track.id) this._presetNorm(); // relance de l'appli, reprise en cours de son
    this.engine.play();
    this.paused = false;
    emit('player:state');
  },
  pause() {
    this._userPauseAt = Date.now(); // pause voulue (bouton, casque, commande) : jamais relancée toute seule
    this.engine.pause();
    this.paused = true;
    emit('player:state');
    this._persist();
  },

  // crossfade : durée du fondu enchaîné (passage automatique en fin de titre)
  async next(auto = false, crossfade = 0, mix = null) {
    const opts = { crossfade, mix };
    // Invité qui écoute la Jam : en fin de titre on attend le suivant choisi par l'hôte (pas notre propre playlist)
    if (auto && this._followsJam()) return;
    if (this.repeat === 'one' && auto) {
      this.seek(0);
      return this.play();
    }
    const jamTrack = this.jamNext?.();
    if (jamTrack) return this._load(jamTrack, opts);
    if (this.userQueue.length) {
      const t = this.userQueue.shift();
      emit('player:queue');
      return this._load(t, opts);
    }
    // Les titres « Ne plus proposer » sont sautés
    while (this.pos + 1 < this.order.length && isBanned(this.list[this.order[this.pos + 1]]?.id)) this.pos++;
    if (this.pos + 1 < this.order.length) {
      this.pos++;
      emit('player:queue');
      return this._load(this.list[this.order[this.pos]], opts);
    }
    if (this.repeat === 'all' && this.list.length) {
      // Playlist terminée et relancée (répéter tout) : on repart pour un tour complet
      this._played = new Set();
      this.order = this.shuffle ? this._shuffledRest() : this.list.map((_, i) => i);
      this.pos = 0;
      emit('player:queue');
      return this._load(this.list[this.order[0]], opts);
    }
    // Fin du contexte : lecture automatique de titres similaires (comme Spotify)
    if (this.track && setting('autoplay', true)) {
      try {
        const radio = await api(`/api/radio/${this.track.id}`);
        const known = new Set(this.list.map((t) => t.id));
        const fresh = radio.filter((t) => !known.has(t.id) && !isBanned(t.id)).slice(0, 25);
        if (fresh.length) {
          const start = this.list.length;
          this.list.push(...fresh.map((t) => ({ ...t, autoplay: true })));
          this.order.push(...fresh.map((_, i) => start + i));
          this.pos++;
          emit('player:queue');
          return this._load(this.list[this.order[this.pos]], opts);
        }
      } catch {}
    }
    this.pause();
    this.seek(0);
  },

  // Précédent / suivant lancent toujours la lecture (comme Spotify), même depuis la pause
  prev() {
    if (this.time() > 3 || this.pos <= 0) {
      this.seek(0);
      if (this.paused) this.play();
      return;
    }
    this.pos--;
    emit('player:queue');
    this._load(this.list[this.order[this.pos]]);
  },

  seek(sec) {
    this._restoreAt = 0; // la position de reprise (après rechargement) ne compte plus
    this.engine.seek(Math.max(0, sec));
    emit('player:time');
  },

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    this.muted = this.volume === 0;
    this._applyVolume();
    emit('player:state');
  },
  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted && this.volume === 0) this.volume = 0.5;
    this._applyVolume();
    emit('player:state');
  },
  _applyVolume() {
    // Courbe légèrement exponentielle : plus naturelle à l'oreille
    const v = this.muted ? 0 : Math.pow(this.volume, 2.4); // courbe « logarithmique » : la moitié de la barre ≈ moitié du ressenti (avant : le son montait trop vite)
    Object.values(this.engines).forEach((e) => e.setVolume(v));
  },

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const current = this.order[this.pos];
    if (this.shuffle) {
      // La suite mélangée ne reprend ni le titre en cours ni ceux déjà écoutés
      this.order = [...this.order.slice(0, this.pos + 1), ...this._shuffledRest(current ?? -1)];
    } else if (current != null) {
      this.order = this.list.map((_, i) => i);
      this.pos = current;
    }
    emit('player:state');
    emit('player:queue');
    this._persist();
  },

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    emit('player:state');
    this._persist();
  },

  setRate(r) {
    this.rate = r;
    Object.values(this.engines).forEach((e) => e.setRate(r));
    toast(r === 1 ? 'Vitesse normale' : `Vitesse ×${String(r).replace('.', ',')}`);
    emit('player:state');
    this._persist();
  },

  // ----- Automix -----
  setAutomix(on) {
    if (on) {
      if (this.engine.name !== 'audio') return toast('L’automix nécessite la lecture audio directe (yt-dlp)');
      if (!isNative) this.engines.audio.enableGraph(); // téléphone : pas de traitement Web Audio (iOS le coupe en arrière-plan → son muet)
      this._preparedFor = null;
      this._prepareAutomix();
    } else this._mixPlan = null;
  },

  // ----- Normalisation du volume -----
  // Chaque son est ramené au même niveau sonore (d'après son analyse, gardée en cache). Désactivée par défaut sur
  // l'appli mobile : le traitement audio y couperait le son écran verrouillé.
  _normOn() {
    return setting('normalize', true) && this.engine.name === 'audio' && !this.remoteSender;
  },
  _gainFor(id) {
    return this._normOn() || this._automixOn() ? automix.gain(id) : 1;
  },
  // Avant même que le son démarre : niveau égalisé déjà appliqué (sinon le début partait à plein volume,
  // surtout au lancement de l'appli). Son pas encore analysé : il démarre un peu plus bas, puis rejoint son niveau.
  _presetNorm(id = this.track?.id) {
    if (!id || !this._normOn()) return;
    const e = this.engines.audio;
    if (e.fade) return; // pendant un fondu enchaîné, on ne touche pas au son qui part
    if (!e.graph && !isNative) e.enableGraph();
    automix.ensure([id]);
    const g = automix.get(id) ? automix.gain(id) : 0.7;
    this._normSetFor = id;
    clearInterval(e._normTimer);
    e.norm = e.norm.map(() => g);
    e.els.forEach((_, i) => e._apply(i));
  },
  _prepareNormalize() {
    if (!this._normOn() || !this.track) return;
    const e = this.engines.audio;
    // Téléphone : pas de Web Audio (couperait le son écran verrouillé), on joue sur le volume du lecteur
    if (!e.graph && !isNative) e.enableGraph();
    const cur = this.track.id;
    automix.ensure([cur, this._nextTrack()?.id].filter(Boolean));
    // Début du son : niveau appliqué d'un coup ; en cours d'écoute : glissé en douceur
    const early = () => (this.engine.time?.() || 0) < 3;
    if (automix.get(cur)) e.setNorm(automix.gain(cur), !early());
    this._unsubNorm ??= automix.onAnalyzed((id) => id === this.track?.id && this._normOn() && this.engines.audio.setNorm(automix.gain(id), !early()));
  },
  setNormalize(on) {
    if (on) this._prepareNormalize();
    else if (this.engines.audio.graph) this.engines.audio.setNorm(this._automixOn() && this.track ? automix.gain(this.track.id) : 1, true);
  },

  // Prépare l'enchaînement suivant : analyse du titre en cours et des candidats, choix du meilleur
  // titre en lecture aléatoire, puis calcul du plan de transition.
  _prepareAutomix() {
    if (!this._automixOn() || this.engine.name !== 'audio' || !this.track || this.remoteSender) return;
    if (!this.engines.audio.graph && !isNative) this.engines.audio.enableGraph();
    const cur = this.track.id;
    const smart = this._smartMix();
    const window = this.order.slice(this.pos + 1, this.pos + 1 + (smart ? 8 : 1)).map((i) => this.list[i]?.id);
    const ids = [cur, ...[this.jamPeek?.(), this.userQueue[0]].filter(Boolean).map((t) => t.id), ...window];
    automix.ensure(ids, { urgent: true }).then(() => this._planNext());
    if (!this._unsubAnalysis) this._unsubAnalysis = automix.onAnalyzed(() => this._planNext());
  },

  // Playlist en cours de lecture (bibliothèque), et automix actif : réglage global, ou playlist « mixée »
  _ctxPlaylist() {
    return this.context?.type === 'playlist' ? state.library?.playlists?.find((p) => p.id === this.context.id) || null : null;
  },
  // iPhone : une page web ne peut pas régler le volume d'un son (iOS l'ignore) ni filtrer sans couper le son écran
  // verrouillé → les transitions s'y faisaient à plein volume (coupure nette). Là-bas, les sons s'enchaînent
  // simplement, sans chevauchement.
  _automixOn() {
    if (isNative) return false;
    return setting('automix', false) || !!this._ctxPlaylist()?.mixed;
  },
  // Transition voulue entre deux titres : celle choisie dans la playlist mixée, sinon le réglage général
  _styleFor(aId, bId) {
    const pl = this._ctxPlaylist();
    return (pl?.mixed && pl.transitions?.[`${aId}_${bId}`]) || (pl?.mixed ? 'auto' : setting('mixStyle', 'auto'));
  },

  // Mix intelligent : demandé depuis le bouton Mix d'une playlist, en lecture aléatoire, sans file d'attente perso
  _smartMix() {
    return setting('mixSmart', false) && this.shuffle && !this.userQueue.length;
  },

  _planNext() {
    if (!this._automixOn() || !this.track || this._xfading) return;
    const cur = this.track.id;
    // Mix intelligent : parmi les prochains sons (au hasard), on remonte celui qui s'enchaîne le mieux (une fois par titre)
    if (this._smartMix() && this._preparedFor !== cur && automix.get(cur)) {
      const cands = this.order.slice(this.pos + 1, this.pos + 9);
      const best = automix.pickBest(cur, cands.map((i) => this.list[i]?.id));
      const ready = cands.filter((i) => automix.get(this.list[i]?.id)).length;
      if (best > 0 && ready >= Math.min(4, cands.length)) {
        const [x] = this.order.splice(this.pos + 1 + best, 1);
        this.order.splice(this.pos + 1, 0, x);
        emit('player:queue');
      }
      if (ready >= Math.min(4, cands.length)) this._preparedFor = cur;
    }
    const next = this._nextTrack();
    const plan = next && automix.plan(cur, next.id, this._styleFor(cur, next.id));
    this._mixPlan = plan ? { id: next.id, ...plan } : null;
    emit('player:automix', this._mixPlan);
  },

  setSleep(v) {
    if (v == null) this.sleep = null;
    else if (v === 'track') this.sleep = { endOfTrack: true };
    else this.sleep = { at: Date.now() + v * 60e3 };
    toast(v == null ? 'Minuteur désactivé' : v === 'track' ? 'Arrêt à la fin du titre' : `Arrêt dans ${v} min`);
    emit('player:state');
  },

  time() {
    return this.engine?.time() || this._restoreAt || 0;
  },
  duration() {
    return this.engine?.duration() || this.track?.duration || 0;
  },
  // Durée affichée : avec l'automix ou le fondu, le titre « se termine » au moment où la transition démarre
  // (mix prévu à 2:30 → le titre dure 2:30 à l'écran, puis le suivant prend sa place)
  shownDuration() {
    const d = this.duration();
    if (!d || this.repeat === 'one' || this.engine?.name !== 'audio' || this.sleep?.endOfTrack || this.remoteSender) return d;
    const p = this._mixPlan;
    if (p && this._automixOn() && p.mixStart > 0 && p.mixStart < d && this.time() <= p.mixStart + 2) return p.mixStart;
    const xf = this._automixOn() ? (this._styleFor(this.track?.id, this._nextTrack()?.id) !== 'none' ? 6 : 0) : (isNative ? 0 : Number(setting('crossfade', 0)));
    if (xf > 0 && d > xf * 2 + 5) return d - xf;
    return d;
  },

  snapshot() {
    const shown = this.shownDuration();
    return {
      track: this.track,
      position: Math.min(this.time(), shown || Infinity),
      duration: shown,
      paused: this.paused,
      shuffle: this.shuffle,
      repeat: this.repeat,
      volume: this.volume,
      muted: this.muted,
      context: this.context,
      upcoming: this.upcoming(30),
      ts: Date.now(),
    };
  },

  // ----- Interne -----
  _onEnded() {
    if (this.sleep?.endOfTrack) {
      this.sleep = null;
      this.pause();
      return;
    }
    this.next(true);
  },

  _noteStall() {
    if (lowQuality || this.engine?.name !== 'audio' || !this.track || setting('audioQuality', 'auto') === 'high') return;
    const now = Date.now();
    this._stalls = (this._stalls || []).filter((t) => now - t < 60e3);
    if (this.engine.time?.() < 2) return; // démarrage d'un son : chargement normal, pas un blocage
    this._stalls.push(now);
    if (this._stalls.length < 2) return;
    lowQuality = true;
    this._stalls = [];
    toast('Connexion faible : qualité du son réduite pour éviter les coupures');
    const at = this.engine.time() || 0;
    this.engine.load(this.track.id, at, !this.paused, true);
  },

  async _onError(code) {
    const t = this.track;
    if (!t) return;
    // Vidéo non intégrable → on tente l'audio direct si dispo, sinon on passe au suivant
    if (this.engine.name === 'youtube' && state.status.ytdlp && this._fallbackTried !== t.id) {
      this._fallbackTried = t.id;
      this.engine.stop();
      this.engine = this.engines.audio;
      this._applyVolume();
      this.engine.load(t.id, 0, true);
      return;
    }
    // Flux audio coupé ou refusé (lien YouTube expiré, coupure réseau) : un nouvel essai avec un lien neuf,
    // repris au même endroit, avant d'abandonner le titre
    if (this.engine.name === 'audio' && this._retryTried !== t.id) {
      this._retryTried = t.id;
      // Appli : fichier du cache refusé par le lecteur (format illisible, fichier abîmé) → supprimé, il sera retéléchargé
      if (isNative && /^lecteur/.test(code)) await (await localApi()).media.deleteAudio(t.id).catch(() => {});
      const at = this.engine.time() || 0;
      this.buffering = true;
      emit('player:state');
      this.engine.load(t.id, at > 1 ? at : 0, true, true);
      return;
    }
    // Hors connexion, son pas téléchargé : on le dit clairement et on passe au suivant (sans compter un échec)
    if (isNative && /non téléchargé|Hors ligne/i.test(String(code))) {
      this._offlineSkips = (this._offlineSkips || 0) + 1;
      if (this._offlineSkips > Math.min(40, this.list.length || 1)) {
        this._offlineSkips = 0;
        this.pause();
        return toast('Hors connexion : aucun son téléchargé dans cette liste. Reconnecte-toi pour les télécharger.', { timeout: 8000 });
      }
      if (this._offlineSkips === 1) toast(`Hors connexion : « ${t.title} » n’est pas téléchargé, je passe aux sons téléchargés`, { timeout: 5000 });
      return void setTimeout(() => this.next(), 150);
    }
    // Invité qui écoute la Jam : on ne part pas sur sa propre playlist, la Jam continue chez l'hôte
    if (this._followsJam()) return toast(`« ${t.title} » ne peut pas être lu sur cet appareil (${code}).`);
    // Plusieurs échecs d'affilée : le problème vient de la source (serveur arrêté, plus d'Internet), pas des titres.
    // On s'arrête au lieu de sauter toute la playlist.
    this._failStreak = (this._failStreak || 0) + 1;
    if (this._failStreak >= 3) {
      this._failStreak = 0;
      this.pause();
      const down = !isNative && (await fetch('/api/status', { cache: 'no-store' }).then((r) => !r.ok).catch(() => true));
      toast(down ? 'Lecture arrêtée : le serveur Boombox du PC ne répond pas. Relance Boombox puis appuie sur lecture.' : 'Lecture arrêtée : plusieurs titres d’affilée n’ont pas pu être lus (connexion ?).', { timeout: 8000 });
      return;
    }
    toast(`« ${t.title} » ne peut pas être lu (${code}). Titre suivant…`);
    import('./errors.js').then((m) => m.reportError(`Lecture impossible : ${code}`, `player:${this.engine?.name || '?'}`, `${t.id} · ${t.title}`)).catch(() => {});
    setTimeout(() => this.next(), 800);
  },

  _tick() {
    if (!this.track) return;
    // Automix : préchargement puis départ du mix, calé sur un temps fort du titre en cours
    const plan = this._mixPlan;
    const ownTransitions = !this._followsJam(); // invité d'une Jam : pas de mix / fondu local, l'hôte enchaîne
    if (plan && ownTransitions && this.engine.name === 'audio' && !this.paused && !this._xfading && this.repeat !== 'one' && !this.sleep?.endOfTrack && !this.remoteSender) {
      const t = this.time();
      if (t >= plan.mixStart - 25) this.engine.preload(plan.id, plan.inStart);
      if (t >= plan.mixStart - 0.4 && t < plan.mixStart + 2) {
        this._xfading = true;
        const delayMs = ((plan.mixStart - t) / (this.rate || 1)) * 1000;
        this.next(true, 0, { ...plan, delayMs });
      }
    }
    // Fondu enchaîné : on lance le titre suivant quelques secondes avant la fin
    // (avec l'automix, fondu de secours de 6 s si les analyses ne sont pas prêtes)
    // (et aussi si le moment du mix est passé, par exemple après avoir avancé dans le titre)
    // Avec l'automix, le réglage « fondu enchaîné » est ignoré : c'est le mix qui gère la transition.
    // Fondu de secours (6 s) seulement si l'analyse n'est pas prête ou si le moment du mix est passé ; rien si « Aucune transition ».
    const missed = plan && this.time() > plan.mixStart + 2;
    const automixOn = this._automixOn();
    const xf = automixOn ? ((!plan || missed) && this._styleFor(this.track?.id, this._nextTrack()?.id) !== 'none' ? 6 : 0) : (isNative ? 0 : Number(setting('crossfade', 0)));
    if (xf > 0 && ownTransitions && this.engine.name === 'audio' && !this.paused && !this._xfading && this.repeat !== 'one' && !this.sleep?.endOfTrack && !this.remoteSender) {
      const d = this.duration();
      if (d > xf * 2 + 5 && d - this.time() <= xf + 0.5) {
        this._xfading = true;
        this.next(true, xf);
      }
    }
    // Le navigateur a bloqué la lecture automatique (pas encore d'interaction) : on repasse en pause
    if (!this.paused && this.buffering && this._loadAt && Date.now() - this._loadAt > (isNative ? 30000 : 7000) && this.engine.time() < 0.5) {
      this._loadAt = 0;
      this.paused = true;
      this.buffering = false;
      emit('player:state');
      toast('Appuie sur lecture pour démarrer');
    }
    if (!this.paused) emit('player:time');
    const t = this.time();
    // Stats : un son compte comme écouté après 30 s d'écoute réelle (moitié du son s'il dure moins d'une minute),
    // sans compter les pauses, les chargements, ni l'avance rapide ou un mix qui le démarre en plein milieu
    const now = performance.now();
    const dp = t - (this._heardPos ?? t);
    if (!this.paused && dp > 0 && dp < Math.max(5, ((now - (this._heardAt || now)) / 1000) * 2 + 2)) this._heard += dp / (this.rate || 1);
    this._heardPos = t;
    this._heardAt = now;
    const d = this.duration();
    if (!this._logged && this._heard >= (d && d < 60 ? d / 2 : 30)) {
      this._logged = true;
      addHistory(this.track);
    }
    if (this.sleep?.at && Date.now() >= this.sleep.at) {
      this.sleep = null;
      this.pause();
      toast('Minuteur de sommeil : lecture arrêtée');
    }
    if ('mediaSession' in navigator && this.duration() && !this.paused) {
      try {
        const shown = this.shownDuration();
        navigator.mediaSession.setPositionState({ duration: shown, position: Math.min(t, shown), playbackRate: 1 });
      } catch {}
    }
    if (++this._n % 20 === 0) this._persist();
  },
  _n: 0,

  _persist() {
    if (!state.profile) return;
    ls.set(`boombox.player.${state.profile.id}`, {
      list: this.list.slice(0, 500),
      order: this.order.slice(0, 500),
      pos: this.pos,
      userQueue: this.userQueue,
      context: this.context,
      shuffle: this.shuffle,
      repeat: this.repeat,
      volume: this.volume,
      muted: this.muted,
      rate: this.rate,
      track: this.track,
      position: this.engine ? this.time() : 0,
    });
  },

  _updateMediaSession() {
    this._androidMedia();
    if (!('mediaSession' in navigator) || !this.track) return;
    const t = this.track;
    // iPhone : les boutons de la notification sont oubliés quand l'élément audio change (fondu, titre suivant) :
    // on les remet à chaque titre, sinon il réaffiche « ±10 s »
    this._setupMediaSession();
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: artistNames(t),
      album: t.album?.name || '',
      artwork: t.thumb ? [{ src: t.thumb, sizes: '544x544', type: 'image/jpeg' }] : [],
    });
  },

  // Android : notification de lecture native (la WebView n'en affiche pas), avec précédent / suivant
  _androidMedia() {
    const P = window.Capacitor?.getPlatform?.() === 'android' && window.Capacitor.Plugins?.BoomboxNative;
    if (!P?.mediaUpdate) return;
    if (!this._androidMediaReady) {
      this._androidMediaReady = true;
      P.addListener('mediaAction', (e) => {
        if (e.action === 'next') ctl.next();
        else if (e.action === 'prev') ctl.prev();
        else if (e.action === 'play') ctl.play();
        else if (e.action === 'pause') ctl.pause();
        else if (e.action === 'seek') ctl.seek(e.time);
      });
      // Lecture / pause : la notification suit (au plus une mise à jour par 300 ms)
      let tm = null;
      bus.addEventListener('player:state', () => (clearTimeout(tm), (tm = setTimeout(() => this._androidMedia(), 300))));
    }
    const t = this.track;
    if (!t) return P.mediaStop?.().catch(() => {});
    P.mediaUpdate({ title: t.title || '', artist: artistNames(t), artwork: t.thumb || null, playing: !this.paused, position: this.time() || 0, duration: this.shownDuration?.() || this.duration() || 0 }).catch(() => {});
  },

  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    // Indique à iOS / Android si ça joue : sans ça, la notification affichait parfois « pause » pendant la lecture
    if (!this._msState) {
      this._msState = true;
      const upd = () => {
        try {
          navigator.mediaSession.playbackState = !this.track ? 'none' : this.paused ? 'paused' : 'playing';
        } catch {}
      };
      bus.addEventListener('player:state', upd);
      bus.addEventListener('player:track', upd);
      setInterval(upd, 5000);
    }
    const ms = navigator.mediaSession;
    const set = (a, f) => {
      try {
        ms.setActionHandler(a, f);
      } catch {}
    };
    set('play', () => ctl.play());
    set('pause', () => ctl.pause());
    set('previoustrack', () => ctl.prev());
    set('nexttrack', () => ctl.next());
    set('seekto', (d) => ctl.seek(d.seekTime));
    // Sans ça, l'iPhone (et certains Android) affichent « ±10 s » au lieu de précédent / suivant dans la notification
    set('seekbackward', null);
    set('seekforward', null);
  },
};

// ---------- Contrôleur : local, ou télécommande d'un autre appareil ----------
const ACTIONS = ['toggle', 'play', 'pause', 'next', 'prev', 'seek', 'setVolume', 'toggleMute', 'toggleShuffle', 'cycleRepeat', 'playList', 'playTrack', 'addToQueue', 'playNext', 'jumpTo', 'removeFromQueue', 'clearQueue', 'playRadio'];
export const ctl = {};
for (const a of ACTIONS) {
  ctl[a] = (...args) => {
    if (player.remoteSender) return player.remoteSender(a, args);
    return player[a](...args);
  };
}

// Premier son quand on lance une liste entière : au hasard si l'aléatoire est activé (pas toujours le premier)
export const startAt = (list) => (player.shuffle && list?.length ? Math.floor(Math.random() * list.length) : 0);

// iPhone : interruptions (vocal, appel, vidéo d'une autre appli). À la fin, reprise si iOS l'indique ou si
// l'interruption a été courte (un vocal) ; retour sur l'appli : on relance un son coupé « en silence ».
(function handleInterruptions() {
  const P = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.BoomboxNative;
  if (!P?.addListener) return;
  let wasPlaying = false;
  // Relance de la sortie audio : pause puis lecture, sans que l'interface voie une pause
  const kick = () => {
    const el = player.engine?.name === 'audio' ? player.engine.a : null;
    if (!el || player.paused || !player.track) return;
    if (!el.paused) return; // il joue déjà : on n'y touche pas
    el.play().catch(() => {});
  };
  P.addListener('audioInterruption', ({ phase, resume }) => {
    if (phase === 'began') {
      // Jouait juste avant (iOS peut avoir déjà mis le son en pause un instant avant de prévenir)
      wasPlaying = (!player.paused || Date.now() - (player._systemPauseAt || 0) < 2500) && Date.now() - (player._userPauseAt || 0) > 1000;
      player._interruptedAt = Date.now();
      return;
    }
    const short = Date.now() - (player._interruptedAt || 0) < 90e3;
    player._interruptedAt = 0;
    if (wasPlaying && (resume || short)) setTimeout(() => (player.paused ? player.play() : kick()), 400);
    wasPlaying = false;
  });
  P.addListener('audioActive', () => setTimeout(() => {
    // Pause imposée par iOS il y a moins de 10 min (et pas par toi depuis) : on relance
    const sys = player._systemPauseAt || 0;
    if (player.paused && player.track && Date.now() - sys < 600e3 && sys > (player._userPauseAt || 0)) {
      player._systemPauseAt = 0;
      return player.play();
    }
    kick();
  }, 300));
})();

// Casque ou enceinte Bluetooth déconnecté → pause (comme Spotify), au lieu de continuer dans le haut-parleur
(function pauseOnUnplug() {
  const pause = () => {
    if (!player.paused && !player.remoteSender) {
      player.pause();
      toast('Appareil audio déconnecté : lecture en pause');
    }
  };
  const P = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.BoomboxNative;
  if (P?.addListener) {
    P.addListener('audioUnplugged', pause);
    return;
  }
  // PC / navigateur : une sortie audio (casque, enceinte) disparaît de la liste
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices || !md.addEventListener) return;
  const outputs = async () => (await md.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'audiooutput').map((d) => d.deviceId + d.label);
  let known = null;
  outputs().then((o) => (known = o));
  md.addEventListener('devicechange', async () => {
    const now = await outputs();
    if (known && now.length < known.length) pause();
    known = now;
  });
})();
