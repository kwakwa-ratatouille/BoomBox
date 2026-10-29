// Éditeur de transition (comme l'éditeur de mix de Spotify) : les formes d'onde de la fin du son A et du début du
// son B, et ce qu'on règle soi-même : le style, la durée (en mesures), le moment où A part et celui où B entre.
// Enregistré dans la playlist (transitions["A_B"] = { style, bars, out, in }), joué tel quel par le lecteur.
import { state, updatePlaylist } from './state.js';
import { player, ctl, TRANSITION_NAMES } from './player.js';
import { automix } from './automix.js';
import { modal, html, toast, fmtTime, icon } from './ui.js';
import { isNative, localApi } from './native.js';

const BARS = [2, 4, 8, 16, 32];
const peaksCache = new Map();

// Forme d'onde : volume max par petite tranche (600 tranches sur tout le son)
async function peaks(id) {
  if (peaksCache.has(id)) return peaksCache.get(id);
  const buf = isNative ? await (await localApi()).media.audioBuffer(id) : await fetch(`/api/audio-file/${id}`).then((r) => {
    if (!r.ok) throw new Error('son indisponible');
    return r.arrayBuffer();
  });
  const audio = await new OfflineAudioContext(1, 22050, 22050).decodeAudioData(buf);
  const d = audio.getChannelData(0);
  const n = 600;
  const step = Math.floor(d.length / n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = j + step; j < e; j += 8) m = Math.max(m, Math.abs(d[j]));
    out[i] = m;
  }
  const res = { p: out, duration: audio.duration };
  peaksCache.set(id, res);
  return res;
}

// Dessine une partie [from, to] (secondes) d'une forme d'onde, la zone de transition [z0, z1] surlignée
function draw(canvas, w, from, to, z0, z1, color) {
  const g = canvas.getContext('2d');
  const W = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const H = (canvas.height = canvas.clientHeight * devicePixelRatio);
  g.clearRect(0, 0, W, H);
  const x = (t) => ((t - from) / (to - from)) * W;
  g.fillStyle = 'rgba(176,124,247,0.16)';
  g.fillRect(x(z0), 0, Math.max(2, x(z1) - x(z0)), H);
  if (!w) return;
  const n = w.p.length;
  g.fillStyle = color;
  for (let px = 0; px < W; px += 2 * devicePixelRatio) {
    const t = from + (px / W) * (to - from);
    if (t < 0 || t > w.duration) continue;
    const v = w.p[Math.min(n - 1, Math.floor((t / w.duration) * n))] || 0;
    const h = Math.max(1, v * H * 0.92);
    g.fillRect(px, (H - h) / 2, 1.4 * devicePixelRatio, h);
  }
  g.fillStyle = '#2ef28b';
  g.fillRect(x(z0) - 1, 0, 2 * devicePixelRatio, H);
}

