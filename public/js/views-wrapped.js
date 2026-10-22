// Récap animé façon Spotify Wrapped : des cartes verticales (format Story), plein de couleur, grosses typos,
// formes qui bougent, chiffres qui défilent. Chaque carte se partage en image : Story (9:16) ou post Insta (4:5).
// Les cartes sont décrites par des données ; le même modèle sert à l'affichage animé et à l'image exportée.
import { html, icon, plural, toast } from './ui.js';
import { getStatsFull, createPlaylist, listeningYears } from './state.js';
import { ctl } from './player.js';
import { loadImg, shareStory, pixelDeco, shareFile, copyImage } from './story.js';
import { pixelBackdrop } from './pixel-bg.js';

const fmtN = (n) => Math.round(n || 0).toLocaleString('fr-FR');

// Directions artistiques par période (chaque période a son ambiance, et chaque semaine / mois / année varie :
// l'ordre des couleurs et les formes dépendent de la date). bg → bg2 : dégradé de fond ; fg : texte ; shape / alt : formes.
const DESIGNS = {
  // Journée : lever de soleil, pastel, formes rondes et douces
  day: { shapes: ['blobs', 'sun', 'bubbles'], palettes: [
    { bg: '#ffd6c9', bg2: '#ffb4d0', fg: '#3a0d2e', shape: '#ff8fab', alt: '#ffe39f' },
    { bg: '#d9c8ff', bg2: '#ffd1e8', fg: '#2b1055', shape: '#b07cf7', alt: '#ffb4a2' },
    { bg: '#c9f2ff', bg2: '#e2d4ff', fg: '#0d2a3a', shape: '#7ad3ff', alt: '#ffc6e4' },
    { bg: '#fff1b8', bg2: '#ffc9a8', fg: '#3a2200', shape: '#ff9f6b', alt: '#c9b6ff' },
    { bg: '#d2ffe0', bg2: '#c8e7ff', fg: '#0f3324', shape: '#64e3a1', alt: '#ffd1f0' },
  ] },
  // Semaine : club, fond sombre, néons, anneaux et rayures
  week: { shapes: ['rings', 'stripes', 'grid'], palettes: [
    { bg: '#0b0618', bg2: '#22104a', fg: '#ffffff', shape: '#ff2bd6', alt: '#22f0ff' },
    { bg: '#050b1a', bg2: '#0d2a4a', fg: '#e8ff4d', shape: '#2bff88', alt: '#7c4dff' },
    { bg: '#140010', bg2: '#3a0030', fg: '#ffffff', shape: '#ff5c39', alt: '#ff2bd6' },
    { bg: '#03140f', bg2: '#08362a', fg: '#c6ff4d', shape: '#c6ff4d', alt: '#22f0ff' },
    { bg: '#0f0a24', bg2: '#2a1a5e', fg: '#ffffff', shape: '#b07cf7', alt: '#ffd23f' },
  ] },
  // Mois : affiche bicolore, couleurs franches, carrés et vagues
  month: { shapes: ['squares', 'waves', 'half'], palettes: [
    { bg: '#ff4d2e', bg2: '#ff4d2e', fg: '#1a0600', shape: '#ffd23f', alt: '#1a0600' },
    { bg: '#1f3cff', bg2: '#1f3cff', fg: '#ffffff', shape: '#ff9ad5', alt: '#c6ff4d' },
    { bg: '#ffd23f', bg2: '#ffd23f', fg: '#14002e', shape: '#7c3aed', alt: '#ff4d8d' },
    { bg: '#0f8a5f', bg2: '#0f8a5f', fg: '#fff6d6', shape: '#ffb800', alt: '#ff6ad5' },
    { bg: '#b07cf7', bg2: '#b07cf7', fg: '#14002e', shape: '#ff4d8d', alt: '#f5d33f' },
    { bg: '#ff6ad5', bg2: '#ff6ad5', fg: '#1a0013', shape: '#2b2bff', alt: '#fff36b' },
  ] },
  // Année : le grand Wrapped, dégradés vifs et toutes les formes
  year: { shapes: ['blobs', 'rings', 'stripes', 'squares', 'waves', 'sun'], palettes: [
    { bg: '#b07cf7', bg2: '#ff4d8d', fg: '#14002e', shape: '#f5d33f', alt: '#22d3ee' },
    { bg: '#1e1b4b', bg2: '#4c1d95', fg: '#ffffff', shape: '#22d3ee', alt: '#ff4d8d' },
    { bg: '#ff4d8d', bg2: '#ff9f2e', fg: '#1a0010', shape: '#f5d33f', alt: '#1e1b4b' },
    { bg: '#0f3d2e', bg2: '#14532d', fg: '#c6ff4d', shape: '#c6ff4d', alt: '#ff4d8d' },
    { bg: '#f5d33f', bg2: '#ff9f2e', fg: '#1a1400', shape: '#7c3aed', alt: '#ff4d8d' },
    { bg: '#111111', bg2: '#2a2a2a', fg: '#ffffff', shape: '#b07cf7', alt: '#22d3ee' },
    { bg: '#22d3ee', bg2: '#7c3aed', fg: '#04212a', shape: '#ff4d8d', alt: '#fff36b' },
  ] },
};
// Graine de la période (jour, n° de semaine, mois, année) : change les couleurs et les formes d'une fois sur l'autre
const periodSeed = (period, since) => {
  const d = new Date(since);
  if (period === 'day') return d.getFullYear() * 400 + Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400e3);
  if (period === 'week') return Math.floor(since / (7 * 86400e3));
  if (period === 'month') return d.getFullYear() * 12 + d.getMonth();
  return d.getFullYear();
};
function themesFor(period, seed) {
  const D = DESIGNS[period] || DESIGNS.year;
  return (i) => ({ ...D.palettes[(i + seed * 3) % D.palettes.length], shapeSet: D.shapes[(i + seed) % D.shapes.length] });
}
const THEMES = DESIGNS.year.palettes; // couleurs du choix de période
// Profil d'auditeur selon les habitudes
export function persona(s) {
  const night = s.hours.slice(21).concat(s.hours.slice(0, 4)).reduce((a, b) => a + b, 0);
  const morning = s.hours.slice(5, 10).reduce((a, b) => a + b, 0);
  const totalH = s.hours.reduce((a, b) => a + b, 0) || 1;
  const topShare = (s.topArtists[0]?.count || 0) / (s.plays || 1);
  if (topShare > 0.25) return { name: 'Le fidèle', emoji: '💜', text: `Plus d'une écoute sur quatre pour ${s.topArtists[0].artist.name}. Quand tu aimes, tu ne comptes pas.` };
  if (night / totalH > 0.35) return { name: 'Le noctambule', emoji: '🌙', text: 'Ta musique s’allume quand la ville s’éteint.' };
  if (morning / totalH > 0.35) return { name: 'Le lève-tôt', emoji: '☀️', text: 'Tu démarres la journée en musique.' };
  if (s.uniqueArtists > 150 || s.discoveries.length > 20) return { name: "L'explorateur", emoji: '🧭', text: `${fmtN(s.uniqueArtists)} artistes différents : toujours à la recherche du prochain son.` };
  return { name: 'Le passionné', emoji: '🎧', text: 'Un peu de tout, beaucoup de musique : ta bande-son t’accompagne partout.' };
}

