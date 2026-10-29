// Éditeur de transition, comme celui de Spotify : les deux sons l'un au-dessus de l'autre sur une même frise, avec la
// grille des temps. On fait glisser chaque son pour caler ses temps sur ceux de l'autre, on choisit la durée (en
// mesures) et le style, et on écoute le résultat directement dans l'éditeur (curseur qui avance).
// Enregistré dans la playlist (transitions["A_B"] = { style, bars, out, in }), joué tel quel par le lecteur.
import { updatePlaylist } from './state.js';
import { player, TRANSITION_NAMES } from './player.js';
import { automix } from './automix.js';
import { modal, html, toast, fmtTime, icon } from './ui.js';
import { isNative, localApi } from './native.js';

const BARS = [2, 4, 8, 16, 32];
const cache = new Map(); // id -> { buf (AudioBuffer), peaks, duration }
const BEFORE = 12; // secondes affichées avant la transition
const AFTER = 12; // et après

async function loadSound(id) {
  if (cache.has(id)) return cache.get(id);
  const data = isNative ? await (await localApi()).media.audioBuffer(id) : await fetch(`/api/audio-file/${id}`).then((r) => {
    if (!r.ok) throw new Error('son indisponible');
    return r.arrayBuffer();
  });
  const buf = await new OfflineAudioContext(2, 44100, 44100).decodeAudioData(data);
  const d = buf.getChannelData(0);
  const n = Math.ceil(buf.duration * 40); // 40 valeurs par seconde
  const step = Math.floor(d.length / n);
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = j + step; j < e; j += 4) m = Math.max(m, Math.abs(d[j]));
    peaks[i] = m;
  }
  const res = { buf, peaks, duration: buf.duration };
  cache.set(id, res);
  return res;
}

// Volume de chaque son pendant la transition (k de 0 à 1) selon le style, pour l'écoute et les courbes
function curves(style, k) {
  const c = Math.max(0, Math.min(1, k));
  switch (style) {
    case 'slam': return [c < 0.5 ? 1 : 0, c < 0.5 ? 0 : 1];
    case 'fade': return [Math.max(0, 1 - c / 0.55), Math.max(0, (c - 0.45) / 0.55)];
    case 'powerup': return [1 - c * 0.6, c < 0.8 ? c * 0.3 : 1];
    case 'echo': return [Math.max(0, 1 - c * 1.6), Math.max(0, (c - 0.5) * 2)];
    case 'none': return [c < 1 ? 1 : 0, c < 1 ? 0 : 1];
    default: return [Math.cos((c * Math.PI) / 2), Math.sin((c * Math.PI) / 2)]; // fondu à puissance constante
  }
}

