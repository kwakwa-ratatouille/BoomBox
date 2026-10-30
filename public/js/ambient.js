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
  const onKey = (e) => e.key === 'Escape' && closeAmbient();
  document.addEventListener('keydown', onKey);
  ov._onKey = onKey;
  ov.requestFullscreen?.().catch(() => {});
  keepAwake('ambient', true);

  // Son en cours : couleurs de la pochette, pochette (kaléidoscope), tempo
  let trackId = null;
  let pal = [[270, 0.8, 0.6], [200, 0.8, 0.55], [320, 0.8, 0.6]];
  let art = null;
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
    art = await loadImg(t.thumb).catch(() => null);
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
  const frame = () => {
    if (!ov) return;
    const now = (performance.now() - t0) / 1000;
    const v = view();
    const an = automix.get(v.track?.id);
    const beat = an?.beat || 0.5;
    const pos = v.position || 0;
    // Pulsation : 1 sur le temps, puis redescend ; plus forte sur le premier temps de chaque mesure. À l'arrêt : calme
    const ph = ((pos - (an?.firstBeat || 0)) / beat) % 1;
    const barStart = Math.floor((pos - (an?.firstBeat || 0)) / beat) % 4 === 0;
    const hit = v.paused ? 0 : Math.pow(1 - (ph < 0 ? ph + 1 : ph), 3) * (barStart ? 1 : 0.65);
    smooth += (hit - smooth) * 0.35;
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
      g.fillStyle = col(P[1], 0.25);
      g.fillRect(0, 0, W, H);
      const R = Math.hypot(W, H) / 2;
      for (let i = 0; i < 6; i++) {
        const r = ((now * 0.25 + i / 6) % 1) * R;
        g.strokeStyle = col(P[i % 3], 1.1, 0.35 + 0.5 * smooth * (1 - r / R));
        g.lineWidth = 20 + 40 * smooth;
        g.beginPath();
        g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = col(P[0], 1.1, 0.5 + 0.5 * smooth);
      g.beginPath();
      g.arc(W / 2, H / 2, Math.min(W, H) * (0.12 + 0.08 * smooth), 0, Math.PI * 2);
      g.fill();
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