export async function openMixEditor(p, a, b) {
  const key = `${a.id}_${b.id}`;
  const saved = p.transitions?.[key];
  const custom = saved && typeof saved === 'object' ? saved : null;
  await automix.ensure([a.id, b.id], { urgent: true });
  let style = (custom ? custom.style : saved) || 'auto';
  const auto = automix.plan(a.id, b.id, style === 'auto' ? 'auto' : style) || null;
  const aInfo = automix.get(a.id);
  const bInfo = automix.get(b.id);
  const beat = aInfo?.beat || 0.5;
  let bars = custom?.bars || (auto ? Math.max(2, Math.round(auto.mixLen / (4 * beat))) : 8);
  let out = custom?.out ?? auto?.mixStart ?? Math.max(0, (a.duration || 200) - 20);
  let inn = custom?.in ?? auto?.inStart ?? 0;
  const len = () => Math.min(32, bars * 4 * beat);
  let wa = null;
  let wb = null;
  const names = Object.entries(TRANSITION_NAMES);
  const res = await modal({
    title: 'Transition',
    wide: true,
    body: String(html`<div class="mx-ed">
      <div class="mx-track"><b class="ellipsis">${a.title}</b><span class="muted" id="mx-a-info"></span></div>
      <canvas class="mx-wave" id="mx-wa"></canvas>
      <label class="mx-row"><span>A commence à partir à <b id="mx-out-l"></b></span><input type="range" id="mx-out" step="0.1"></label>
      <div class="mx-mid">
        <div class="mx-chips" id="mx-bars">${BARS.map((n) => html`<button type="button" class="chip" data-bars="${n}">${n} mesures</button>`)}</div>
        <span class="muted" id="mx-len"></span>
      </div>
      <canvas class="mx-wave" id="mx-wb"></canvas>
      <div class="mx-track"><b class="ellipsis">${b.title}</b><span class="muted" id="mx-b-info"></span></div>
      <label class="mx-row"><span>B entre à <b id="mx-in-l"></b> de son début</span><input type="range" id="mx-in" step="0.1"></label>
      <h3>Style</h3>
      <div class="mx-chips" id="mx-style">${names.map(([k, n]) => html`<button type="button" class="chip" data-style="${k}">${n}</button>`)}</div>
      <div class="row-flex" style="gap:8px;margin-top:16px;flex-wrap:wrap"><button type="button" class="btn ghost" id="mx-play">${icon('play', 16)} Écouter la transition</button><button type="button" class="btn ghost" id="mx-reset">Revenir au réglage auto</button></div>
      <p class="muted" style="font-size:12px;margin-bottom:0" id="mx-note"></p>
    </div>`),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, value: () => 'save' }],
    onMount: (w) => {
      const $ = (s) => w.querySelector(s);
      const info = (x) => (x ? `${Math.round(x.bpm)} bpm${x.camelot ? ` · ${x.camelot}` : ''}` : 'analyse…');
      $('#mx-a-info').textContent = info(aInfo);
      $('#mx-b-info').textContent = info(bInfo);
      $('#mx-note').textContent = isNative && window.Capacitor?.getPlatform?.() === 'ios'
        ? 'Sur iPhone, iOS ne laisse pas jouer deux sons en même temps : les transitions s’entendent sur PC et Android, l’iPhone enchaîne les sons directement.'
        : 'Les points sont calés sur les temps forts quand le son est analysé.';
      const dA = () => wa?.duration || a.duration || 240;
      const dB = () => wb?.duration || b.duration || 240;
      const snapA = (t) => (aInfo?.beat ? aInfo.firstBeat + Math.round((t - aInfo.firstBeat) / aInfo.beat) * aInfo.beat : t);
      const snapB = (t) => (bInfo?.beat ? Math.max(0, bInfo.firstBeat + Math.round((t - bInfo.firstBeat) / bInfo.beat) * bInfo.beat) : t);
      const paint = () => {
        const L = len();
        out = Math.min(out, dA() - 1);
        $('#mx-out').min = Math.max(0, dA() - 120);
        $('#mx-out').max = Math.max(1, dA() - 1);
        $('#mx-out').value = out;
        $('#mx-in').min = 0;
        $('#mx-in').max = Math.min(90, dB() - 5);
        $('#mx-in').value = inn;
        $('#mx-out-l').textContent = fmtTime(out);
        $('#mx-in-l').textContent = fmtTime(inn);
        $('#mx-len').textContent = `${Math.round(L)} s`;
        w.querySelectorAll('[data-bars]').forEach((x) => x.classList.toggle('active', +x.dataset.bars === bars));
        w.querySelectorAll('[data-style]').forEach((x) => x.classList.toggle('active', x.dataset.style === style));
        // A : 30 s avant le départ jusqu'à la fin ; B : du début jusqu'à 30 s après la fin de la transition
        draw($('#mx-wa'), wa, out - 25, Math.min(dA(), out + L + 10), out, out + L, '#f0a35e');
        draw($('#mx-wb'), wb, Math.max(0, inn - 10), inn + L + 25, inn, inn + L, '#6f8cff');
      };
      $('#mx-out').oninput = (e) => ((out = snapA(+e.target.value)), paint());
      $('#mx-in').oninput = (e) => ((inn = snapB(+e.target.value)), paint());
      w.querySelectorAll('[data-bars]').forEach((x) => (x.onclick = () => ((bars = +x.dataset.bars), paint())));
      w.querySelectorAll('[data-style]').forEach((x) => (x.onclick = () => ((style = x.dataset.style), paint())));
      $('#mx-reset').onclick = () => {
        const pl = automix.plan(a.id, b.id, 'auto');
        style = 'auto';
        if (pl) ((out = pl.mixStart), (inn = pl.inStart), (bars = Math.max(2, Math.round(pl.mixLen / (4 * beat)))));
        paint();
      };
      // Écoute : la playlist se lance sur A, quelques secondes avant le départ de la transition (réglage en cours)
      $('#mx-play').onclick = async () => {
        await save(true);
        const i = p.tracks.findIndex((t) => t.id === a.id);
        ctl.playList(p.tracks, Math.max(0, i), { type: 'playlist', id: p.id, name: p.name });
        const t0 = Date.now();
        const go = setInterval(() => {
          if (Date.now() - t0 > 20e3) return clearInterval(go);
          if (player.track?.id === a.id && !player.paused && player.time() > 0.2) {
            clearInterval(go);
            ctl.seek(Math.max(0, out - 6));
          }
        }, 300);
      };
      paint();
      peaks(a.id).then((x) => ((wa = x), paint())).catch(() => {});
      peaks(b.id).then((x) => ((wb = x), paint())).catch(() => {});
    },
  });
  async function save(quiet = false) {
    const value = style === 'none' ? 'none' : { style, bars, out: Math.round(out * 100) / 100, in: Math.round(inn * 100) / 100 };
    await updatePlaylist(p.id, { [`transitions.${key}`]: value });
    // Mise à jour locale tout de suite (sans attendre la synchro) pour que le lecteur et l'écran suivent
    p.transitions = { ...(p.transitions || {}), [key]: value };
    player._planNext?.();
    if (!quiet) toast('Transition enregistrée');
  }
  if (res === 'save') await save();
  return res === 'save';
}