export async function openMixEditor(p, a, b) {
  const key = `${a.id}_${b.id}`;
  const saved = p.transitions?.[key];
  const custom = saved && typeof saved === 'object' ? saved : null;
  automix.ensure([a.id, b.id], { urgent: true });
  let style = (custom ? custom.style : saved) || 'auto';
  const auto0 = automix.plan(a.id, b.id, 'auto');
  const beatOf = (x) => automix.get(x)?.beat || 0.5;
  let bars = custom?.bars || (auto0 ? Math.max(2, Math.round(auto0.mixLen / (4 * beatOf(a.id)))) : 8);
  let out = custom?.out ?? auto0?.mixStart ?? Math.max(0, (a.duration || 200) - 25);
  let inn = custom?.in ?? auto0?.inStart ?? 0;
  const len = () => Math.min(32, bars * 4 * beatOf(a.id));
  let A = null;
  let B = null;
  let ctx = null;
  let nodes = [];
  let playT0 = 0; // temps (frise) au lancement de l'écoute
  let ctxT0 = 0;
  let raf = 0;
  const stop = () => {
    nodes.forEach((n) => { try { n.stop(); } catch {} });
    nodes = [];
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const res = await modal({
    title: 'Transition',
    wide: true,
    body: String(html`<div class="mx2">
      <div class="mx2-head"><div class="mx2-cover" style="background-image:url('${a.thumb || ''}')"></div><div class="t-text"><b class="ellipsis">${a.title}</b><span class="muted ellipsis">${(a.artists || []).map((x) => x.name).join(', ')}</span></div><span class="mx2-meta" id="mx-ia"></span></div>
      <div class="mx2-stage" id="mx-stage">
        <canvas id="mx-ca"></canvas>
        <canvas id="mx-cb"></canvas>
        <div class="mx2-head-line" id="mx-ph"></div>
        <button type="button" class="mx2-play" id="mx-play" aria-label="Écouter la transition">${icon('play', 26)}</button>
        <button type="button" class="mx2-bars" id="mx-bars"></button>
      </div>
      <div class="mx2-head"><div class="mx2-cover" style="background-image:url('${b.thumb || ''}')"></div><div class="t-text"><b class="ellipsis">${b.title}</b><span class="muted ellipsis">${(b.artists || []).map((x) => x.name).join(', ')}</span></div><span class="mx2-meta" id="mx-ib"></span></div>
      <p class="muted mx2-hint">Fais glisser chaque son pour caler ses temps sur l'autre. A part à <b id="mx-out-l"></b>, B entre à <b id="mx-in-l"></b>.</p>
      <div class="mx-chips" id="mx-style">${Object.entries(TRANSITION_NAMES).map(([k, n]) => html`<button type="button" class="chip" data-style="${k}">${n}</button>`)}</div>
      <div class="row-flex" style="gap:8px;margin-top:12px"><button type="button" class="btn ghost sm" id="mx-reset">Revenir au réglage auto</button><span class="muted" style="font-size:12px" id="mx-note"></span></div>
    </div>`),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, value: () => 'save' }],
    onMount: (w) => {
      const $ = (s) => w.querySelector(s);
      const ca = $('#mx-ca');
      const cb = $('#mx-cb');
      const stage = $('#mx-stage');
      if (isNative && window.Capacitor?.getPlatform?.() === 'ios') $('#mx-note').textContent = 'Sur iPhone, la transition s’écoute ici, mais pendant la lecture les sons s’enchaînent directement (limite d’iOS).';
      const info = (id) => {
        const x = automix.get(id);
        return x ? `${Math.round(x.bpm)} bpm${x.camelot ? ` · ${x.camelot}` : ''}` : '';
      };
      // Frise : t = secondes par rapport au début de la transition (0) ; A y est placé à out, B à inn
      const span = () => BEFORE + len() + AFTER;
      const tx = (t, W) => ((t + BEFORE) / span()) * W;
      const drawOne = (c, snd, offset, color, id, top) => {
        const g = c.getContext('2d');
        const W = (c.width = c.clientWidth * devicePixelRatio);
        const H = (c.height = c.clientHeight * devicePixelRatio);
        g.clearRect(0, 0, W, H);
        // Zone de transition
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(tx(0, W), 0, tx(len(), W) - tx(0, W), H);
        // Grille des temps (fine) et des mesures (marquée)
        const an = automix.get(id);
        if (an?.beat) {
          const t0 = -BEFORE + offset;
          let k = Math.ceil((t0 - an.firstBeat) / an.beat);
          for (let s = an.firstBeat + k * an.beat; s < offset + len() + AFTER; s += an.beat, k++) {
            const x = tx(s - offset, W);
            g.fillStyle = k % 4 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)';
            g.fillRect(x, 0, k % 4 === 0 ? 1.5 * devicePixelRatio : devicePixelRatio, H);
          }
        }
        // Forme d'onde
        if (snd) {
          g.fillStyle = color;
          for (let px = 0; px < W; px += 2 * devicePixelRatio) {
            const s = -BEFORE + (px / W) * span() + offset;
            if (s < 0 || s >= snd.duration) continue;
            const v = snd.peaks[Math.floor(s * 40)] || 0;
            const h = Math.max(1, v * H * 0.85);
            g.fillRect(px, (H - h) / 2, 1.4 * devicePixelRatio, h);
          }
        }
        // Courbe de volume pendant la transition
        g.strokeStyle = top ? '#ff9ad5' : '#ffd36b';
        g.lineWidth = 2 * devicePixelRatio;
        g.beginPath();
        for (let i = 0; i <= 40; i++) {
          const k = i / 40;
          const v = curves(style === 'auto' ? auto0?.style || 'crossfade' : style, k)[top ? 0 : 1];
          const x = tx(k * len(), W);
          const y = H * 0.9 - v * H * 0.8;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      };
      const paint = () => {
        drawOne(ca, A, out, '#f0a35e', a.id, true);
        drawOne(cb, B, inn, '#6f8cff', b.id, false);
        $('#mx-out-l').textContent = fmtTime(out);
        $('#mx-in-l').textContent = fmtTime(inn);
        $('#mx-bars').textContent = `${bars} mesures ▾`;
        $('#mx-ia').textContent = info(a.id);
        $('#mx-ib').textContent = info(b.id);
        w.querySelectorAll('[data-style]').forEach((x) => x.classList.toggle('active', x.dataset.style === style));
      };
      // Glisser un son : la frise bouge sous le doigt / la souris, calée sur les temps à la fin
      const snap = (id, t) => {
        const an = automix.get(id);
        return an?.beat ? an.firstBeat + Math.round((t - an.firstBeat) / an.beat) * an.beat : t;
      };
      const drag = (c, which) => {
        let x0 = null;
        let v0 = 0;
        c.addEventListener('pointerdown', (e) => {
          x0 = e.clientX;
          v0 = which === 'a' ? out : inn;
          c.setPointerCapture(e.pointerId);
          stop();
        });
        c.addEventListener('pointermove', (e) => {
          if (x0 == null) return;
          const dt = ((x0 - e.clientX) / c.clientWidth) * span();
          if (which === 'a') out = Math.max(5, Math.min((A?.duration || a.duration || 240) - 1, v0 + dt));
          else inn = Math.max(0, Math.min((B?.duration || b.duration || 240) - 5, v0 + dt));
          paint();
        });
        const end = () => {
          if (x0 == null) return;
          x0 = null;
          if (which === 'a') out = snap(a.id, out);
          else inn = Math.max(0, snap(b.id, inn));
          paint();
        };
        c.addEventListener('pointerup', end);
        c.addEventListener('pointercancel', end);
      };
      drag(ca, 'a');
      drag(cb, 'b');
      // Écoute dans l'éditeur : A puis B mélangés selon les courbes, curseur qui avance
      const ph = $('#mx-ph');
      const play = () => {
        if (raf) return (stop(), ($('#mx-play').innerHTML = String(icon('play', 26))), (ph.style.display = 'none'));
        if (!A || !B) return toast('Chargement des sons…');
        ctx ||= new (window.AudioContext || window.webkitAudioContext)();
        ctx.resume?.();
        const L = len();
        const st = style === 'auto' ? auto0?.style || 'crossfade' : style;
        const from = -Math.min(BEFORE, out); // secondes avant la transition
        const now = ctx.currentTime + 0.05;
        const voice = (snd, startAt, offset, which) => {
          const src = ctx.createBufferSource();
          src.buffer = snd.buf;
          const g = ctx.createGain();
          src.connect(g).connect(ctx.destination);
          // Courbe de volume échantillonnée
          const steps = 60;
          const vals = new Float32Array(steps + 1);
          for (let i = 0; i <= steps; i++) vals[i] = curves(st, i / steps)[which];
          g.gain.setValueAtTime(which === 0 ? 1 : vals[0], now);
          g.gain.setValueCurveAtTime(vals, now + Math.max(0, -from), L);
          src.start(now + startAt, Math.max(0, offset));
          nodes.push(src);
        };
        voice(A, 0, out + from, 0);
        voice(B, Math.max(0, -from), inn, 1);
        playT0 = from;
        ctxT0 = now;
        $('#mx-play').innerHTML = String(icon('pause', 26));
        ph.style.display = 'block';
        const tick = () => {
          const t = playT0 + (ctx.currentTime - ctxT0);
          if (t > L + AFTER) return play();
          ph.style.left = `${((t + BEFORE) / span()) * 100}%`;
          raf = requestAnimationFrame(tick);
        };
        tick();
      };
      $('#mx-play').onclick = play;
      $('#mx-bars').onclick = (e) => {
        e.stopPropagation();
        const i = BARS.indexOf(bars);
        bars = BARS[(i + 1) % BARS.length];
        stop();
        paint();
      };
      w.querySelectorAll('[data-style]').forEach((x) => (x.onclick = () => ((style = x.dataset.style), paint())));
      $('#mx-reset').onclick = () => {
        const pl = automix.plan(a.id, b.id, 'auto');
        style = 'auto';
        if (pl) ((out = pl.mixStart), (inn = pl.inStart), (bars = Math.max(2, Math.round(pl.mixLen / (4 * beatOf(a.id))))));
        paint();
      };
      const unsub = automix.onAnalyzed(() => paint());
      new MutationObserver(() => !document.body.contains(stage) && (stop(), unsub(), ctx?.close().catch(() => {}))).observe(document.body, { childList: true, subtree: true });
      paint();
      loadSound(a.id).then((x) => ((A = x), paint())).catch(() => toast(`« ${a.title} » : son indisponible pour l’aperçu`));
      loadSound(b.id).then((x) => ((B = x), paint())).catch(() => toast(`« ${b.title} » : son indisponible pour l’aperçu`));
    },
  });
  stop();
  if (res !== 'save') return false;
  const value = style === 'none' ? 'none' : { style, bars, out: Math.round(out * 100) / 100, in: Math.round(inn * 100) / 100 };
  await updatePlaylist(p.id, { [`transitions.${key}`]: value });
  p.transitions = { ...(p.transitions || {}), [key]: value };
  player._planNext?.();
  toast('Transition enregistrée');
  return true;
}
