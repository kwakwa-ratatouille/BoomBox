// Ambiance lumineuse : l'écran entier devient une lumière qui suit la musique (le soir, téléphone ou PC posé).
// Couleurs tirées de la pochette du son en cours, pulsation calée sur le tempo (analyse automix : BPM et premier
// temps), réglage de l'intensité. Ambiances : écran lumineux, kaléidoscope (de la pochette), aurore, pulsation.
// Fonctionne aussi sur iPhone : on ne lit pas le son lui-même, seulement le tempo et la position.
import { player } from './player.js';
import { sync } from './sync.js';
import { automix } from './automix.js';
import { bus, ls } from './state.js';
import { dominantColor, icon } from './ui.js';
import { loadImg } from './story.js';
import { keepAwake } from './awake.js';

const MODES = [['glow', 'Écran lumineux'], ['kaleido', 'Kaléidoscope'], ['aurora', 'Aurore'], ['pulse', 'Pulsation']];
let ov = null;

// Couleur → teinte, saturation, luminosité (0-360, 0-1, 0-1)
function hsl(hex) {
  const n = parseInt(String(hex || '#b07cf7').replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
}

export function openAmbient() {
  if (ov) return;
  let mode = ls.get('boombox.ambientMode', 'glow');
  let intensity = ls.get('boombox.ambientLevel', 0.8);
  ov = document.createElement('div');
  ov.className = 'amb';
  ov.innerHTML = `<canvas></canvas>
    <div class="amb-ui">
      <div class="amb-top">${MODES.map(([k, n]) => `<button class="chip" data-m="${k}">${n}</button>`).join('')}<button class="amb-x" aria-label="Fermer">${icon('close', 22)}</button></div>
      <div class="amb-bottom"><span>☀️</span><input type="range" min="0.15" max="1" step="0.01" class="amb-level" aria-label="Intensité lumineuse"><span class="amb-now"></span></div>
    </div>`;
  document.body.appendChild(ov);
  const cv = ov.querySelector('canvas');
  const g = cv.getContext('2d');
  const level = ov.querySelector('.amb-level');
  level.value = intensity;
  const paintChips = () => ov.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('active', b.dataset.m === mode));
  paintChips();
  ov.querySelectorAll('[data-m]').forEach((b) => (b.onclick = (e) => (e.stopPropagation(), (mode = b.dataset.m), ls.set('boombox.ambientMode', mode), paintChips())));
  level.oninput = () => ((intensity = +level.value), ls.set('boombox.ambientLevel', intensity));
  ov.querySelector('.amb-x').onclick = (e) => (e.stopPropagation(), closeAmbient());
  // Réglages visibles 3 s après un toucher / mouvement, puis l'écran n'est plus que lumière
  let hideT = 0;
  const wake = () => {
    ov.classList.add('ui');
    clearTimeout(hideT);
    hideT = setTimeout(() => ov?.classList.remove('ui'), 3000);
  };
  ov.addEventListener('pointermove', wake);
  ov.addEventListener('pointerdown', wake);
  wake();
  const onKey = (e) => {
    if (e.key === 'Escape') return closeAmbient();
    // 1 à 4 : changer d'ambiance ; espace : lecture / pause
    const k = MODES[Number(e.key) - 1];
    if (k) ((mode = k[0]), ls.set('boombox.ambientMode', mode), paintChips(), wake());
    if (e.key === ' ') (e.preventDefault(), import('./player.js').then((p) => p.ctl.toggle()));
  };
  document.addEventListener('keydown', onKey);
  ov._onKey = onKey;
  ov.requestFullscreen?.().catch(() => {});
  keepAwake('ambient', true);

  // Son en cours : couleurs de la pochette, pochette (kaléidoscope), tempo
  let trackId = null;
  let pal = [[270, 0.8, 0.6], [200, 0.8, 0.55], [320, 0.8, 0.6]];
  let art = null;
  let artBlur = null;
  let artSwapAt = 0;
  const view = () => (player.remoteSender ? sync.view() : { track: player.track, position: player.time(), paused: player.paused });
  const loadTrack = async (t) => {
    trackId = t?.id || null;
    if (!t) return;
    automix.ensure([t.id]);
    ov.querySelector('.amb-now').textContent = `${t.title} · ${(t.artists || []).map((a) => a.name).join(', ')}`;
    const c = await dominantColor(t.thumb).catch(() => null);
    if (trackId !== t.id) return;
    const [h, s, l] = hsl(c || '#b07cf7');
    const sat = Math.max(0.55, s);
    pal = [[h, sat, Math.max(0.5, l)], [(h + 40) % 360, sat, 0.55], [(h + 320) % 360, sat, 0.6]];
    // Pochette en grand (les miniatures de YouTube Music sont en 120 px : floues au centre de l'écran)
    const big = String(t.thumb || '').replace(/=w\d+-h\d+/, '=w720-h720').replace(/=s\d+/, '=s720');
    const im = (await loadImg(big)) || (await loadImg(t.thumb)); // loadImg rend null en cas d'échec
    if (trackId !== t.id) return;
    // Carré pris au centre (les miniatures YouTube ont des bandes noires en haut et en bas)
    if (im) {
      const side = Math.min(im.width, im.height) * (/ytimg.com/.test(big) ? 0.75 : 1);
      const sq = document.createElement('canvas');
      sq.width = sq.height = Math.round(side);
      sq.getContext('2d').drawImage(im, (im.width - side) / 2, (im.height - side) / 2, side, side, 0, 0, side, side);
      art = sq;
    } else art = null;
    // Fond : la pochette réduite à 32 px puis agrandie = flou naturel, sans filtre coûteux à chaque image
    if (im) {
      const c2 = document.createElement('canvas');
      c2.width = c2.height = 32;
      c2.getContext('2d').drawImage(art, 0, 0, 32, 32);
      artBlur = c2;
    }
    artSwapAt = performance.now();
  };
  loadTrack(view().track);
  const onTrack = () => view().track?.id !== trackId && loadTrack(view().track);
  bus.addEventListener('player:track', onTrack);
  bus.addEventListener('sync', onTrack);
  ov._off = () => (bus.removeEventListener('player:track', onTrack), bus.removeEventListener('sync', onTrack));

  const col = ([h, s, l], k = 1, a = 1) => `hsla(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100 * k)}%, ${a})`;
  let W = 0;
  let H = 0;
  const size = () => {
    const r = Math.min(devicePixelRatio || 1, 1.5);
    W = cv.width = Math.round(innerWidth * r);
    H = cv.height = Math.round(innerHeight * r);
  };
  size();
  addEventListener('resize', size);
  ov._resize = size;
  const t0 = performance.now();
  let smooth = 0;
  let spec = null;
  let lastT = performance.now();
  let dt = 1 / 60;
  let bassLevel = 0; // énergie des basses en continu (0-1), en plus des coups
  let rings = []; // anneaux, un par temps
  let onsets = []; // instants des derniers coups de basse (tempo appris à l'écoute)
  let learned = null; // { period, origin } appris à l'écoute
  let beatEnv = 0; // 1 pile sur le temps, retombe vite
  let beatInBar = -1; // 0-3 : temps dans la mesure
  let specPeak = 0.2; // niveau récent du spectre (normalisation)
  // PC : la lumière écoute le vrai son (énergie des basses, image par image) au lieu de deviner le rythme. Un coup
  // de grosse caisse = un flash, quel que soit le tempo. Téléphone, ou son joué sur un autre appareil : tempo analysé.
  let ana = null;
  let bins = null;
  let avg = 0;
  let lastHit = 0;
  const live = () => {
    const e = player.engines?.audio;
    if (player.remoteSender || player.engine?.name !== 'audio' || !e || window.Capacitor?.isNativePlatform?.()) return null;
    if (!e.graph) e.enableGraph?.();
    if (!e.graph) return null;
    if (!ana) {
      ana = e.graph.ctx.createAnalyser();
      ana.fftSize = 1024;
      ana.smoothingTimeConstant = 0; // aucun lissage dans l'analyse : le coup est vu dans l'image même où il sonne
      e.graph.nodes.forEach((n) => n.gain.connect(ana));
      bins = new Uint8Array(ana.frequencyBinCount);
    }
    return ana;
  };
  const liveHit = (a) => {
    a.getByteFrequencyData(bins);
    // Basses (≈ 40–160 Hz) : là où tombent grosse caisse et 808
    const hz = a.context.sampleRate / a.fftSize;
    let sum = 0;
    let n = 0;
    for (let i = Math.max(1, Math.floor(40 / hz)); i <= Math.ceil(160 / hz); i++) (sum += bins[i]), n++;
    const e = sum / n / 255;
    const t = performance.now();
    // Montée des basses depuis l'image d'avant (une grosse caisse = un saut brusque), comparée à ses montées habituelles :
    // marche aussi bien sur un son calme que sur un son très compressé
    const flux = Math.max(0, e - (liveHit.prev ?? e));
    liveHit.prev = e;
    avg += (flux - avg) * 0.05;
    bassLevel = Math.max(0, Math.min(1, (e - 0.3) / 0.6));
    if (flux > Math.max(0.025, avg * 2.4) && e > 0.2 && t - lastHit > 140) {
      lastHit = t;
      return Math.min(1, 0.6 + flux * 4);
    }
    return 0;
  };
  const frame = () => {
    if (!ov) return;
    const tn = performance.now();
    dt = Math.min(0.1, (tn - lastT) / 1000);
    lastT = tn;
    const now = (tn - t0) / 1000;
    const v = view();
    const an = automix.get(v.track?.id);
    const pos = v.position || 0;
    const a = v.paused ? null : live();
    const hit = a ? liveHit(a) : 0;
    // Tempo appris à l'écoute (PC, analyse automix pas encore prête) : écart médian entre les coups de basse
    if (hit) {
      onsets.push(pos);
      onsets = onsets.filter((t) => pos - t < 8 && t <= pos);
      const gaps = [];
      for (let i = 1; i < onsets.length; i++) {
        let d = onsets[i] - onsets[i - 1];
        while (d > 0 && d < 0.3) d *= 2;
        while (d > 1) d /= 2;
        if (d >= 0.3) gaps.push(d);
      }
      if (gaps.length >= 4) learned = { period: gaps.sort((x, y) => x - y)[gaps.length >> 1], origin: pos };
    }
    // Métronome : grille de temps fixe (analyse automix : tempo + premier temps ; sinon tempo appris).
    // Chaque temps = un coup net qui retombe vite ; le premier temps de la mesure tape plus fort.
    const grid = an?.beat ? { period: an.beat, origin: an.firstBeat || 0 } : learned;
    let ph = 0;
    let beatN = -1;
    if (grid) {
      const x = (pos - grid.origin) / grid.period;
      beatN = Math.floor(x);
      ph = x - beatN;
    }
    const down = ((beatN % 4) + 4) % 4 === 0;
    if (!v.paused && grid && beatN !== frame.lastBeat) rings.push({ r: 0, a: down ? 1 : 0.5 });
    frame.lastBeat = beatN;
    // Volume du moment (PC) : un passage calme bat moins fort qu'un refrain, mais bat toujours en rythme
    const ampK = a ? 0.6 + 0.4 * Math.min(1, bassLevel * 1.4) : 1;
    beatEnv = grid ? Math.exp(-ph * grid.period * 7) : 0;
    smooth = v.paused ? smooth * Math.pow(0.9, dt * 60) : grid ? beatEnv * (down ? 1 : 0.7) * ampK : a ? Math.max(hit, smooth * Math.pow(0.86, dt * 60)) : 0.25 + 0.15 * Math.sin(now * 1.6);
    beatInBar = grid && !v.paused ? ((beatN % 4) + 4) % 4 : -1;
    const k = intensity;
    const shift = (now * 6) % 360; // les couleurs tournent doucement
    const P = pal.map(([h, s, l]) => [(h + shift) % 360, s, l]);
    g.globalCompositeOperation = 'source-over';
    if (mode === 'glow') {
      const grd = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 1.6);
      grd.addColorStop(0, col(P[0], 0.85 + 0.35 * smooth));
      grd.addColorStop(1, col(P[1], 0.6 + 0.25 * smooth));
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    } else if (mode === 'aurora') {
      g.fillStyle = '#05030a';
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const y = H * (0.3 + 0.2 * i) + Math.sin(now * 0.4 + i * 2) * H * 0.12;
        const grd = g.createLinearGradient(0, y - H * 0.35, 0, y + H * 0.35);
        grd.addColorStop(0, 'transparent');
        grd.addColorStop(0.5, col(P[i], 0.9 + 0.3 * smooth, 0.55));
        grd.addColorStop(1, 'transparent');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= W; x += W / 24) g.lineTo(x, y + Math.sin(x / W * 6 + now * (0.6 + i * 0.2)) * H * 0.08);
        g.lineTo(W, y + H * 0.4);
        g.lineTo(0, y + H * 0.4);
        g.fill();
      }
    } else if (mode === 'pulse') {
      // Pochette au centre qui bat comme un métronome, onde lumineuse autour (vrai spectre sur PC), un anneau par
      // temps, et 4 points qui marquent le temps dans la mesure
      const cx = W / 2;
      const cy = H / 2;
      const m = Math.min(W, H);
      const p = smooth;
      g.fillStyle = '#07060b';
      g.fillRect(0, 0, W, H);
      if (artBlur) {
        const fade = Math.min(1, (tn - artSwapAt) / 600);
        const B = Math.max(W, H) * 1.3;
        g.globalAlpha = (0.28 + 0.5 * p) * fade;
        g.imageSmoothingEnabled = true;
        g.drawImage(artBlur, cx - B / 2, cy - B / 2, B, B);
        g.globalAlpha = 1;
      }
      const vig = g.createRadialGradient(cx, cy, m * 0.15, cx, cy, Math.hypot(W, H) / 2);
      vig.addColorStop(0, col(P[0], 0.8, 0.1 + 0.45 * p));
      vig.addColorStop(1, 'rgba(4,3,8,0.94)');
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);
      // Spectre : 40 bandes, rapporté au niveau récent (ne dépend pas du volume), lissé
      const N = 40;
      spec ||= new Float32Array(N);
      if (a && bins) {
        let mx = 0;
        const raw = [];
        for (let i = 0; i < N; i++) {
          const lo = Math.max(1, Math.floor(Math.pow(bins.length * 0.55, i / N)));
          const hi = Math.max(lo + 1, Math.floor(Math.pow(bins.length * 0.55, (i + 1) / N)));
          let s2 = 0;
          for (let j = lo; j < hi; j++) s2 += bins[j];
          raw[i] = (s2 / (hi - lo) / 255) * (1 + (0.6 * i) / N);
          mx = Math.max(mx, raw[i]);
        }
        specPeak = Math.max(specPeak * Math.pow(0.997, dt * 60), mx, 0.05);
        for (let i = 0; i < N; i++) {
          const val = Math.pow(raw[i] / specPeak, 2.2);
          spec[i] += (val - spec[i]) * (val > spec[i] ? 0.6 : 0.12);
        }
      } else {
        for (let i = 0; i < N; i++) {
          const val = v.paused ? 0.03 : (0.1 + 0.55 * p * (1 - i / N)) * (0.75 + 0.25 * Math.sin(now * 1.3 + i * 0.9));
          spec[i] += (val - spec[i]) * 0.25;
        }
      }
      const S = m * 0.34 * (1 + 0.14 * p); // côté de la pochette : bondit à chaque temps
      const base = S * 0.62;
      const amp = m * 0.11 * (1 + 0.7 * p);
      // Onde : courbe fermée, symétrique gauche / droite, deux couches
      g.globalCompositeOperation = 'lighter';
      for (const [layer, c, k2] of [[0, P[1], 0.6], [1, P[0], 1]]) {
        g.beginPath();
        const pts = 2 * N;
        for (let i = 0; i <= pts; i++) {
          const idx = i < N ? i : pts - i;
          const v2 = spec[Math.min(N - 1, idx)] * k2 + (layer ? 0 : 0.04);
          const ang = -Math.PI / 2 + (i / pts) * Math.PI * 2;
          const r = base + 6 + v2 * amp;
          const X = cx + Math.cos(ang) * r;
          const Y = cy + Math.sin(ang) * r;
          if (i) g.lineTo(X, Y);
          else g.moveTo(X, Y);
        }
        g.closePath();
        const grd = g.createRadialGradient(cx, cy, base, cx, cy, base + amp);
        // Seule la bande de l'onde s'éclaire (le disque sous la pochette reste sombre)
        grd.addColorStop(0, col(c, 1.1, 0));
        grd.addColorStop(0.1, col(c, 1.1, 0.45));
        grd.addColorStop(1, col(c, 1.1, 0.04));
        g.fillStyle = grd;
        g.fill();
        g.strokeStyle = col(c, 1.3, 0.85);
        g.lineWidth = Math.max(1.5, m * 0.0025);
        g.stroke();
      }
      // Anneaux : un par temps (plus marqué sur le premier temps)
      for (const o of rings) {
        o.r += m * 0.7 * dt;
        const al = o.a * Math.max(0, 1 - o.r / (m * 0.45));
        g.strokeStyle = col(P[0], 1.4, al * 0.9);
        g.lineWidth = 2 + 12 * al;
        g.beginPath();
        g.arc(cx, cy, base + 6 + o.r, 0, Math.PI * 2);
        g.stroke();
      }
      rings = rings.filter((o) => o.r < m * 0.45).slice(-6);
      g.globalCompositeOperation = 'source-over';
      // Pochette : carré arrondi, à l'endroit, qui grossit à chaque temps
      const rad = S * 0.08;
      const box = () => {
        g.beginPath();
        if (g.roundRect) g.roundRect(cx - S / 2, cy - S / 2, S, S, rad);
        else g.rect(cx - S / 2, cy - S / 2, S, S);
      };
      g.save();
      g.shadowBlur = (40 + 70 * p) * (W / innerWidth);
      g.shadowColor = col(P[0], 1.2, 0.85);
      g.fillStyle = '#0d0a14';
      box();
      g.fill();
      g.restore();
      g.save();
      box();
      g.clip();
      if (art) {
        g.globalAlpha = Math.min(1, (tn - artSwapAt) / 400);
        g.drawImage(art, cx - S / 2, cy - S / 2, S, S);
        g.globalAlpha = 1;
        g.fillStyle = `rgba(255,255,255,${0.32 * beatEnv * (beatInBar === 0 ? 1 : 0.55)})`;
        g.fillRect(cx - S / 2, cy - S / 2, S, S);
      } else {
        g.fillStyle = col(P[0], 0.7);
        g.fillRect(cx - S / 2, cy - S / 2, S, S);
      }
      g.restore();
      // Flash de tout l'écran à chaque temps (plus fort sur le premier temps de la mesure)
      if (beatInBar >= 0) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = col(P[0], 1, 0.22 * beatEnv * (beatInBar === 0 ? 1 : 0.45));
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      }
      // Métronome : 4 points sous la pochette, celui du temps en cours s'allume
      if (beatInBar >= 0) {
        const dy = cy + m * 0.34 * 0.62 + m * 0.24; // fixe (ne saute pas avec la pochette)
        const gap = m * 0.04;
        for (let i = 0; i < 4; i++) {
          const on = i === beatInBar;
          const r = m * (on ? 0.009 + 0.006 * beatEnv : 0.006);
          g.fillStyle = on ? col(P[0], 1.5, 0.6 + 0.4 * beatEnv) : 'rgba(255,255,255,0.18)';
          g.beginPath();
          g.arc(cx + (i - 1.5) * gap, dy, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else {
      // Kaléidoscope : un quartier de la pochette, retourné en miroir 12 fois autour du centre
      g.fillStyle = col(P[1], 0.3);
      g.fillRect(0, 0, W, H);
      const N = 12;
      const R = Math.hypot(W, H) / 2;
      const zoom = 1 + 0.15 * smooth;
      g.save();
      g.translate(W / 2, H / 2);
      g.rotate(now * 0.08);
      for (let i = 0; i < N; i++) {
        g.save();
        // Quartiers impairs : retournés en miroir, mais à leur place (sinon un quartier sur deux restait vide)
        if (i % 2) {
          g.rotate(((i + 1) * 2 * Math.PI) / N);
          g.scale(1, -1);
        } else g.rotate((i * 2 * Math.PI) / N);
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, R, 0, (2 * Math.PI) / N);
        g.closePath();
        g.clip();
        if (art) {
          // La pochette remplit le quartier et y glisse lentement
          const s = R * 1.2 * zoom;
          g.drawImage(art, -s * 0.15 + Math.sin(now * 0.25) * R * 0.15, -s * 0.15 + Math.cos(now * 0.2) * R * 0.1, s, s);
        } else {
          g.fillStyle = col(P[i % 3]);
          g.fillRect(0, 0, R, R);
        }
        g.restore();
      }
      g.restore();
      g.globalCompositeOperation = 'overlay';
      g.fillStyle = col(P[0], 1, 0.35 * smooth);
      g.fillRect(0, 0, W, H);
    }
    // Intensité : voile sombre par-dessus (la lumière baisse sans changer les couleurs)
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(0,0,0,${(1 - k) * 0.85})`;
    g.fillRect(0, 0, W, H);
    ov._raf = requestAnimationFrame(frame);
  };
  frame();
}

export function closeAmbient() {
  if (!ov) return;
  cancelAnimationFrame(ov._raf);
  ov._off?.();
  removeEventListener('resize', ov._resize);
  document.removeEventListener('keydown', ov._onKey);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  keepAwake('ambient', false);
  ov.remove();
  ov = null;
}