// Le Wrapped de l'année en cours s'ouvre le 1er décembre (comme Spotify) ; les années passées, toujours.
export const yearWrappedReady = (y = new Date().getFullYear()) => y < new Date().getFullYear() || new Date().getMonth() === 11;

// Période d'un récap : journée, semaine, mois ou année
export function wrappedRange(period, year) {
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'day') return { since: d0.getTime(), until: Date.now(), label: 'Ta journée', tag: "aujourd'hui", name: `du ${now.toLocaleDateString('fr-FR')}`, short: "Aujourd'hui" };
  if (period === 'week') {
    const since = new Date(d0);
    since.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
    return { since: since.getTime(), until: Date.now(), label: 'Ta semaine', tag: 'cette semaine', name: 'de la semaine', short: 'Cette semaine' };
  }
  if (period === 'month') {
    const m = now.toLocaleDateString('fr-FR', { month: 'long' });
    const de = /^[aeiouâéèêhô]/i.test(m) ? `d'${m}` : `de ${m}`;
    return { since: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), until: Date.now(), label: `Ton mois ${de}`, tag: `en ${m}`, name: de, short: m[0].toUpperCase() + m.slice(1) };
  }
  return { since: new Date(year, 0, 1).getTime(), until: Math.min(Date.now(), new Date(year + 1, 0, 1).getTime() - 1), label: `Ton ${year}`, tag: `en ${year}`, name: `${year}`, short: String(year) };
}

