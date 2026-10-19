// Automix : enchaînements façon DJ.
// 1. Chaque titre est analysé (tempo, battements, tonalité, volume, intro/outro) puis mis en cache sur le PC.
// 2. En lecture aléatoire, le titre suivant est choisi parmi plusieurs candidats pour bien s'enchaîner
//    (tonalités compatibles selon la roue de Camelot, tempo proche, énergie qui ne s'effondre pas).
// 3. La transition démarre sur un temps fort, le tempo du titre entrant est ajusté (±8 %),
//    les basses sont échangées à mi-parcours et les volumes sont égalisés.
import { api } from './state.js';
import { isNative, localApi } from './native.js';

const mem = new Map(); // id -> analyse
const pending = new Map(); // id -> Promise
let worker = null;
let seq = 0;
const waiting = new Map();
let queue = [];
let running = false;
const listeners = new Set();
const failed = new Map(); // id -> date du dernier échec (nouvel essai après 1 min)

function getWorker() {
  if (!worker) {
    worker = new Worker('/js/analyzer-worker.js');
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.result);
    };
  }
  return worker;
}

// Charge l'audio, le convertit en mono 22 050 Hz et l'envoie au worker d'analyse
async function analyzeNow(id) {
  const buf = isNative
    ? await (await localApi()).media.audioBuffer(id)
    : await fetch(`/api/audio-file/${id}`).then((r) => {
        if (!r.ok) throw new Error('audio indisponible');
        return r.arrayBuffer();
      });
  const sr = 22050;
  const ctx = new OfflineAudioContext(1, sr, sr);
  const audio = await ctx.decodeAudioData(buf);
  const ch0 = audio.getChannelData(0);
  let samples;
  if (audio.numberOfChannels === 1) samples = ch0.slice();
  else {
    const ch1 = audio.getChannelData(1);
    samples = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) samples[i] = (ch0[i] + ch1[i]) / 2;
  }
  const msgId = ++seq;
  const result = await new Promise((resolve, reject) => {
    waiting.set(msgId, { resolve, reject });
    getWorker().postMessage({ id: msgId, samples, sr }, [samples.buffer]);
  });
  return result;
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    if (mem.has(id)) continue;
    try {
      const r = await analyzeNow(id);
      mem.set(id, r);
      api('/api/analysis', { method: 'POST', body: { [id]: r } }).catch(() => {});
      listeners.forEach((fn) => fn(id, r));
    } catch {
      failed.set(id, Date.now());
    }
  }
  running = false;
}

