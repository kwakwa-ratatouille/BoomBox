// Mode bourré (caché) : le son n'est jamais constant — vitesse et hauteur qui tanguent, filtres qui balayent,
// écho qui part en vrille — et l'appli tangue avec. Effets légers pour ne pas faire ramer :
// transformations CSS (carte graphique) et une couche de couleur, pas de flou sur toute la page.
// Activation : 5 appuis rapides sur le logo (PC) ou sur la pochette du lecteur plein écran (téléphone).
//
// PC : effets directement sur le lecteur (vitesse de l'élément audio + traitement audio du lecteur).
// iPhone : changer la vitesse du lecteur y coupe le son (pause puis reprise à chaque effet). Pendant le mode, le son
// est donc joué par un moteur audio séparé (fichier du téléphone décodé) où tout change en fondu, sans coupure ;
// en sortant, le lecteur normal reprend au bon endroit. Ce moteur ne tourne qu'appli à l'écran : verrouiller
// arrête le mode.
import { player } from './player.js';
import { bus } from './state.js';
import { toast } from './ui.js';
import { localApi } from './native.js';

let on = false;
let wobble = 0;
let events = 0;
let pill = null;
let ev = null; // effet en cours : { kind, until }
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Moteur PC : lecteur existant ----------
const audio = () => player.engines?.audio;
const pcFx = {
  setRate(r) {
    for (const el of audio()?.els || []) {
      el.preservesPitch = el.webkitPreservesPitch = el.mozPreservesPitch = false; // la hauteur suit la vitesse
      el.playbackRate = Math.max(0.5, Math.min(1.9, r));
    }
  },
  setFx({ lp = 20000, hp = 20, echo = 0 } = {}) {
    const ctx = audio()?.graph?.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const n of audio().graph.nodes) {
      n.lp.frequency.setTargetAtTime(lp, t, 0.12);
      n.hp.frequency.setTargetAtTime(hp, t, 0.12);
      n.send.gain.setTargetAtTime(echo, t, 0.1);
      n.fb.gain.setTargetAtTime(echo ? 0.62 : 0.45, t, 0.1);
    }
  },
};

// ---------- Moteur iPhone : son décodé, joué en Web Audio (vitesse et effets en fondu) ----------
const solo = {
  ctx: null, src: null, nodes: null, buf: null, trackId: null,
  pos: 0, rate: 1, lastT: 0, playing: false,
  graph() {
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 20;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    const gain = ctx.createGain();
    const send = ctx.createGain();
    send.gain.value = 0;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    hp.connect(lp).connect(gain).connect(ctx.destination);
    gain.connect(send).connect(delay).connect(ctx.destination);
    delay.connect(fb).connect(delay);
    this.nodes = { hp, lp, gain, send, fb };
  },
  async load(track, at) {
    this.trackId = track.id;
    const data = await (await localApi()).media.audioBuffer(track.id);
    if (!on || this.trackId !== track.id) return;
    this.buf = await this.ctx.decodeAudioData(data);
    if (!on || this.trackId !== track.id) return;
    this.pos = Math.max(0, Math.min(at, this.buf.duration - 0.5));
    if (!player.paused) this.start();
  },
  start() {
    if (!this.buf || !on) return;
    this.stopSrc();
    this.ctx.resume?.().catch(() => {});
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf;
    src.playbackRate.value = this.rate;
    src.connect(this.nodes.hp);
    src.onended = () => {
      if (this.src !== src || !on || !this.playing) return;
      this.tick();
      if (this.pos >= this.buf.duration - 1) {
        // Fin du son : le lecteur passe au suivant, le mode continue dessus
        this.playing = false;
        player.next(true);
      }
    };
    src.start(0, Math.max(0, this.pos));
    this.src = src;
    this.lastT = this.ctx.currentTime;
    this.playing = true;
    holdPlayer();
  },
  stopSrc() {
    if (!this.src) return;
    this.tick();
    try {
      this.src.onended = null;
      this.src.stop();
    } catch {}
    this.src = null;
  },
  // Position dans le son (la vitesse varie : on additionne temps écoulé × vitesse)
  tick() {
    if (!this.src || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.pos += (now - this.lastT) * this.rate;
    this.lastT = now;
  },
  setRate(r) {
    this.tick();
    this.rate = Math.max(0.55, Math.min(1.7, r));
    if (this.src) this.src.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.06); // en fondu
  },
  setFx({ lp = 20000, hp = 20, echo = 0 } = {}) {
    if (!this.nodes) return;
    const t = this.ctx.currentTime;
    this.nodes.lp.frequency.setTargetAtTime(lp, t, 0.12);
    this.nodes.hp.frequency.setTargetAtTime(hp, t, 0.12);
    this.nodes.send.gain.setTargetAtTime(echo, t, 0.1);
    this.nodes.fb.gain.setTargetAtTime(echo ? 0.62 : 0.45, t, 0.1);
  },
};
// Le lecteur normal se tait pendant que le moteur iPhone joue (sans que l'interface passe en pause)
function holdPlayer() {
  player._drunkHold = true;
  const el = audio()?.a;
  if (el && !el.paused) el.pause();
}
const fx = () => (NATIVE ? solo : pcFx);

// Pause / lecture / nouveau son pendant le mode (iPhone)
function onPlayerState() {
  if (!on || !NATIVE) return;
  if (player.paused) {
    if (solo.playing) {
      solo.stopSrc();
      solo.playing = false;
    }
  } else if (!solo.playing && solo.buf && solo.trackId === player.track?.id) solo.start();
  else holdPlayer();
}
function onPlayerTrack() {
  if (!on || !NATIVE || !player.track || player.track.id === solo.trackId) return;
  solo.stopSrc();
  solo.playing = false;
  solo.buf = null;
  holdPlayer();
  solo.load(player.track, 0).catch(() => stopDrunk('Ce son n’est pas sur le téléphone : mode bourré arrêté'));
}
function onHidden() {
  if (on && NATIVE && document.hidden) stopDrunk(); // verrouillage : la musique normale reprend
}