function chooser(el) {
  const y = new Date().getFullYear();
  el.innerHTML = String(html`<div class="page" style="max-width:820px"><h1>Ton récap en musique</h1><p class="muted">Choisis la période : un récap animé avec tes artistes, tes titres et tes chiffres, à partager en Story ou en post.</p>
    <div class="w-choose">
      <a class="w-pick" href="#/wrapped?period=day" style="background:${THEMES[0].bg};color:${THEMES[0].fg}"><b>Aujourd'hui</b><span>Ta journée</span></a>
      <a class="w-pick" href="#/wrapped?period=week" style="background:${THEMES[2].bg};color:${THEMES[2].fg}"><b>Cette semaine</b><span>Depuis lundi</span></a>
      <a class="w-pick" href="#/wrapped?period=month" style="background:${THEMES[4].bg};color:${THEMES[4].fg}"><b>Ce mois-ci</b><span>${new Date().toLocaleDateString('fr-FR', { month: 'long' })}</span></a>
    </div>
    <h2 style="margin:28px 0 12px">Par année</h2>
    <div class="w-years" id="w-years"><span class="muted">…</span></div>
  </div>`);
  // Seulement les années où tu as écouté (Boombox ou historique Spotify importé)
  listeningYears().then((years) => {
    const box = el.querySelector('#w-years');
    if (!box) return;
    box.onclick = (e) => {
      const b = e.target.closest('[data-yp]');
      if (b) import('./year-playlist.js').then((m) => m.makeAndOpen(Number(b.dataset.yp)));
    };
    box.innerHTML = String(html`${years.map((yy) => (yearWrappedReady(yy) ? html`<a class="w-year" href="#/wrapped?year=${yy}">${yy}</a>` : html`<span class="w-year off" title="Disponible le 1er décembre">${yy}<small>prêt le 1er déc.</small></span>`))}
      ${years.filter((yy) => yearWrappedReady(yy)).slice(0, 1).map((yy) => html`<button class="w-year w-yp" data-yp="${yy}"><b>🎉 Playlist</b><small>Ton top ${yy}</small></button>`)}
      ${years.length < 2 ? html`<a class="w-year w-import" href="#/import"><b>+ Années d'avant</b><small>Importe ton historique Spotify</small></a>` : ''}`);
  });
}

// ---------- Les cartes (données) ----------
function buildCards(s, range, period) {
  const p = persona(s);
  const favHour = s.hours.indexOf(Math.max(...s.hours));
  const favDay = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][s.weekdays.indexOf(Math.max(...s.weekdays))];
  const a1 = s.topArtists[0];
  const t1 = s.topTracks[0];
  const names = (t) => (t.artists || []).map((a) => a.name).join(', ');
  const tag = range.tag || 'ces derniers temps';
  const cards = [
    { kind: 'intro', kicker: 'Boombox Wrapped', big: `${range.label}\nen musique`, sub: 'Prêt·e ? On y va.' },
    { kind: 'number', kicker: `${tag[0].toUpperCase()}${tag.slice(1)}, tu as écouté`, num: s.minutes, unit: 'minutes', sub: `soit ${s.minutes >= 1440 ? plural(Math.round(s.minutes / 1440), 'jour') : `${Math.max(1, Math.round(s.minutes / 60))} h`} de musique, en ${plural(s.plays, 'écoute')}` },
    a1 && { kind: 'hero', kicker: 'Ton artiste n°1', big: a1.artist.name, img: a1.thumb, round: true, sub: `${plural(a1.count, 'écoute')} · ${fmtN(a1.seconds / 60)} minutes ensemble` },
    s.topArtists.length > 1 && { kind: 'list', kicker: 'Tes artistes préférés', items: s.topArtists.slice(0, 5).map((a) => ({ title: a.artist.name, sub: plural(a.count, 'écoute'), img: a.thumb, round: true })) },
    t1 && { kind: 'hero', kicker: period === 'year' ? "Ton titre de l'année" : 'Ton titre n°1', big: t1.track.title, img: t1.track.thumb, sub: `${names(t1.track)} · ${plural(t1.count, 'écoute')}`, play: true },
    s.topTracks.length > 1 && { kind: 'list', kicker: 'Tes titres préférés', items: s.topTracks.slice(0, 5).map((t) => ({ title: t.track.title, sub: names(t.track), img: t.track.thumb })) },
    s.hours.some(Boolean) && { kind: 'number', kicker: 'Ton moment préféré', num: favHour, unit: 'h', plain: true, sub: `c'est l'heure où tu écoutes le plus · ton jour favori : le ${favDay}` },
    s.discoveries.length && { kind: 'number', kicker: 'Tes découvertes', num: s.discoveries.length, unit: s.discoveries.length > 1 ? 'nouveaux artistes' : 'nouvel artiste', sub: `dont ${s.discoveries[0].artist.name}, ta plus belle trouvaille`, faces: s.discoveries.slice(0, 5).map((a) => a.thumb) },
    { kind: 'persona', kicker: "Ton profil d'auditeur", emoji: p.emoji, big: p.name, sub: p.text },
    { kind: 'summary', kicker: `${range.label.replace(/^Ton |^Ta |^Mes /, (m) => (m === 'Ta ' ? 'Ma ' : m === 'Mes ' ? 'Mes ' : 'Mon '))} sur Boombox`, stats: [['Minutes', fmtN(s.minutes)], ['Artistes', fmtN(s.uniqueArtists)], ['Titres', fmtN(s.uniqueTracks)]], artists: s.topArtists.slice(0, 5).map((a) => a.artist.name), tracks: s.topTracks.slice(0, 5).map((t) => t.track.title), img: a1?.thumb, persona: `${p.emoji} ${p.name}` },
  ].filter(Boolean);
  const theme = themesFor(period, periodSeed(period, range.since || Date.now()));
  cards.forEach((c, i) => (c.theme = theme(i)));
  return { cards, p, t1 };
}

// ---------- Affichage animé (DOM) ----------
// Formes de fond : une famille par période (douces le jour, néon la semaine, affiche le mois, tout l'année)
const SHAPES = {
  blobs: html`<i class="wr-blob b1"></i><i class="wr-blob b2"></i>`,
  sun: html`<i class="wr-sun"></i><i class="wr-ring r2"></i>`,
  bubbles: html`<i class="wr-bub u1"></i><i class="wr-bub u2"></i><i class="wr-bub u3"></i><i class="wr-bub u4"></i><i class="wr-bub u5"></i>`,
  rings: html`<i class="wr-ring r1"></i><i class="wr-ring r2"></i><i class="wr-dot"></i>`,
  stripes: html`<i class="wr-stripes"></i><i class="wr-blob b3"></i>`,
  grid: html`<i class="wr-grid"></i><i class="wr-ring r1"></i>`,
  squares: html`<i class="wr-square q1"></i><i class="wr-square q2"></i>`,
  waves: html`<i class="wr-wave w1"></i><i class="wr-wave w2"></i>`,
  half: html`<i class="wr-half h1"></i><i class="wr-half h2"></i>`,
};
const shapes = (t) => html`<div class="wr-shapes" style="--s:${t.shape};--a:${t.alt}">${SHAPES[t.shapeSet] || SHAPES.blobs}</div>`;
// Couleur à mi-chemin entre deux couleurs (« #rrggbb »)
const mix = (a, b) => '#' + [0, 2, 4].map((o) => Math.round((parseInt(a.slice(1 + o, 3 + o), 16) + parseInt(b.slice(1 + o, 3 + o), 16)) / 2).toString(16).padStart(2, '0')).join('');

