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
  let parts = null;
  let lastT = performance.now();
  let dt = 1 / 60;
  let bassLevel = 0; // énergie des basses en continu (0-1), en plus des coups
  let rings = []; // ondes qui partent de la pochette sur les gros coups
  let spin = 0; // rotation de la pochette, façon vinyle (s'arrête en pause)
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
    const beat = an?.beat || 0.5;
    const pos = v.position || 0;
    // Pulsation : 1 sur le temps, puis redescend ; plus forte sur le premier temps de chaque mesure. À l'arrêt : calme
    const ph = ((pos - (an?.firstBeat || 0)) / beat) % 1;
    const barStart = Math.floor((pos - (an?.firstBeat || 0)) / beat) % 4 === 0;
    const a = v.paused ? null : live();
    if (a) {
      // Vrai son : flash immédiat au coup, puis redescente douce (aucun retard à la montée)
      const h = liveHit(a);
      if (h > 0.8) rings.push({ r: 0, a: h });
      // Redescente identique quel que soit l'écran (60 ou 120 Hz) ; jamais sous le niveau des basses du moment
      smooth = Math.max(h ? Math.max(smooth, h) : smooth * Math.pow(0.86, dt * 60), bassLevel * 0.45);
    } else {
      // Tempo analysé : une onde au premier temps de chaque mesure
      const beatN = an?.beat ? Math.floor((pos - (an.firstBeat || 0)) / beat) : -1;
      if (!v.paused && beatN !== frame.lastBeat && beatN >= 0 && beatN % 4 === 0) rings.push({ r: 0, a: 1 });
      frame.lastBeat = beatN;
      // Tempo analysé ; tempo inconnu (analyse pas prête) : simple respiration lente plutôt qu'un faux rythme
      const hit = v.paused ? 0 : an?.beat ? Math.pow(1 - (ph < 0 ? ph + 1 : ph), 3) * (barStart ? 1 : 0.65) : 0.25 + 0.2 * Math.sin(now * 1.6);
      smooth = hit > smooth ? hit : smooth + (hit - smooth) * 0.25; // montée immédiate, descente douce
    }
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
      // La pochette du son au centre, qui tourne comme un vinyle et bat avec la musique ; autour, un spectre en miroir
      // (vrai son sur PC, imité au rythme ailleurs), des ondes sur les gros coups et des particules
      const cx = W / 2;
      const cy = H / 2;
      const m = Math.min(W, H);
      const bass = smooth;
      // Fond : la pochette floutée en plein écran, qui respire un peu, assombrie au bord
      g.fillStyle = '#05030a';
      g.fillRect(0, 0, W, H);
      if (artBlur) {
        const fade = Math.min(1, (tn - artSwapAt) / 600); // fondu au changement de son
        const S = Math.max(W, H) * (1.25 + 0.05 * bass);
        g.globalAlpha = 0.4 * fade;
        g.imageSmoothingEnabled = true;
        g.drawImage(artBlur, cx - S / 2, cy - S / 2, S, S);
        g.globalAlpha = 1;
      }
      const vig = g.createRadialGradient(cx, cy, m * 0.2, cx, cy, Math.hypot(W, H) / 2);
      vig.addColorStop(0, col(P[0], 0.5, 0.15 + 0.25 * bass));
      vig.addColorStop(1, 'rgba(3,2,6,0.92)');
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);
      // Spectre : 48 bandes (miroir gauche / droite), réaction franche à la montée, retombée douce
      const N = 48;
      spec ||= new Float32Array(N);
      const up = 1 - Math.pow(0.15, dt * 60);
      const down = 1 - Math.pow(0.82, dt * 60);
      if (a && bins) {
        for (let i = 0; i < N; i++) {
          // Échelle logarithmique : plus de barres pour les basses et les médiums
          const lo = Math.max(1, Math.floor(Math.pow(bins.length * 0.6, i / N)));
          const hi = Math.max(lo + 1, Math.floor(Math.pow(bins.length * 0.6, (i + 1) / N)));
          let s = 0;
          for (let j = lo; j < hi; j++) s += bins[j];
          // Les aigus sont naturellement plus faibles : un peu remontés pour que tout le cercle bouge
          const val = Math.min(1, Math.pow(s / (hi - lo) / 255, 1.6) * (1 + i / N));
          spec[i] += (val - spec[i]) * (val > spec[i] ? up : down);
        }
      } else {
        for (let i = 0; i < N; i++) {
          const low = 1 - i / N;
          const val = v.paused ? 0.04 : 0.12 + 0.6 * bass * low + 0.2 * (0.5 + 0.5 * Math.sin(now * (2 + i * 0.37) + i * 1.7)) * (0.4 + 0.6 * Math.sin(now * 0.7 + i * 0.21) ** 2);
          spec[i] += (val - spec[i]) * (val > spec[i] ? up : down);
        }
      }
      const r0 = m * (0.19 + 0.03 * bass);
      const maxLen = m * 0.2;
      // Barres : deux passes groupées (halo large et doux, puis barre nette) au lieu d'une ombre par barre (trop lent)
      g.save();
      g.translate(cx, cy);
      g.rotate(now * 0.04);
      g.lineCap = 'round';
      g.globalCompositeOperation = 'lighter';
      const bw = Math.max(3, ((Math.PI * r0) / N) * 0.6);
      for (const [wMul, alpha] of [[3.2, 0.18], [1, 0.95]]) {
        for (let c = 0; c < 3; c++) {
          g.strokeStyle = col(P[c], 1.15, alpha);
          g.lineWidth = bw * wMul;
          g.beginPath();
          for (let side = 0; side < 2; side++) {
            for (let i = c; i < N; i += 3) {
              const ang = -Math.PI / 2 + (side ? 1 : -1) * (Math.PI * (i + 0.5)) / N;
              const len = 3 + spec[i] * maxLen;
              const ca = Math.cos(ang);
              const sa = Math.sin(ang);
              g.moveTo(ca * (r0 + 10), sa * (r0 + 10));
              g.lineTo(ca * (r0 + 10 + len), sa * (r0 + 10 + len));
            }
          }
          g.stroke();
        }
      }
      g.restore();
      // Ondes : un anneau part de la pochette sur chaque gros coup et s'efface en s'éloignant
      g.globalCompositeOperation = 'lighter';
      for (const o of rings) {
        o.r += m * 0.9 * dt;
        const al = o.a * Math.max(0, 1 - o.r / (m * 0.6));
        g.strokeStyle = col(P[0], 1.3, al * 0.6);
        g.lineWidth = 2 + 6 * al;
        g.beginPath();
        g.arc(cx, cy, r0 + o.r, 0, Math.PI * 2);
        g.stroke();
      }
      rings = rings.filter((o) => o.r < m * 0.6).slice(-8);
      // Particules : naissent sur le cercle, filent vers l'extérieur, plus vite sur les coups
      parts ||= [];
      if (!v.paused && parts.length < 160) for (let i = 0; i < 1 + Math.round(bass * 5); i++) parts.push({ a: Math.random() * Math.PI * 2, d: r0, s: 0.4 + Math.random(), c: Math.floor(Math.random() * 3), z: 1 + Math.random() * 2 });
      for (const p of parts) {
        p.d += (1.5 + bass * 16) * p.s * dt * 60;
        const alpha = Math.max(0, 1 - (p.d - r0) / (m * 0.8));
        g.fillStyle = col(P[p.c], 1.4, alpha * 0.85);
        g.fillRect(cx + Math.cos(p.a) * p.d - p.z, cy + Math.sin(p.a) * p.d - p.z, p.z * 2, p.z * 2);
      }
      parts = parts.filter((p) => p.d - r0 < m * 0.8);
      g.globalCompositeOperation = 'source-over';
      // Pochette : ronde, tourne lentement pendant la lecture (comme un vinyle) et grossit sur les coups
      if (!v.paused) spin += dt * 0.35;
      const R = r0 * (1 + 0.05 * bass);
      g.save();
      g.shadowBlur = (30 + 50 * bass) * (W / innerWidth);
      g.shadowColor = col(P[0], 1.2, 0.9);
      g.fillStyle = '#0d0a14';
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.clip();
      g.translate(cx, cy);
      g.rotate(spin);
      if (art) {
        g.globalAlpha = Math.min(1, (tn - artSwapAt) / 400);
        g.drawImage(art, -R, -R, R * 2, R * 2);
        // Gros coup : léger flash blanc sur la pochette
        g.globalAlpha = 1;
        g.fillStyle = `rgba(255,255,255,${Math.max(0, bass - 0.6) * 0.35})`;
        g.fillRect(-R, -R, R * 2, R * 2);
      } else {
        g.fillStyle = col(P[0], 0.7);
        g.fillRect(-R, -R, R * 2, R * 2);
      }
      g.restore();
      // Reflet de vinyle (fixe pendant que la pochette tourne) et contour lumineux
      const sh = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      sh.addColorStop(0, 'rgba(255,255,255,0.18)');
      sh.addColorStop(0.45, 'rgba(255,255,255,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = sh;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = col(P[0], 1.35, 0.9);
      g.lineWidth = Math.max(3, m * 0.006);
      g.stroke();
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
