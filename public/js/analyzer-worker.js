// Analyse audio d'un titre (exécutée dans un Web Worker pour ne pas figer l'interface).
// Entrée : échantillons mono (Float32Array) + fréquence d'échantillonnage.
// Sortie : tempo (BPM), grille de battements (1er temps fort), tonalité (+ code Camelot), volume moyen,
// début/fin de la musique (sans les silences) et un niveau d'énergie.

self.onmessage = (e) => {
  const { id, samples, sr } = e.data;
  try {
    self.postMessage({ id, result: analyze(samples, sr) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};

function analyze(x, sr) {
  const duration = x.length / sr;

  // ---------- Enveloppes d'énergie (fenêtres de 256 échantillons ≈ 11,6 ms à 22 050 Hz) ----------
  const hop = 256;
  const n = Math.floor(x.length / hop);
  const low = new Float32Array(n); // graves (basse, grosse caisse)
  const high = new Float32Array(n); // aigus (caisse claire, charleston) : dérivée du signal
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 150) / sr); // passe-bas 150 Hz
  for (let f = 0; f < n; f++) {
    let el = 0;
    let eh = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) {
      lp = a * lp + (1 - a) * x[i];
      el += lp * lp;
      const d = x[i] - (i ? x[i - 1] : 0);
      eh += d * d;
    }
    low[f] = Math.log1p(1e3 * el);
    high[f] = Math.log1p(1e3 * eh);
  }
  // Fonction de détection des attaques : hausses d'énergie dans les deux bandes
  const onset = new Float32Array(n);
  const lowOn = new Float32Array(n); // attaques dans les graves seulement (grosse caisse, basse)
  for (let f = 1; f < n; f++) {
    lowOn[f] = Math.max(0, low[f] - low[f - 1]);
    onset[f] = lowOn[f] + Math.max(0, high[f] - high[f - 1]);
  }
  // Retrait de la tendance locale (moyenne glissante sur ~0,5 s)
  const w = 22;
  const det = new Float32Array(n);
  let acc = 0;
  for (let f = 0; f < n; f++) {
    acc += onset[f] - (f >= 2 * w ? onset[f - 2 * w] : 0);
    const mean = acc / Math.min(f + 1, 2 * w);
    det[f] = Math.max(0, onset[f] - mean);
  }

  // ---------- Volume par seconde → début et fin de la musique ----------
  const secs = Math.floor(duration);
  const rmsSec = new Float32Array(secs);
  for (let s = 0; s < secs; s++) {
    let e2 = 0;
    for (let i = s * sr, end = Math.min(x.length, (s + 1) * sr); i < end; i += 4) e2 += x[i] * x[i];
    rmsSec[s] = Math.sqrt(e2 / (sr / 4));
  }
  const sorted = Array.from(rmsSec).sort((p, q) => p - q);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  let start = 0;
  while (start < secs - 1 && rmsSec[start] < median * 0.3) start++;
  let end = secs - 1;
  while (end > start && rmsSec[end] < median * 0.3) end--;
  // Outro : on remonte depuis la fin tant que le niveau reste nettement sous la médiane
  let outro = end;
  while (outro > start + 30 && rmsSec[outro] < median * 0.7) outro--;
  let loud = 0;
  for (let i = 0; i < x.length; i += 8) loud += x[i] * x[i];
  const rmsDb = 10 * Math.log10(loud / (x.length / 8) + 1e-12);
  const lufs = loudness(x, sr);

  // ---------- Tempo : autocorrélation de la fonction d'attaques (60 à 200 BPM) ----------
  const fps = sr / hop;
  const s0 = Math.floor(start * fps);
  const s1 = Math.min(n, Math.floor(end * fps));
  const seg = det.subarray(s0, s1);
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.ceil((fps * 60) / 60);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < seg.length; i++) sum += seg[i] * seg[i + lag];
    ac[lag] = sum / (seg.length - lag);
  }
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Peigne : on renforce avec les multiples (mesures) et on favorise les tempos autour de 120 BPM
    const comb = ac[lag] + 0.5 * (ac[lag * 2] || 0) + 0.25 * (ac[lag * 4] || 0);
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.55, 2));
    const score = comb * prior;
    if (score > bestScore) (bestScore = score), (bestLag = lag);
  }
  // Affinage sub-échantillon (interpolation parabolique)
  const y0 = ac[bestLag - 1] || 0;
  const y1 = ac[bestLag];
  const y2 = ac[bestLag + 1] || 0;
  const shift = y0 - 2 * y1 + y2 !== 0 ? (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2) : 0;
  let period = bestLag + Math.max(-0.5, Math.min(0.5, shift)); // en trames
  // Affinage : on cherche la période (±1,5 %) et la phase qui alignent le mieux une grille de battements
  // sur toutes les attaques du morceau (évite la dérive des temps pendant un long mix)
  const gridScore = (p, phase) => {
    let sc = 0;
    for (let t = s0 + phase; t < s1; t += p) {
      const i = Math.round(t);
      sc += Math.max(det[i] || 0, 0.5 * (det[i - 1] || 0), 0.5 * (det[i + 1] || 0));
    }
    return sc;
  };
  let fine = { p: period, phase: 0, sc: -1 };
  for (let p = period * 0.985; p <= period * 1.015; p += period * 0.0015) {
    for (let k = 0; k < 24; k++) {
      const phase = (k / 24) * p;
      const sc = gridScore(p, phase);
      if (sc > fine.sc) fine = { p, phase, sc };
    }
  }
  period = fine.p;
  let bpm = (60 * fps) / period;
  bpm = Math.round(bpm * 10) / 10;
  // Confiance : netteté du pic par rapport à la moyenne
  let mean = 0;
  for (let lag = minLag; lag <= maxLag; lag++) mean += ac[lag];
  mean /= maxLag - minLag + 1;
  const confidence = Math.max(0, Math.min(1, (ac[bestLag] / (mean || 1) - 1) / 2));

  // ---------- Phase des battements et temps fort ----------
  // Les temps sont marqués par les graves : on les pondère fort pour ne pas se caler sur les charleys entre les temps
  let bestPhase = 0;
  let bestPhaseScore = -1;
  const steps = 48;
  for (let k = 0; k < steps; k++) {
    const phase = (k / steps) * period;
    let sc = 0;
    for (let t = s0 + phase; t < s1; t += period) {
      const i = Math.round(t);
      sc += (det[i] || 0) + 3 * Math.max(lowOn[i] || 0, lowOn[i + 1] || 0);
    }
    if (sc > bestPhaseScore) (bestPhaseScore = sc), (bestPhase = phase);
  }
  // Parmi les 4 temps de la mesure, le temps fort est celui où les graves sont les plus forts
  // (pic d'énergie grave autour du temps + attaque), en moyenne sur tout le morceau
  let downIdx = 0;
  let downScore = -Infinity;
  for (let b = 0; b < 4; b++) {
    let sc = 0;
    let cnt = 0;
    for (let t = s0 + bestPhase + b * period; t < s1; t += 4 * period) {
      const i = Math.round(t);
      let peak = 0;
      for (let j = i - 1; j <= i + 3; j++) peak = Math.max(peak, low[j] || 0);
      sc += peak + 0.5 * Math.max(0, (low[i + 1] || 0) - (low[i - 2] || 0));
      cnt++;
    }
    sc /= cnt || 1;
    if (sc > downScore) (downScore = sc), (downIdx = b);
  }
  const firstBeat = (s0 + bestPhase + downIdx * period) / fps; // secondes
  const beatSec = period / fps;

  // ---------- Tonalité : chromagramme + profils de Krumhansl ----------
  const N = 8192;
  const chroma = new Float64Array(12);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const binPc = new Int8Array(N / 2).fill(-1);
  for (let b = 1; b < N / 2; b++) {
    const f = (b * sr) / N;
    if (f < 110 || f > 3500) continue; // sous 110 Hz : surtout la grosse caisse, qui fausserait la tonalité
    binPc[b] = (((Math.round(12 * Math.log2(f / 440)) + 69) % 12) + 12) % 12;
  }
  const from = Math.floor(start * sr);
  const to = Math.floor(end * sr) - N;
  const stride = Math.max(N, Math.floor((to - from) / 220)); // ~220 trames réparties sur le morceau
  for (let pos = from; pos < to; pos += stride) {
    for (let i = 0; i < N; i++) (re[i] = x[pos + i] * win[i]), (im[i] = 0);
    fft(re, im);
    // Chroma de la trame, normalisé (chaque trame compte autant, qu'elle soit forte ou faible)
    const fr = new Float64Array(12);
    let tot = 0;
    for (let b = 1; b < N / 2; b++) {
      const pc = binPc[b];
      if (pc < 0) continue;
      const m = Math.hypot(re[b], im[b]);
      fr[pc] += m;
      tot += m;
    }
    if (tot > 0) for (let i = 0; i < 12; i++) chroma[i] += fr[i] / tot;
  }
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  let best = { score: -2, tonic: 0, mode: 'major' };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
      const r = corr(chroma, (i) => prof[(i - tonic + 12) % 12]);
      if (r > best.score) best = { score: r, tonic, mode };
    }
  }
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const CAM_MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
  const CAM_MIN = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  const camelot = best.mode === 'major' ? `${CAM_MAJ[best.tonic]}B` : `${CAM_MIN[best.tonic]}A`;

  // ---------- Énergie (1 à 10) : volume + densité d'attaques ----------
  let dens = 0;
  for (let i = s0; i < s1; i++) dens += det[i];
  dens /= Math.max(1, s1 - s0);
  const energy = Math.max(1, Math.min(10, Math.round((rmsDb + 40) / 3.5 + dens * 6)));

  return {
    v: 1,
    duration: Math.round(duration * 10) / 10,
    bpm,
    confidence: Math.round(confidence * 100) / 100,
    beat: Math.round(beatSec * 10000) / 10000,
    firstBeat: Math.round(firstBeat * 1000) / 1000,
    key: `${NAMES[best.tonic]}${best.mode === 'minor' ? 'm' : ''}`,
    camelot,
    keyStrength: Math.round(best.score * 100) / 100,
    rmsDb: Math.round(rmsDb * 10) / 10,
    lufs: Math.round(lufs * 10) / 10,
    energy,
    start,
    end,
    outro,
  };
}