function cardHtml(c, i) {
  const t = c.theme;
  const lines = (txt) => String(txt).split('\n').map((l, k) => html`<span class="wr-line" style="--d:${0.15 + k * 0.12}s">${l}</span>`);
  let body;
  if (c.kind === 'intro') body = html`<img class="wr-logo wr-in" src="/assets/logo-symbol.png?v=2" alt=""><p class="wr-kicker wr-in" style="--d:.1s">${c.kicker}</p><h1 class="wr-huge">${lines(c.big)}</h1><p class="wr-sub wr-in" style="--d:.6s">${c.sub}</p>`;
  else if (c.kind === 'number') body = html`<p class="wr-kicker wr-in">${c.kicker}</p><div class="wr-num wr-in ${String(c.unit).length <= 2 ? 'inline' : ''}" style="--d:.2s"><b data-count="${c.num}" data-plain="${c.plain ? 1 : 0}">0</b><span>${c.unit}</span></div><p class="wr-sub wr-in" style="--d:.5s">${c.sub}</p>${c.faces ? html`<div class="wr-faces wr-in" style="--d:.7s">${c.faces.map((f) => (f ? html`<img src="${f}" alt="" referrerpolicy="no-referrer">` : ''))}</div>` : ''}`;
  else if (c.kind === 'hero') body = html`<p class="wr-kicker wr-in">${c.kicker}</p><div class="wr-photo ${c.round ? 'round' : ''} wr-pop">${c.img ? html`<img src="${c.img}" alt="" referrerpolicy="no-referrer">` : ''}</div><h1 class="wr-big wr-in" style="--d:.45s">${c.big}</h1><p class="wr-sub wr-in" style="--d:.6s">${c.sub}</p>${c.play ? html`<button class="wr-btn wr-in" style="--d:.75s" data-wplay>${icon('play', 18)} Écouter</button>` : ''}`;
  else if (c.kind === 'list') body = html`<p class="wr-kicker wr-in">${c.kicker}</p><ol class="wr-list">${c.items.map((it, k) => html`<li class="wr-in" style="--d:${0.2 + k * 0.13}s"><span class="wr-rank">${k + 1}</span>${it.img ? html`<img class="${it.round ? 'round' : ''}" src="${it.img}" alt="" referrerpolicy="no-referrer">` : html`<i></i>`}<div><b>${it.title}</b><small>${it.sub}</small></div></li>`)}</ol>`;
  else if (c.kind === 'persona') body = html`<p class="wr-kicker wr-in">${c.kicker}</p><div class="wr-emoji wr-pop">${c.emoji}</div><h1 class="wr-big wr-in" style="--d:.4s">${c.big}</h1><p class="wr-sub wr-in" style="--d:.55s">${c.sub}</p>`;
  else body = html`<div class="wr-sum"><p class="wr-kicker wr-in">${c.kicker}</p>${c.img ? html`<img class="wr-sum-img wr-pop" src="${c.img}" alt="" referrerpolicy="no-referrer">` : ''}
    <div class="wr-sum-cols wr-in" style="--d:.3s"><div><small>Top artistes</small>${c.artists.map((a, k) => html`<p><b>${k + 1}</b> ${a}</p>`)}</div><div><small>Top titres</small>${c.tracks.map((a, k) => html`<p><b>${k + 1}</b> ${a}</p>`)}</div></div>
    <div class="wr-sum-stats wr-in" style="--d:.45s">${c.stats.map(([l, v]) => html`<div><small>${l}</small><b>${v}</b></div>`)}<div><small>Profil</small><b>${c.persona}</b></div></div>
    <div class="wr-sum-foot wr-in" style="--d:.6s"><img src="/assets/logo-symbol.png?v=2" alt=""><span>Boombox</span></div></div>`;
  return html`<div class="wr-card wr-${c.kind} set-${t.shapeSet}" style="--bg:${t.bg};--bg2:${t.bg2 || t.bg};--fg:${t.fg}">${shapes(t)}<div class="wr-body">${body}</div></div>`;
}

function drawShapes(x, t, W, H) {
  const circle = (cx, cy, r, color, stroke = 0) => {
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    if (stroke) {
      x.lineWidth = stroke;
      x.strokeStyle = color;
      x.stroke();
    } else {
      x.fillStyle = color;
      x.fill();
    }
  };
  x.save();
  x.globalAlpha = 0.92;
  const set = t.shapeSet || 'blobs';
  if (set === 'blobs') (circle(W * 0.95, H * 0.08, W * 0.34, t.shape), circle(W * 0.02, H * 0.97, W * 0.38, t.alt));
  else if (set === 'sun') (circle(W * 0.9, H * 0.12, W * 0.28, t.shape), circle(W * 0.05, H * 0.9, W * 0.24, t.alt, 40));
  else if (set === 'bubbles') [[0.85, 0.08, 0.16, t.shape], [0.95, 0.24, 0.08, t.alt], [0.1, 0.92, 0.2, t.alt], [0.3, 0.97, 0.07, t.shape], [0.75, 0.94, 0.05, t.shape]].forEach(([a, b, r, col]) => circle(W * a, H * b, W * r, col));
  else if (set === 'rings') (circle(W * 0.92, H * 0.1, W * 0.32, t.shape, 44), circle(W * 0.05, H * 0.88, W * 0.22, t.alt, 36), circle(W * 0.85, H * 0.86, W * 0.08, t.alt));
  else if (set === 'stripes') {
    x.save();
    x.beginPath();
    x.rect(W * 0.45, 0, W * 0.55, H * 0.3);
    x.clip();
    x.lineWidth = 34;
    x.strokeStyle = t.shape;
    for (let k = -20; k < 30; k++) {
      x.beginPath();
      x.moveTo(W * 0.4 + k * 80, 0);
      x.lineTo(W * 0.4 + k * 80 - H * 0.3, H * 0.3);
      x.stroke();
    }
    x.restore();
    circle(W * 0.05, H * 0.95, W * 0.3, t.alt);
  } else if (set === 'grid') {
    x.fillStyle = t.shape;
    for (let gx = 0; gx < 7; gx++) for (let gy = 0; gy < 6; gy++) circle(W * 0.6 + gx * 60, 60 + gy * 60, 8, t.shape);
    circle(W * 0.05, H * 0.92, W * 0.26, t.alt, 40);
  } else if (set === 'squares') {
    x.fillStyle = t.shape;
    x.translate(W * 0.88, H * 0.12);
    x.rotate(0.35);
    x.fillRect(-W * 0.22, -W * 0.22, W * 0.44, W * 0.44);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = t.alt;
    x.translate(W * 0.08, H * 0.94);
    x.rotate(-0.3);
    x.fillRect(-W * 0.16, -W * 0.16, W * 0.32, W * 0.32);
    x.setTransform(1, 0, 0, 1, 0, 0);
  } else if (set === 'waves') {
    [[t.shape, H * 0.9, 1], [t.alt, H * 0.95, -1]].forEach(([col, base, dir]) => {
      x.beginPath();
      x.moveTo(0, H);
      for (let px = 0; px <= W; px += 20) x.lineTo(px, base + Math.sin(px / 90) * 40 * dir);
      x.lineTo(W, H);
      x.closePath();
      x.fillStyle = col;
      x.fill();
    });
  } else if (set === 'half') {
    x.fillStyle = t.shape;
    x.beginPath();
    x.arc(W, H * 0.16, W * 0.36, Math.PI / 2, Math.PI * 1.5);
    x.fill();
    x.fillStyle = t.alt;
    x.beginPath();
    x.arc(0, H * 0.9, W * 0.3, -Math.PI / 2, Math.PI / 2);
    x.fill();
  }
  x.restore();
}