// Un nouvel effet au hasard toutes les 1,8 à 4,2 s
const EFFECTS = [
  () => (ev = { kind: 'slow', until: Date.now() + rnd(1400, 2600) }),
  () => (ev = { kind: 'fast', until: Date.now() + rnd(1000, 2000) }),
  () => (fx().setFx({ lp: rnd(300, 900) }), (ev = { kind: 'muffled', until: Date.now() + rnd(1500, 3000) })),
  () => (fx().setFx({ hp: rnd(900, 1800), lp: rnd(2500, 4000) }), (ev = { kind: 'phone', until: Date.now() + rnd(1400, 2600) })),
  () => (fx().setFx({ echo: 0.7 }), (ev = { kind: 'echo', until: Date.now() + rnd(1800, 3200) })),
  () => (ev = { kind: 'wave', until: Date.now() + rnd(1500, 2500) }),
  () => (ev = { kind: 'drop', until: Date.now() + 900 }),
];

function frame() {
  if (!on) return;
  wobble += 0.11;
  let r = 1 + Math.sin(wobble) * 0.06 + Math.sin(wobble * 2.7) * 0.03; // tangage permanent
  if (ev && Date.now() < ev.until) {
    if (ev.kind === 'slow') r *= 0.72;
    if (ev.kind === 'fast') r *= 1.32;
    if (ev.kind === 'wave') r *= 1 + Math.sin(wobble * 3) * 0.22;
    if (ev.kind === 'drop') r *= Math.max(0.55, 1 - (1 - (ev.until - Date.now()) / 900) * 0.45); // disque qui ralentit
  } else if (ev) {
    ev = null;
    fx().setFx();
  }
  fx().setRate(r);
  setTimeout(frame, 90);
}
function nextEvent() {
  if (!on) return;
  if (!player.paused) EFFECTS[Math.floor(Math.random() * EFFECTS.length)]();
  events = setTimeout(nextEvent, rnd(1800, 4200));
  // L'appli a le hoquet de temps en temps
  if (Math.random() < 0.25) {
    document.documentElement.classList.add('drunk-hic');
    setTimeout(() => document.documentElement.classList.remove('drunk-hic'), 420);
  }
}

export function startDrunk() {
  if (on) return;
  if (NATIVE) {
    if (!player.track) return toast('Lance un son avant 🍺');
    // Créé pendant l'appui (sinon iOS bloque le son)
    solo.ctx = new (window.AudioContext || window.webkitAudioContext)();
    solo.graph();
  }
  on = true;
  document.documentElement.classList.add('drunk', ...(NATIVE ? ['drunk-lite'] : []));
  pill = document.createElement('button');
  pill.className = 'drunk-pill';
  pill.textContent = '🍺 Mode bourré · toucher pour arrêter';
  pill.onclick = () => stopDrunk();
  document.body.appendChild(pill);
  const veil = document.createElement('div');
  veil.className = NATIVE ? 'drunk-veil lite' : 'drunk-veil';
  document.body.appendChild(veil);
  toast('🍺 Santé ! Mode bourré activé');
  if (NATIVE) {
    bus.addEventListener('player:state', onPlayerState);
    bus.addEventListener('player:track', onPlayerTrack);
    document.addEventListener('visibilitychange', onHidden);
    const at = player.time() || 0;
    holdPlayer();
    solo.load(player.track, at).catch(() => stopDrunk('Ce son n’est pas sur le téléphone : mode bourré arrêté'));
  }
  frame();
  nextEvent();
}

export function stopDrunk(message = 'Mode bourré terminé, bois de l’eau 💧') {
  if (!on) return;
  on = false;
  clearTimeout(events);
  ev = null;
  if (NATIVE) {
    bus.removeEventListener('player:state', onPlayerState);
    bus.removeEventListener('player:track', onPlayerTrack);
    document.removeEventListener('visibilitychange', onHidden);
    // Le lecteur normal reprend là où le mode en était
    solo.tick();
    const resumeAt = solo.buf && solo.trackId === player.track?.id ? solo.pos : null;
    solo.stopSrc();
    solo.ctx?.close().catch(() => {});
    Object.assign(solo, { ctx: null, src: null, nodes: null, buf: null, trackId: null, playing: false, rate: 1 });
    player._drunkHold = false;
    if (resumeAt != null) player.seek?.(resumeAt);
    if (!player.paused) player.play();
  } else {
    pcFx.setFx();
    for (const el of audio()?.els || []) {
      el.playbackRate = player.rate || 1;
      el.preservesPitch = el.webkitPreservesPitch = el.mozPreservesPitch = true;
    }
    audio()?.els?.forEach((_, i) => audio()._apply?.(i)); // volume normal
  }
  document.documentElement.classList.remove('drunk', 'drunk-lite', 'drunk-hic');
  pill?.remove();
  document.querySelector('.drunk-veil')?.remove();
  toast(message);
}

// 5 appuis en moins de 2,5 s sur le logo ou la pochette du lecteur plein écran
export function setupDrunkTrigger() {
  let taps = [];
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.brand-link, .brand-logo, #fullplayer .fp-art')) return;
    const now = Date.now();
    taps = taps.filter((t) => now - t < 2500);
    taps.push(now);
    if (taps.length >= 5) {
      taps = [];
      on ? stopDrunk() : startDrunk();
    }
  }, true);
}