function corr(a, fb) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) (ma += a[i]), (mb += fb(i));
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma;
    const y = fb(i) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db || 1);
}

// FFT radix-2 en place
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// Volume perçu (LUFS, norme ITU BS.1770, celle de Spotify / YouTube) : filtre « K » qui imite l'oreille (moins
// sensible aux basses, plus aux aigus), mesure par blocs de 400 ms, et on ignore les silences et passages très
// calmes (double seuil). Bien plus juste qu'un simple volume moyen, que les basses et les intros faussaient.
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function loudness(x, sr) {
  // Étage 1 : plateau haut +4 dB (vers 1,7 kHz)
  let G = 3.99984385397, f0 = 1681.97445095, Q = 0.7071752369554193;
  let K = Math.tan((Math.PI * f0) / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.499666774155), a0 = 1 + K / Q + K * K;
  let y = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // Étage 2 : passe-haut (vers 38 Hz)
  f0 = 38.13547087613982; Q = 0.5003270373253953; K = Math.tan((Math.PI * f0) / sr); a0 = 1 + K / Q + K * K;
  y = biquad(y, 1 / a0, -2 / a0, 1 / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // Blocs de 400 ms qui se chevauchent à 75 %
  const blk = Math.round(0.4 * sr), step = Math.round(0.1 * sr), z = [];
  for (let i = 0; i + blk <= y.length; i += step) {
    let e = 0;
    for (let j = i; j < i + blk; j += 2) e += y[j] * y[j];
    z.push(e / (blk / 2));
  }
  const L = (m) => -0.691 + 10 * Math.log10(m + 1e-12);
  const abs = z.filter((m) => L(m) > -70);
  if (!abs.length) return -70;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter((m) => L(m) > rel);
  return L(g.reduce((a, b) => a + b, 0) / (g.length || 1));
}