// ---------- Image exportée (canvas) : la même carte, en Story 1080×1920 ou en post 1080×1350 ----------
async function cardImage(c, format = 'story', opts = {}) {
  await document.fonts?.ready;
  const W = 1080;
  const H = format === 'post' ? 1350 : 1920;
  const post = format === 'post';
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  const t = c.theme;
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const g = x.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, t.bg);
  g.addColorStop(1, t.bg2 || t.bg);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  drawShapes(x, t, W, H);
  pixelDeco(x, W, H, String(c.kicker || '').length + (c.num || 0));
  // Vidéo : on garde le fond seul (sans le texte) pour faire apparaître le contenu par-dessus
  let bgLayer = null;
  if (opts.layers) {
    bgLayer = document.createElement('canvas');
    bgLayer.width = W;
    bgLayer.height = H;
    bgLayer.getContext('2d').drawImage(cv, 0, 0);
  }  const wrap = (text, maxW, size, weight = 900) => {
    x.font = `${weight} ${size}px ${font}`;
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const w of para.split(' ')) {
        const test = line ? `${line} ${w}` : w;
        if (x.measureText(test).width > maxW && line) {
          out.push(line);
          line = w;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  };
  const text = (str, y, size, weight = 900, maxLines = 3) => {
    const all = wrap(str, W - 160, size, weight);
    const lines = all.slice(0, maxLines);
    if (all.length > maxLines) lines[maxLines - 1] += '…';
    x.fillStyle = t.fg;
    x.font = `${weight} ${size}px ${font}`;
    lines.forEach((l, k) => x.fillText(l, 80, y + k * size * 1.08));
    return y + lines.length * size * 1.08;
  };
  const one = (str, maxW, size, weight) => {
    const all = wrap(str, maxW, size, weight);
    return all[0] + (all.length > 1 ? '…' : '');
  };
  const drawImg = async (url, cx, cy, size, round) => {
    const img = await loadImg(url);
    x.save();
    x.beginPath();
    if (round) x.arc(cx + size / 2, cy + size / 2, size / 2, 0, Math.PI * 2);
    else x.roundRect(cx, cy, size, size, 24);
    x.clip();
    if (img) {
      const s = Math.min(img.width, img.height);
      x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx, cy, size, size);
    } else {
      x.fillStyle = 'rgba(0,0,0,0.2)';
      x.fillRect(cx, cy, size, size);
    }
    x.restore();
  };
  let y = post ? 150 : 260;
  if (c.kind !== 'summary') y = text(c.kicker, y, 46, 800) + 30;
  if (c.kind === 'intro') {
    y = text(c.big, y + 60, post ? 120 : 150, 900, 4) + 20;
    text(c.sub, y + 20, 48, 600);
  } else if (c.kind === 'number') {
    x.fillStyle = t.fg;
    x.font = `900 ${post ? 220 : 280}px ${font}`;
    x.fillText(c.plain ? String(c.num) : fmtN(c.num), 70, y + (post ? 230 : 300));
    y = text(c.unit, y + (post ? 320 : 400), 80, 900) + 30;
    text(c.sub, y, 44, 600, 4);
  } else if (c.kind === 'hero') {
    const size = post ? 520 : 720;
    await drawImg(c.img, (W - size) / 2, y + 20, size, c.round);
    y = text(c.big, y + size + 130, post ? 84 : 100, 900, 2) + 10;
    text(c.sub, y + 10, 44, 600);
  } else if (c.kind === 'list') {
    const row = post ? 170 : 230;
    const im = post ? 130 : 170;
    for (let k = 0; k < c.items.length; k++) {
      const it = c.items[k];
      const yy = y + 30 + k * row;
      x.fillStyle = t.fg;
      x.font = `900 ${post ? 72 : 90}px ${font}`;
      x.fillText(String(k + 1), 80, yy + im * 0.72);
      await drawImg(it.img, 190, yy, im, it.round);
      const tx = 190 + im + 50;
      x.fillStyle = t.fg;
      x.font = `900 ${post ? 50 : 58}px ${font}`;
      x.fillText(one(it.title, W - tx - 80, post ? 50 : 58, 900), tx, yy + im * 0.45);
      x.globalAlpha = 0.75;
      x.font = `600 ${post ? 34 : 40}px ${font}`;
      x.fillText(one(it.sub, W - tx - 80, post ? 34 : 40, 600), tx, yy + im * 0.8);
      x.globalAlpha = 1;
    }
  } else if (c.kind === 'persona') {
    x.font = `${post ? 260 : 340}px serif`;
    x.fillText(c.emoji, 70, y + (post ? 270 : 360));
    y = text(c.big, y + (post ? 390 : 500), post ? 110 : 130, 900) + 20;
    text(c.sub, y, 46, 600, 4);
  } else {
    // Résumé : grande pochette, chiffres, tops, profil sur toute la largeur (rien n'est coupé)
    y = text(c.kicker, post ? 130 : 210, post ? 62 : 78, 900, 2) + (post ? 30 : 50);
    const colW = (W - 200) / 2;
    const stat = (l, v, cx, cy, size) => {
      x.fillStyle = t.fg;
      x.globalAlpha = 0.75;
      x.font = `700 32px ${font}`;
      x.fillText(l, cx, cy);
      x.globalAlpha = 1;
      x.font = `900 ${size}px ${font}`;
      x.fillText(one(String(v), W - cx - 80, size, 900), cx, cy + size * 1.05);
    };
    if (post) {
      // Post 4:5 : pochette à gauche, chiffres à droite
      const im = 330;
      if (c.img) await drawImg(c.img, 80, y, im, false);
      c.stats.forEach(([l, v], k) => stat(l, v, 80 + im + 60, y + 10 + k * 110, 62));
      y += im + 60;
    } else {
      const im = 560;
      if (c.img) await drawImg(c.img, (W - im) / 2, y, im, false);
      y += im + 70;
      c.stats.forEach(([l, v], k) => stat(l, v, 80 + k * ((W - 160) / 3), y, 72));
      y += 150;
    }
    const list = (title, arr, cx) => {
      x.fillStyle = t.fg;
      x.globalAlpha = 0.75;
      x.font = `700 32px ${font}`;
      x.fillText(title, cx, y);
      x.globalAlpha = 1;
      arr.slice(0, 5).forEach((s2, k) => {
        x.font = `900 ${post ? 38 : 44}px ${font}`;
        x.fillText(String(k + 1), cx, y + 62 + k * (post ? 56 : 68));
        x.font = `800 ${post ? 38 : 44}px ${font}`;
        x.fillText(one(s2, colW - 50, post ? 38 : 44, 800), cx + 46, y + 62 + k * (post ? 56 : 68));
      });
    };
    list('Top artistes', c.artists, 80);
    list('Top titres', c.tracks, 80 + colW + 40);
    y += 62 + 5 * (post ? 56 : 68) + (post ? 20 : 50);
    stat("Profil d'auditeur", c.persona, 80, y, post ? 56 : 70);
  }  // Signature
  const logo = await loadImg('/assets/logo-symbol.png?v=2');
  if (logo) x.drawImage(logo, 80, H - 140, 64, 64);
  x.fillStyle = t.fg;
  x.font = `800 40px ${font}`;
  x.fillText('Boombox', 160, H - 92);
  if (opts.layers) return { bg: bgLayer, full: cv };
  return new Promise((r) => cv.toBlob(r, 'image/png'));
}

