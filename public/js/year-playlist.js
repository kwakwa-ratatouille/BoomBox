// Playlist « Ton top {année} » (façon Spotify) : tes titres les plus écoutés de l'année, avec le nombre d'écoutes
// en jaune sur chaque titre, une pochette et une bannière festives pailletées qui changent chaque année.
import { getStatsFull, createPlaylist, state, ls } from './state.js';
import { modal, toast } from './ui.js';

// Générateur pseudo-aléatoire stable : les mêmes paillettes pour une même année, d'autres l'année suivante
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// Thème de l'année : couleur de fond qui tourne d'une année à l'autre, paillettes toujours dorées
function theme(year) {
  const hues = [282, 220, 340, 160, 18, 255, 195, 320, 45, 130];
  const h = hues[year % hues.length];
  return { bg1: `hsl(${h} 70% 16%)`, bg2: `hsl(${(h + 40) % 360} 75% 32%)`, accent: `hsl(${(h + 180) % 360} 90% 65%)` };
}

function draw(year, w, h, { title = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  const t = theme(year);
  const r = rng(year * 7919);
  // Fond en dégradé
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, t.bg1);
  g.addColorStop(1, t.bg2);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  // Halo lumineux
  const halo = x.createRadialGradient(w * (0.3 + r() * 0.4), h * 0.35, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  halo.addColorStop(0, 'rgba(255, 220, 120, 0.35)');
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  x.fillStyle = halo;
  x.fillRect(0, 0, w, h);
  // Confettis dorés (bandes) et paillettes (points brillants)
  const golds = ['#ffd96a', '#f5c542', '#fff1b8', '#e8a920', '#ffe9a0', t.accent];
  // Guirlandes dorées verticales (façon rideau à paillettes)
  for (let i = 0; i < w / 6; i++) {
    const gx = r() * w;
    const lg = x.createLinearGradient(gx, 0, gx, h);
    lg.addColorStop(0, 'rgba(255, 230, 150, 0)');
    lg.addColorStop(0.3 + r() * 0.4, 'rgba(255, 215, 90, ' + (0.15 + r() * 0.35) + ')');
    lg.addColorStop(1, 'rgba(255, 230, 150, 0)');
    x.fillStyle = lg;
    x.fillRect(gx, 0, 1 + r() * 3, h * (0.5 + r() * 0.5));
  }
  for (let i = 0; i < (w * h) / 220; i++) {
    x.save();
    x.translate(r() * w, r() * h);
    x.rotate(r() * Math.PI);
    x.globalAlpha = 0.35 + r() * 0.6;
    x.fillStyle = golds[Math.floor(r() * golds.length)];
    if (r() < 0.35) x.fillRect(0, 0, 2 + r() * 10, 1 + r() * 3);
    else {
      x.beginPath();
      x.arc(0, 0, 0.6 + r() * 2.2, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }
  // Étoiles scintillantes
  x.globalAlpha = 1;
  for (let i = 0; i < Math.max(6, (w * h) / 40000); i++) {
    const sx = r() * w;
    const sy = r() * h;
    const s = 4 + r() * Math.min(w, h) * 0.025;
    const sg = x.createRadialGradient(sx, sy, 0, sx, sy, s * 2);
    sg.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
    sg.addColorStop(1, 'rgba(255, 220, 120, 0)');
    x.fillStyle = sg;
    x.fillRect(sx - s * 2, sy - s * 2, s * 4, s * 4);
    x.fillStyle = '#fffbe8';
    x.fillRect(sx - s, sy - 0.6, s * 2, 1.2);
    x.fillRect(sx - 0.6, sy - s, 1.2, s * 2);
  }
  if (title) {
    // Année en grand, dorée
    const size = Math.min(w * 0.36, h * 0.42);
    x.font = `900 ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const tg = x.createLinearGradient(0, h / 2 - size / 2, 0, h / 2 + size / 2);
    tg.addColorStop(0, '#fff6cf');
    tg.addColorStop(0.45, '#ffd34d');
    tg.addColorStop(1, '#c98a12');
    x.shadowColor = 'rgba(0, 0, 0, 0.45)';
    x.shadowBlur = size * 0.12;
    x.fillStyle = tg;
    x.fillText(String(year), w / 2, h * 0.56);
    x.shadowBlur = 0;
    x.font = `800 ${size * 0.2}px "Plus Jakarta Sans", system-ui, sans-serif`;
    x.fillStyle = '#fff';
    x.fillText('TON TOP', w / 2, h * 0.56 - size * 0.62);
  }
  return c.toDataURL('image/jpeg', 0.82);
}

export async function createYearPlaylist(year = new Date().getFullYear()) {
  const range = { since: new Date(year, 0, 1).getTime(), until: Math.min(Date.now(), new Date(year + 1, 0, 1).getTime() - 1) };
  const st = await getStatsFull(0, range, 100);
  const top = (st?.topTracks || []).filter((t) => t.track?.id);
  if (!top.length) throw new Error(`Pas assez d'écoutes en ${year} pour faire ta playlist`);
  const playCounts = Object.fromEntries(top.map((t) => [t.track.id, t.count]));
  const p = await createPlaylist(`Ton top ${year}`, top.map((t) => t.track), `La crème de tes titres les plus écoutés en ${year}, conçue pour ${state.profile.name}.`, {
    cover: draw(year, 600, 600),
    banner: draw(year, 1200, 400, { title: false }),
    playCounts,
    topYear: year,
  });
  ls.set(`boombox.yearPl.${year}`, p.id);
  return p;
}

// Le jour du récap de l'année (à partir du 1er décembre) : on propose une fois de créer la playlist
export async function offerYearPlaylist() {
  const y = new Date().getFullYear();
  if (new Date().getMonth() !== 11 || ls.get(`boombox.yearPl.${y}`, null) || ls.get(`boombox.yearPlAsked.${y}`, false)) return;
  if (state.library.playlists.some((p) => p.topYear === y)) return;
  ls.set(`boombox.yearPlAsked.${y}`, true);
  const ok = await modal({
    title: `✨ Ta playlist « Ton top ${y} »`,
    body: `<div class="yp-preview" style="background-image:url('${draw(y, 600, 300, { title: true })}')"></div><p>Tes titres les plus écoutés de l'année, avec le nombre d'écoutes de chacun. Tu la veux dans ta bibliothèque ?</p>`,
    actions: [{ label: 'Non merci' }, { label: 'Créer ma playlist', primary: true, value: () => 'ok' }],
  });
  if (ok !== 'ok') return;
  await makeAndOpen(y);
}

export async function makeAndOpen(y) {
  try {
    toast(`Création de « Ton top ${y} »…`);
    const p = await createYearPlaylist(y);
    location.hash = `#/playlist/${p.id}`;
  } catch (e) {
    toast(e.message);
  }
}