export const automix = {
  get: (id) => mem.get(id) || null,
  onAnalyzed: (fn) => (listeners.add(fn), () => listeners.delete(fn)),

  // Récupère les analyses déjà en cache sur le PC, et met les autres en file (les premiers ids d'abord)
  async ensure(ids, { urgent = false } = {}) {
    ids = [...new Set(ids.filter((id) => id && !mem.has(id) && !(Date.now() - (failed.get(id) || 0) < 60e3)))];
    if (!ids.length) return;
    const key = ids.join(',');
    if (!pending.has(key)) {
      pending.set(key, api(`/api/analysis?ids=${encodeURIComponent(key)}`).catch(() => ({})));
    }
    const cached = await pending.get(key);
    pending.delete(key);
    for (const [id, r] of Object.entries(cached || {})) if (r) mem.set(id, r);
    const missing = ids.filter((id) => !mem.has(id));
    queue = urgent ? [...missing, ...queue.filter((x) => !missing.includes(x))] : [...queue, ...missing.filter((x) => !queue.includes(x))];
    pump();
  },

  // Compatibilité harmonique (roue de Camelot) : 1 = parfaite
  keyScore(a, b) {
    if (!a?.camelot || !b?.camelot) return 0.5;
    const na = parseInt(a.camelot);
    const nb = parseInt(b.camelot);
    const la = a.camelot.slice(-1);
    const lb = b.camelot.slice(-1);
    const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
    if (d === 0 && la === lb) return 1;
    if (d === 0) return 0.85; // relatif majeur/mineur
    if (d === 1 && la === lb) return 0.9; // quinte
    if (d === 2 && la === lb) return 0.55; // « boost » d'énergie
    return 0.25;
  },

  // Tempo du titre B ramené vers celui de A (moitié/double si plus proche)
  alignedBpm(a, b) {
    let bb = b.bpm;
    for (const k of [0.5, 2]) if (Math.abs(b.bpm * k - a.bpm) < Math.abs(bb - a.bpm)) bb = b.bpm * k;
    return bb;
  },

  tempoScore(a, b) {
    if (!a?.bpm || !b?.bpm) return 0.5;
    const diff = Math.abs(this.alignedBpm(a, b) / a.bpm - 1);
    return Math.max(0, 1 - diff / 0.12);
  },

  // Note globale d'un enchaînement A → B
  score(a, b) {
    if (!a || !b) return 0.4;
    const energy = 1 - Math.min(1, Math.abs((a.energy || 5) - (b.energy || 5)) / 6);
    return 0.45 * this.keyScore(a, b) + 0.4 * this.tempoScore(a, b) + 0.15 * energy;
  },

  // Choisit, parmi les candidats déjà analysés, celui qui s'enchaîne le mieux (un peu de hasard pour varier)
  pickBest(curId, candidateIds) {
    const a = mem.get(curId);
    if (!a) return -1;
    let best = -1;
    let bestScore = -1;
    candidateIds.forEach((id, i) => {
      const b = mem.get(id);
      if (!b) return;
      const s = this.score(a, b) + Math.random() * 0.08;
      if (s > bestScore) (bestScore = s), (best = i);
    });
    return best;
  },

  // Choix de la transition qui sonnera le mieux entre A et B (comme le mix automatique de Spotify) :
  // - tempos proches et tonalités compatibles → Blend (long mélange calé, échange des basses) ou Melt (sons calmes)
  // - tempos proches mais tonalités qui se heurtent → Wave / Amplification (les filtres masquent le désaccord)
  // - grosse montée d'énergie → Montée en puissance, ou Slam si le suivant démarre direct sur le beat
  // - grosse baisse d'énergie → Rémanence (le titre part en écho) ou Fondu
  // - tempos trop différents, énergie proche → Wave ou Fondu enchaîné
  chooseStyle(a, b, tempoMatch, keyS) {
    const dE = (b.energy || 5) - (a.energy || 5);
    const calm = (a.energy || 5) < 4 && (b.energy || 5) < 4;
    const punchyStart = b.start < 1.5 && (b.energy || 5) >= 6;
    const pick = (opts) => opts[(Math.round(a.bpm * 7 + b.bpm * 3) % opts.length + opts.length) % opts.length]; // varié mais stable pour une même paire
    if (dE >= 2.5) return punchyStart ? 'slam' : 'powerup';
    if (dE <= -2.5) return pick(['echo', 'fade', 'echo']);
    if (tempoMatch && keyS >= 0.85) return calm ? 'melt' : pick(['blend', 'blend', 'melt']);
    if (tempoMatch) return pick(['wave', 'rise', 'blend']);
    if (Math.abs(a.bpm - b.bpm) > 25) return pick(['echo', 'crossfade', 'wave']);
    return pick(['wave', 'crossfade', 'rise']);
  },

  // Plan de transition entre A (en cours) et B (suivant) ; style : 'auto' ou un style imposé.
  // Renvoie null si l'un des deux n'est pas analysé (fondu simple de secours) ou si « Aucune transition ».
  plan(aId, bId, wanted = 'auto') {
    if (wanted === 'none') return null;
    const a = mem.get(aId);
    const b = mem.get(bId);
    if (!a || !b || !a.bpm || !b.bpm) return null;
    const bAligned = this.alignedBpm(a, b);
    let rate = a.bpm / bAligned;
    const keyS = this.keyScore(a, b);
    const tempoMatch = Math.abs(rate - 1) <= 0.1 && a.confidence > 0.05 && b.confidence > 0.05;
    const style = wanted !== 'auto' ? wanted : this.chooseStyle(a, b, tempoMatch, keyS);
    // Calage du tempo seulement pour les styles où les deux titres jouent ensemble assez longtemps
    if (!tempoMatch || !['blend', 'melt', 'rise', 'wave'].includes(style)) rate = 1;
    const beat = a.beat;
    const bar = 4 * beat;
    // Durée de chaque style (en temps, calés sur les mesures) et moment où le suivant démarre (inAt)
    const harmonic = keyS >= 0.85;
    const L = {
      blend: [harmonic ? 48 : 32, 0], melt: [24, 0], rise: [16, 0], wave: [16, 0], crossfade: [Math.max(16, Math.round(8 / beat)), 0],
      fade: [Math.max(12, Math.round(6 / beat)), 0.45], powerup: [10, 8 / 10], slam: [2, 0], echo: [8, 4 / 8],
    }[style] || [16, 0];
    const mixLen = Math.min(26, Math.max(1, L[0] * beat));
    const inAt = mixLen * L[1];
    // Sortie : dernier temps fort (multiple de 4 temps) qui laisse finir la transition avant la fin de la musique
    const latest = Math.min(a.end, a.duration - 0.5) - mixLen;
    let mixStart = a.firstBeat + Math.floor((latest - a.firstBeat) / bar) * bar;
    if (a.outro > a.start + 30 && a.outro < latest) mixStart = Math.max(mixStart - bar * 4, a.firstBeat + Math.floor((a.outro - a.firstBeat) / bar) * bar);
    if (mixStart < a.duration * 0.5) mixStart = latest;
    // Entrée : premier temps fort après le début de la musique de B (pour Slam / Montée : directement sur le temps fort)
    const bBar = 4 * b.beat;
    let inStart = b.firstBeat;
    while (inStart < b.start - 0.01) inStart += bBar;
    // Égalisation des volumes (référence -16 dB)
    const gainOf = (x) => Math.max(0.5, Math.min(1.8, Math.pow(10, (-16 - x.rmsDb) / 20)));
    return { mixStart, mixLen, inStart, inAt, rate, tempoMatch, style, bassSwap: style === 'blend', gainIn: gainOf(b), gainOut: gainOf(a), beatOut: beat, firstBeatOut: a.firstBeat };
  },
  gain(id) {
    const x = mem.get(id);
    return x ? Math.max(0.5, Math.min(1.8, Math.pow(10, (-16 - x.rmsDb) / 20))) : 1;
  },
};