// ---------- Vidéo animée de la carte (format Story 1080×1920 ou post 1080×1350), 6 secondes ----------
// Le contenu apparaît en gros pixels (comme un écran rétro qui s'allume), puis des pixels scintillent sur les bords.
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
export const canRecordVideo = () => !!window.MediaRecorder && !!HTMLCanvasElement.prototype.captureStream && VIDEO_TYPES.some((m) => MediaRecorder.isTypeSupported?.(m));
export async function cardVideo(c, format = 'story', onTick) {
  const { bg, full } = await cardImage(c, format, { layers: true });
  const W = full.width;
  const H = full.height;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  const mime = VIDEO_TYPES.find((m) => MediaRecorder.isTypeSupported?.(m));
  // Chaque image est envoyée à la main à l'enregistreur (indépendant du rafraîchissement de l'écran)
  const stream = cv.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const pushFrame = track?.requestFrame ? () => track.requestFrame() : () => {};
  const rec = new MediaRecorder(track?.requestFrame ? stream : cv.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  let seed = (String(c.kicker || '').length + 7) * 9301;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Ordre d'apparition des blocs : du haut vers le bas, avec du désordre (effet « pixels qui s'allument »)
  const B = 60;
  const cols = Math.ceil(W / B);
  const rows = Math.ceil(H / B);
  const order = Array.from({ length: cols * rows }, (_, k) => (Math.floor(k / cols) / rows) * 0.65 + rnd() * 0.35);
  const t = c.theme;
  const colors = [t.shape, t.alt, t.fg, '#ffffff'].filter(Boolean);
  // Pixels qui scintillent sur les bords (haut, bas, côtés) : jamais sur le texte
  const sparks = Array.from({ length: 48 }, () => {
    const band = rnd();
    const px = band < 0.5 ? rnd() * W : band < 0.75 ? rnd() * 70 : W - 70 + rnd() * 60;
    const py = band < 0.25 ? rnd() * H * 0.1 : band < 0.5 ? H * 0.9 + rnd() * H * 0.1 : rnd() * H;
    return { x: px, y: py, s: (1 + Math.floor(rnd() * 3)) * 12, c: colors[Math.floor(rnd() * colors.length)], ph: rnd() * 6.28, sp: 0.6 + rnd() * 1.2 };
  });
  const DUR = 10;
  const REVEAL = 1.1;
  const draw = (tt) => {
    x.drawImage(bg, 0, 0);
    const p = Math.min(1, tt / REVEAL);
    if (p >= 1) x.drawImage(full, 0, 0);
    else for (let k = 0; k < order.length; k++) if (order[k] < p) {
      const sx = (k % cols) * B;
      const sy = Math.floor(k / cols) * B;
      x.drawImage(full, sx, sy, B, B, sx, sy, B, B);
    }
    for (const sp of sparks) {
      const on = Math.sin(tt * 3.2 * sp.sp + sp.ph);
      if (on < 0.2) continue;
      x.globalAlpha = on > 0.7 ? 0.9 : 0.45; // deux niveaux : clignotement saccadé, rétro
      x.fillStyle = sp.c;
      x.fillRect(Math.round(sp.x), Math.round(sp.y - ((tt * 14 * sp.sp) % 40)), sp.s, sp.s);
    }
    x.globalAlpha = 1;
  };
  draw(0);
  rec.start(250);
  const t0 = performance.now();
  await new Promise((done) => {
    const step = () => {
      const tt = (performance.now() - t0) / 1000;
      draw(tt);
      pushFrame();
      onTick?.(Math.min(1, tt / DUR));
      if (tt < DUR) setTimeout(step, 33);
      else done();
    };
    step();
  });
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: mime.split(';')[0] });
}

