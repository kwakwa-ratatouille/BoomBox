// Mode bourré (caché) : le son n'est jamais constant — accélérés, ralentis, montées et descentes de vitesse (la
// hauteur suit, comme un disque) — et l'appli tangue avec. Plus de filtres ni d'écho : ça sonnait comme un son cassé.
// Mode chipmunk (caché aussi, « chipmunk » tapé dans la recherche) : voix toutes aiguës, à la même vitesse. Effets légers pour ne pas faire ramer :
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
let ev = null; // effet en cours : { kind, at, until, to }
let mode = 'drunk'; // ou 'chipmunk'
let rate = 1; // vitesse actuelle (glisse vers la vitesse voulue : jamais de saut brusque)
let shifter = null;

// ---------- Décalage de hauteur sans changer la vitesse ----------
// Le son est relu un peu plus vite par petits morceaux de 70 ms qui se chevauchent en fondu : plus aigu, sans prendre
// d'avance. Calculé échantillon par échantillon dans un « worklet » audio : avec des lignes de retard modulées
// (première version), Safari sur iPhone ne bougeait le retard que par blocs, d'où une voix robotisée et trop grave.
const WORKLET = `registerProcessor('bbx-pitch', class extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.r = o.processorOptions.ratio;
    this.W = Math.round(sampleRate * 0.07);
    this.N = this.W * 4;
    this.b = [new Float32Array(this.N), new Float32Array(this.N)];
    this.w = 0;
    this.p = 0;
  }
  // Version allégée (le son saccadait) : pas de modulo ni de fonctions par échantillon, mono si l'entrée l'est
  process(ins, outs) {
    const inp = ins[0];
    const out = outs[0];
    const n = out[0].length;
    const W = this.W;
    const N = this.N;
    const step = (this.r - 1) / W;
    const L = inp && inp.length ? inp[0] : null;
    const R = inp && inp.length > 1 ? inp[1] : L;
    const bl = this.b[0];
    const br = this.b[1];
    const oL = out[0];
    const oR = out[1] || out[0];
    let w = this.w;
    let p = this.p;
    for (let k = 0; k < n; k++) {
      bl[w] = L ? L[k] : 0;
      br[w] = R ? R[k] : 0;
      const p2 = p < 0.5 ? p + 0.5 : p - 0.5;
      const s1 = Math.sin(3.141592653589793 * p);
      const g1 = s1 * s1;
      let x1 = w - ((1 - p) * W + 2);
      let x2 = w - ((1 - p2) * W + 2);
      if (x1 < 0) x1 += N;
      if (x2 < 0) x2 += N;
      const i1 = x1 | 0;
      const f1 = x1 - i1;
      const j1 = i1 + 1 === N ? 0 : i1 + 1;
      const i2 = x2 | 0;
      const f2 = x2 - i2;
      const j2 = i2 + 1 === N ? 0 : i2 + 1;
      oL[k] = g1 * (bl[i1] + (bl[j1] - bl[i1]) * f1) + (1 - g1) * (bl[i2] + (bl[j2] - bl[i2]) * f2);
      if (oR !== oL) oR[k] = g1 * (br[i1] + (br[j1] - br[i1]) * f1) + (1 - g1) * (br[i2] + (br[j2] - br[i2]) * f2);
      w = w + 1 === N ? 0 : w + 1;
      p += step;
      if (p >= 1) p -= 1;
    }
    this.w = w;
    this.p = p;
    return true;
  }
});`;
const loaded = new WeakMap();
// ratio : 1.6 ≈ 8 demi-tons plus haut. input / output à brancher tout de suite ; l'effet s'insère dès qu'il est prêt
export function makeShifter(ctx, ratio = 1.6) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  input.connect(output); // le temps que l'effet se charge (quelques millisecondes)
  let node = null;
  let stopped = false;
  if (!loaded.has(ctx)) loaded.set(ctx, ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))));
  loaded.get(ctx).then(() => {
    if (stopped) return;
    node = new AudioWorkletNode(ctx, 'bbx-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { ratio } });
    input.disconnect();
    input.connect(node).connect(output);
  }).catch(() => {});
  return { input, output, stop: () => { stopped = true; node?.disconnect(); } };
}
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Moteur PC : lecteur existant ----------
const audio = () => player.engines?.audio;
const pcFx = {
  // Voix aiguës : le décalage de hauteur est glissé entre le volume et la sortie de chaque lecteur
  chipmunk(onOff) {
    const a = audio();
    if (!a) return;
    if (onOff) a.enableGraph?.();
    const g = a.graph;
    if (!g) return;
    if (onOff && !shifter) {
      shifter = makeShifter(g.ctx);
      shifter.output.connect(g.ctx.destination);
    }
    for (const n of g.nodes) {
      n.gain.disconnect();
      n.gain.connect(onOff ? shifter.input : g.ctx.destination);
      n.gain.connect(n.send);
    }
    if (!onOff && shifter) {
      shifter.stop();
      shifter.output.disconnect();
      shifter = null;
    }
  },
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
    if (mode === 'chipmunk') {
      shifter = makeShifter(ctx);
      hp.connect(lp).connect(gain).connect(shifter.input);
      shifter.output.connect(ctx.destination);
    } else hp.connect(lp).connect(gain).connect(ctx.destination);
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

// Un nouvel effet de vitesse au hasard toutes les 2,5 à 5 s ; la vitesse glisse toujours vers la nouvelle valeur
const ev0 = (kind, ms, to) => (ev = { kind, at: Date.now(), until: Date.now() + ms, to });
const EFFECTS = [
  () => ev0('slow', rnd(2200, 3800), rnd(0.68, 0.8)), // ralenti (« slowed »)
  () => ev0('fast', rnd(1800, 3200), rnd(1.25, 1.42)), // accéléré (« sped up »)
  () => ev0('rampUp', rnd(3000, 4500), rnd(1.4, 1.6)), // ça accélère de plus en plus
  () => ev0('rampDown', rnd(2500, 4000), rnd(0.58, 0.7)), // le disque ralentit de plus en plus
  () => ev0('wave', rnd(2500, 4000), 0.2), // vitesse qui fait des vagues
  () => ev0('normal', rnd(1200, 2200), 1), // un peu de répit
];

function frame() {
  if (!on || mode !== 'drunk') return;
  wobble += 0.09;
  let target = 1 + Math.sin(wobble) * 0.04; // léger tangage permanent
  if (ev && Date.now() < ev.until) {
    const k = (Date.now() - ev.at) / (ev.until - ev.at);
    if (ev.kind === 'slow' || ev.kind === 'fast' || ev.kind === 'normal') target *= ev.to;
    if (ev.kind === 'rampUp' || ev.kind === 'rampDown') target *= 1 + (ev.to - 1) * k;
    if (ev.kind === 'wave') target *= 1 + Math.sin(wobble * 3.2) * ev.to;
  } else if (ev) ev = null;
  rate += (target - rate) * 0.25; // glisse, sans à-coup
  fx().setRate(rate);
  setTimeout(frame, 90);
}
function nextEvent() {
  if (!on || mode !== 'drunk') return;
  if (!player.paused) EFFECTS[Math.floor(Math.random() * EFFECTS.length)]();
  events = setTimeout(nextEvent, rnd(2500, 5000));
  // L'appli a le hoquet de temps en temps
  if (Math.random() < 0.25) {
    document.documentElement.classList.add('drunk-hic');
    setTimeout(() => document.documentElement.classList.remove('drunk-hic'), 420);
  }
}

export function startDrunk(m = 'drunk') {
  if (on) return;
  mode = m;
  rate = 1;
  if (NATIVE) {
    if (!player.track) return toast('Lance un son avant 🍺');
    // Créé pendant l'appui (sinon iOS bloque le son)
    solo.ctx = new (window.AudioContext || window.webkitAudioContext)();
    solo.graph();
  }
  on = true;
  const chip = mode === 'chipmunk';
  if (!chip) document.documentElement.classList.add('drunk', ...(NATIVE ? ['drunk-lite'] : []));
  pill = document.createElement('button');
  pill.className = 'drunk-pill' + (chip ? ' chip' : '');
  pill.textContent = chip ? '🐿️ Mode chipmunk · toucher pour arrêter' : '🍺 Mode bourré · toucher pour arrêter';
  pill.onclick = () => stopDrunk();
  document.body.appendChild(pill);
  if (!chip) {
    const veil = document.createElement('div');
    veil.className = NATIVE ? 'drunk-veil lite' : 'drunk-veil';
    document.body.appendChild(veil);
  }
  toast(chip ? '🐿️ Mode chipmunk : tout le monde chante tout aigu' : '🍺 Santé ! Mode bourré activé');
  if (chip && !NATIVE) pcFx.chipmunk(true);
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

export function stopDrunk(message = mode === 'chipmunk' ? 'Mode chipmunk terminé : voix normales' : 'Mode bourré terminé, bois de l’eau 💧') {
  if (!on) return;
  on = false;
  if (mode === 'chipmunk') {
    if (!NATIVE) pcFx.chipmunk(false);
    else shifter?.stop();
    shifter = null;
  }
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
  // « chipmunk » (ou « alvin ») tapé dans la recherche : voix aiguës ; le retaper arrête
  document.addEventListener('input', (e) => {
    if (e.target?.id !== 'search-input') return;
    const v = e.target.value.trim().toLowerCase();
    if (v !== 'chipmunk' && v !== 'alvin') return;
    e.target.value = '';
    if (on) return stopDrunk();
    if (!player.track) return toast('Lance un son avant 🐿️');
    startDrunk('chipmunk');
  });
}