// ---------- Fenêtre d'export : aperçu + vidéo animée, image, copie ----------
async function exportSheet(c, format, name) {
  const img = await cardImage(c, format);
  const url = URL.createObjectURL(img);
  const mobile = window.Capacitor?.isNativePlatform?.() || /iphone|ipad|android/i.test(navigator.userAgent);
  const ov = document.createElement('div');
  ov.className = 'story-save story-export';
  ov.innerHTML = `<div class="ss-box"><img src="${url}" alt="Aperçu">
    <div class="se-btns">
      ${canRecordVideo() ? '<button class="btn primary" data-x="video">Vidéo animée (10 s)</button>' : ''}
      <button class="btn white" data-x="image">${mobile ? 'Partager l’image' : 'Télécharger l’image'}</button>
      ${!mobile && window.ClipboardItem ? '<button class="btn ghost" data-x="copy">Copier l’image</button>' : ''}
      <button class="btn ghost" data-x="close">Fermer</button>
    </div><p class="muted se-hint"></p></div>`;
  document.body.appendChild(ov);
  const close = () => (ov.remove(), URL.revokeObjectURL(url));
  ov.addEventListener('click', async (e) => {
    if (e.target === ov) return close();
    const act = e.target.closest('[data-x]')?.dataset.x;
    if (act === 'close') return close();
    if (act === 'image') return shareFile(img, name);
    if (act === 'copy') return copyImage(img);
    if (act === 'video') {
      const b = e.target.closest('button');
      if (b.disabled) return;
      b.disabled = true;
      const hint = ov.querySelector('.se-hint');
      hint.textContent = 'Création de la vidéo… reste sur cette page';
      try {
        const vid = await cardVideo(c, format, (p) => (b.textContent = `Création… ${Math.round(p * 100)} %`));
        hint.textContent = '';
        b.textContent = 'Vidéo animée (10 s)';
        await shareFile(vid, name.replace(/\.png$/, vid.type.includes('mp4') ? '.mp4' : '.webm'));
      } catch (err) {
        hint.textContent = `Vidéo impossible : ${err.message}`;
      } finally {
        b.disabled = false;
        if (b.textContent.startsWith('Création')) b.textContent = 'Vidéo animée (10 s)';
      }
    }
  });
}

// Image Story du résumé (utilisée aussi par la page des stats)
export async function storyFrom(s, range) {
  const { cards } = buildCards(s, { label: range.label, tag: range.tag, name: range.label }, 'other');
  return cardImage(cards.find((c) => c.kind === 'summary'), 'story');
}

export async function wrappedPage(el, params, ctx) {
  if (!params.period && !params.year) return chooser(el);
  const period = params.period || 'year';
  const year = Number(params.year) || new Date().getFullYear();
  if (period === 'year' && !yearWrappedReady(year)) {
    el.innerHTML = String(html`<div class="page"><div class="empty"><h2>Ton Wrapped ${year} arrive le 1er décembre</h2><p>Comme sur Spotify, le récap de l'année s'ouvre en décembre. En attendant, regarde ta semaine ou ton mois.</p><a class="btn white" href="#/wrapped">Choisir une autre période</a></div></div>`);
    return;
  }
  const range = wrappedRange(period, year);
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const s = await getStatsFull(0, { since: range.since, until: range.until }, 50);
  if (!ctx.alive()) return;
  if (!s.plays) {
    el.innerHTML = String(html`<div class="page"><div class="empty"><h2>Pas encore de récap ${range.tag}</h2><p>Écoute de la musique (ou importe ton historique Spotify) : ton récap animé apparaîtra ici.</p><a class="btn white" href="#/wrapped">Choisir une autre période</a></div></div>`);
    return;
  }
  const { cards, t1 } = buildCards(s, range, period);
  let i = 0;
  let timer = null;
  let paused = false;
  let started = 0;
  let remaining = 0;
  const DUR = 7000;
  el.innerHTML = String(html`<div class="wr" tabindex="0">
    <div class="wr-stage">
      <div class="wr-bars">${cards.map(() => html`<span><i></i></span>`)}</div>
      <div class="wr-top"><span class="wr-brand"><img src="/assets/logo-symbol.png?v=2" alt="">${range.short}</span><button class="wr-icon" data-w="pause" title="Pause (ou maintiens appuyé)">${icon('pause', 20)}</button><button class="wr-icon" data-w="close" title="Fermer">${icon('close', 22)}</button></div>
      <div class="wr-slot"></div>
      <button class="wr-nav prev" aria-label="Carte précédente"></button><button class="wr-nav next" aria-label="Carte suivante"></button>
    </div>
    <div class="wr-actions"><button class="wr-share" data-w="story" title="Image verticale 1080×1920, pour une Story Insta / Snap (depuis le téléphone)">${icon('share', 18)} Story Insta</button><button class="wr-share" data-w="post" title="Image 1080×1350 (4:5), le format exact d'un post Insta, aussi sur Insta web">${icon('share', 18)} Post Insta</button><button class="wr-share ghost hidden" data-w="save">Créer la playlist</button></div>
  </div>`);
  const root = el.querySelector('.wr');
  const slot = root.querySelector('.wr-slot');
  const bars = [...root.querySelectorAll('.wr-bars span')];
  const schedule = (ms) => {
    clearTimeout(timer);
    started = Date.now();
    remaining = ms;
    if (i < cards.length - 1) timer = setTimeout(() => ctx.alive() && show(i + 1), ms);
  };
  const setPaused = (v) => {
    if (v === paused) return;
    paused = v;
    root.classList.toggle('paused', v);
    root.querySelector('[data-w=pause]').innerHTML = String(icon(v ? 'play' : 'pause', 20));
    if (v) {
      clearTimeout(timer);
      remaining = Math.max(600, remaining - (Date.now() - started));
    } else schedule(remaining);
  };
  const show = (n) => {
    i = Math.max(0, Math.min(cards.length - 1, n));
    slot.innerHTML = String(cardHtml(cards[i], i));
    root.style.setProperty('--page', cards[i].theme.bg);
    // Fond pixel animé propre à la carte : ses couleurs, or pour les podiums, vert pour ce qui est « en direct »
    {
      const th = cards[i].theme;
      const k = String(cards[i].kind || '');
      const accents = /list|number|hero/.test(k) ? ['#FFD34D'] : /live|now|friend/i.test(k) ? ['#2EF28B'] : [th.shape, th.alt];
      pixelBackdrop(slot.querySelector('.wr-card'), [th.bg, th.bg2 || th.bg, mix(th.bg2 || th.bg, th.shape)], { accents, speed: 0.6, accentRate: 0.006 });
    }
    bars.forEach((b, k) => {
      b.className = k < i ? 'done' : k === i ? 'now' : '';
      b.querySelector('i').style.animationDuration = DUR + 'ms';
    });
    // Compteurs qui défilent
    slot.querySelectorAll('[data-count]').forEach((nEl) => {
      const target = Number(nEl.dataset.count);
      const plain = nEl.dataset.plain === '1';
      const t0 = performance.now() + 250;
      const step = () => {
        const k = Math.max(0, Math.min(1, (performance.now() - t0) / 1800));
        const v = target * (1 - Math.pow(1 - k, 4));
        nEl.textContent = plain ? String(Math.round(v)) : fmtN(v);
        if (k < 1 && ctx.alive()) requestAnimationFrame(step);
      };
      step();
    });
    slot.querySelector('[data-wplay]')?.addEventListener('click', (e) => (e.stopPropagation(), ctl.playTrack(t1.track)));
    root.querySelector('[data-w=save]').classList.toggle('hidden', cards[i].kind !== 'summary');
    paused = false;
    root.classList.remove('paused');
    root.querySelector('[data-w=pause]').innerHTML = String(icon('pause', 20));
    schedule(DUR);
  };
  root.addEventListener('click', async (e) => {
    if (held) return (held = false);
    if (e.target.closest('.wr-nav.next')) return show(i + 1);
    if (e.target.closest('.wr-nav.prev')) return show(i - 1);
    const w = e.target.closest('[data-w]')?.dataset.w;
    if (!w) return;
    if (w === 'close') return history.back();
    if (w === 'pause') return setPaused(!paused);
    if (w === 'story' || w === 'post') {
      setPaused(true);
      return exportSheet(cards[i], w, `boombox-${period}-${i + 1}${w === 'post' ? '-post' : ''}.png`);
    }
    if (w === 'save') {
      const pl = await createPlaylist(`Mes titres ${range.name}`, s.topTracks.map((t) => t.track), `Tes titres les plus écoutés ${range.tag}, d'après ton récap Boombox.`);
      toast('Playlist créée', { action: 'Voir', onAction: () => (location.hash = `#/playlist/${pl.id}`) });
    }
  });
  // Maintenir appuyé = pause, relâcher = reprise (comme les Stories)
  const stage = root.querySelector('.wr-stage');
  let holdT = null;
  let held = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.wr-top')) return;
    holdT = setTimeout(() => {
      held = true;
      setPaused(true);
    }, 250);
  });
  const release = () => {
    clearTimeout(holdT);
    if (held) setPaused(false);
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointerleave', release);
  root.addEventListener('keydown', (e) => {
    e.stopPropagation(); // l'espace ne doit pas mettre la musique en pause ici
    if (e.key === 'ArrowRight') (e.preventDefault(), show(i + 1));
    if (e.key === 'ArrowLeft') (e.preventDefault(), show(i - 1));
    if (e.key === ' ') (e.preventDefault(), setPaused(!paused));
    if (e.key === 'Escape') history.back();
  });
  root.focus();
  show(0);
  return { cleanup: () => clearTimeout(timer) };
}
