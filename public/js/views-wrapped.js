// Récap animé façon Spotify Wrapped : des cartes verticales (format Story), plein de couleur, grosses typos,
// formes qui bougent, chiffres qui défilent. Chaque carte se partage en image : Story (9:16) ou post Insta (4:5).
// Les cartes sont décrites par des données ; le même modèle sert à l'affichage animé et à l'image exportée.
import { html, icon, plural, toast } from './ui.js';
import { getStatsFull, createPlaylist, listeningYears } from './state.js';
import { ctl } from './player.js';
import { loadImg, shareStory, pixelDeco, shareFile, copyImage } from './story.js';
import { pixelBackdrop, fieldPainter, isPixelDA } from './pixel-bg.js';
import { isNative, localApi } from './native.js';

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
    // Soirée : la journée se termine en couleurs sombres
    { bg: '#1a0b2e', bg2: '#4a1d5e', fg: '#ffe6f2', shape: '#ff7eb6', alt: '#ffd166' },
    { bg: '#0c1b33', bg2: '#1f3b6e', fg: '#e8f1ff', shape: '#7ad3ff', alt: '#ffb4a2' },
  ] },
  // Semaine : club, fond sombre, néons, anneaux et rayures
  week: { shapes: ['rings', 'stripes', 'grid'], palettes: [
    { bg: '#0b0618', bg2: '#22104a', fg: '#ffffff', shape: '#ff2bd6', alt: '#22f0ff' },
    { bg: '#050b1a', bg2: '#0d2a4a', fg: '#e8ff4d', shape: '#2bff88', alt: '#7c4dff' },
    { bg: '#140010', bg2: '#3a0030', fg: '#ffffff', shape: '#ff5c39', alt: '#ff2bd6' },
    { bg: '#03140f', bg2: '#08362a', fg: '#c6ff4d', shape: '#c6ff4d', alt: '#22f0ff' },
    { bg: '#0f0a24', bg2: '#2a1a5e', fg: '#ffffff', shape: '#b07cf7', alt: '#ffd23f' },
    { bg: '#000000', bg2: '#1a1a1a', fg: '#ffd34d', shape: '#ffd34d', alt: '#ff4d8d' },
    { bg: '#0a0020', bg2: '#00264d', fg: '#9ffcff', shape: '#00e5ff', alt: '#ff3cac' },
    { bg: '#1b0000', bg2: '#4d0a0a', fg: '#ffd9c2', shape: '#ff6b3d', alt: '#ffd34d' },
  ] },
  // Mois : affiche bicolore, couleurs franches, carrés et vagues
  month: { shapes: ['squares', 'waves', 'half'], palettes: [
    { bg: '#ff4d2e', bg2: '#ff4d2e', fg: '#1a0600', shape: '#ffd23f', alt: '#1a0600' },
    { bg: '#1f3cff', bg2: '#1f3cff', fg: '#ffffff', shape: '#ff9ad5', alt: '#c6ff4d' },
    { bg: '#ffd23f', bg2: '#ffd23f', fg: '#14002e', shape: '#7c3aed', alt: '#ff4d8d' },
    { bg: '#0f8a5f', bg2: '#0f8a5f', fg: '#fff6d6', shape: '#ffb800', alt: '#ff6ad5' },
    { bg: '#b07cf7', bg2: '#b07cf7', fg: '#14002e', shape: '#ff4d8d', alt: '#f5d33f' },
    { bg: '#ff6ad5', bg2: '#ff6ad5', fg: '#1a0013', shape: '#2b2bff', alt: '#fff36b' },
    { bg: '#101820', bg2: '#101820', fg: '#fee715', shape: '#fee715', alt: '#ff4d8d' },
    { bg: '#1d0b3b', bg2: '#1d0b3b', fg: '#ffffff', shape: '#2ef28b', alt: '#b07cf7' },
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
    { bg: '#0b0618', bg2: '#3b0d5c', fg: '#ffffff', shape: '#ff2bd6', alt: '#ffd34d' },
    { bg: '#000000', bg2: '#161616', fg: '#ffd34d', shape: '#ffd34d', alt: '#b07cf7' },
    { bg: '#03140f', bg2: '#0c3b2e', fg: '#d6ff7a', shape: '#2ef28b', alt: '#ff9f2e' },
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

// ---------- Variété : textes, emojis et fond animé de chaque carte ----------
// La graine de la période choisit les tournures : le récap ne dit pas deux fois la même chose de la même façon.
const pickFrom = (list, seed, k = 0) => list[Math.abs(seed * 7 + k * 13) % list.length];
function vary(cards, s, { seed, tag, p, favHour }) {
  const Tag = tag[0].toUpperCase() + tag.slice(1);
  // Comparaison amusante pour les minutes
  const m = s.minutes || 0;
  const fun = m >= 600 ? `de quoi regarder ${Math.round(m / 110)} films 🎬` : m >= 120 ? `plus de ${Math.floor(m / 60)} heures dans les oreilles 🎧` : m >= 30 ? `l'équivalent de ${Math.max(1, Math.round(m / 3.3))} sons d'affilée 🔁` : 'un bon début 🌱';
  const hourEmoji = favHour >= 21 || favHour < 5 ? '🌙' : favHour < 11 ? '☀️' : favHour < 17 ? '🌤️' : '🌆';
  cards.forEach((c, i) => {
    const k = i;
    if (c.kind === 'intro') {
      c.sub = pickFrom(['Prêt·e ? On y va.', 'Monte le son 🔊', 'Installe-toi, ça commence 🎬', 'Ta bande-son, en chiffres ✨', 'Respire. On lance le récap 🚀'], seed, k);
      c.style = 'rings';
    } else if (c.kind === 'number' && c.unit === 'minutes') {
      c.kicker = pickFrom([`${Tag}, tu as écouté`, `${Tag}, le compteur affiche`, `Temps passé en musique ${tag}`, `${Tag}, tes oreilles ont tourné`], seed, k);
      c.sub = `${c.sub} · ${fun}`;
      c.style = 'plasma';
    } else if (c.kind === 'hero' && c.round) {
      c.kicker = pickFrom(['Ton artiste n°1', 'Ton n°1 incontesté 👑', 'Celui qui a tout raflé 🏆', 'Ton coup de cœur absolu 💘'], seed, k);
      c.style = 'rings';
    } else if (c.kind === 'hero') {
      c.kicker = pickFrom([c.kicker, `${c.kicker} 🔥`, 'Le son qui a tourné en boucle 🔁', 'Ton hymne du moment 🎶'], seed, k);
      c.style = 'plasma';
    } else if (c.kind === 'list') {
      c.kicker = /artistes/.test(c.kicker)
        ? pickFrom(['Tes artistes préférés', 'Ton podium 🏅', 'Ton top 5 artistes ⭐', 'Ceux qui t’ont suivi partout 👣'], seed, k)
        : pickFrom(['Tes titres préférés', 'Ta playlist idéale 💿', 'Ton top 5 sons 🎧', 'Les sons qui t’ont marqué 💥'], seed, k);
      c.style = pickFrom(['waves', 'plasma'], seed, k);
    } else if (c.kind === 'number' && c.unit === 'h') {
      c.kicker = `Ton moment préféré ${hourEmoji}`;
      c.style = favHour >= 21 || favHour < 5 ? 'stars' : 'waves';
    } else if (c.kind === 'number') {
      c.kicker = pickFrom(['Tes découvertes', 'Nouveaux venus dans tes oreilles 🌱', 'Tu as élargi ton horizon 🧭'], seed, k);
      c.style = 'rain';
    } else if (c.kind === 'persona') {
      c.style = /fidèle/i.test(p.name) ? 'hearts' : /noctambule/i.test(p.name) ? 'stars' : 'rings';
    } else if (c.kind === 'summary') c.style = 'waves';
  });
}

// ---------- Les cartes (données) ----------
function buildCards(s, range, period, seedOverride = null) {
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
  const seed = seedOverride ?? periodSeed(period, range.since || Date.now());
  const theme = themesFor(period, seed);
  cards.forEach((c, i) => (c.theme = theme(i)));
  vary(cards, s, { seed, tag, p, favHour });
  // Musique de la vidéo : ton titre n°1 pour la carte « titre », le son le plus écouté de l'artiste pour les cartes
  // artiste, sinon ton titre n°1
  const topOf = (name) => s.topTracks.find((x) => (x.track.artists || []).some((a) => a.name === name))?.track;
  cards.forEach((c) => {
    if (c.kind === 'hero' && c.round) c.music = topOf(c.big) || t1?.track;
    else if (c.kind === 'list' && /artistes/i.test(c.kicker + (c.items?.[0]?.round ? ' artistes' : ''))) c.music = topOf(c.items?.[0]?.title) || t1?.track;
    else c.music = t1?.track || null;
  });
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
// Fond animé d'une carte (couleurs de la carte ; or pour les podiums, vert pour « en direct »)
function cardBackdrop(c) {
  const th = c.theme;
  const k = String(c.kind || '');
  const accents = /list|number|hero/.test(k) ? ['#FFD34D'] : /live|now|friend/i.test(k) ? ['#2EF28B'] : [th.shape, th.alt];
  return { palette: [th.bg, th.bg2 || th.bg, mix(th.bg2 || th.bg, th.shape)], opts: { style: c.style || 'waves', accents, speed: c.style === 'rain' ? 0.9 : 0.6, accentRate: 0.006 } };
}

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
  let shapesLayer = null;
  if (opts.layers) {
    // Vidéo : le fond est animé à part ; on garde les formes sur leur propre calque, le contenu sur un calque transparent
    shapesLayer = document.createElement('canvas');
    shapesLayer.width = W;
    shapesLayer.height = H;
    drawShapes(shapesLayer.getContext('2d'), t, W, H);
  } else if (isPixelDA()) {
    // Même fond pixel que dans l'appli et la vidéo, à un instant de l'animation
    const bd = cardBackdrop(c);
    const lw = 60;
    const cell = W / lw;
    const lh = Math.ceil(H / cell);
    const low = document.createElement('canvas');
    low.width = lw;
    low.height = lh;
    const lg = low.getContext('2d');
    const img = lg.createImageData(lw, lh);
    fieldPainter(bd.palette, bd.opts)(img, lw, lh, 2.5);
    lg.putImageData(img, 0, 0);
    x.imageSmoothingEnabled = false;
    x.drawImage(low, 0, 0, lw * cell, lh * cell);
    x.imageSmoothingEnabled = true;
    drawShapes(x, t, W, H);
  } else {
    const g = x.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, t.bg);
    g.addColorStop(1, t.bg2 || t.bg);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    drawShapes(x, t, W, H);
    pixelDeco(x, W, H, String(c.kicker || '').length + (c.num || 0));
  }
  const wrap = (text, maxW, size, weight = 900) => {
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
  } else if (c.kind === 'lyrics') {
    // Paroles : pochette + titre en haut, puis les lignes choisies en grand
    const im = post ? 240 : 300;
    await drawImg(c.img, 80, y + 10, im, false);
    const tx = 80 + im + 44;
    x.fillStyle = t.fg;
    x.font = `900 ${post ? 50 : 60}px ${font}`;
    x.fillText(one(c.title, W - tx - 80, post ? 50 : 60, 900), tx, y + 10 + im * 0.45);
    x.globalAlpha = 0.75;
    x.font = `600 ${post ? 36 : 42}px ${font}`;
    x.fillText(one(c.artist, W - tx - 80, post ? 36 : 42, 600), tx, y + 10 + im * 0.72);
    x.globalAlpha = 1;
    const top = y + im + (post ? 110 : 170);
    const bottom = H - (post ? 170 : 210); // le logo Boombox reste visible
    c._lyrBox = { top: top - (post ? 60 : 80), bottom };
    if (!opts.layers) {
      // Taille de texte la plus grande qui tient dans la zone
      let size = post ? 66 : 84;
      const height = (sz) => c.lines.reduce((h, l2) => h + Math.min(3, wrap(l2, W - 160, sz, 900).length) * sz * 1.08 + (post ? 16 : 26), 0);
      while (size > 40 && height(size) > bottom - top) size -= 4;
      let yy = top;
      for (const line of c.lines) yy = text(line, yy, size, 900, 3) + (post ? 16 : 26);
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
  if (opts.layers) return { shapes: shapesLayer, content: cv };
  return new Promise((r) => cv.toBlob(r, 'image/png'));
}

// ---------- Vidéo animée de la carte (format Story 1080×1920 ou post 1080×1350), 6 secondes ----------
// Le contenu apparaît en gros pixels (comme un écran rétro qui s'allume), puis des pixels scintillent sur les bords.
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
export const canRecordVideo = () => !!window.MediaRecorder && !!HTMLCanvasElement.prototype.captureStream && VIDEO_TYPES.some((m) => MediaRecorder.isTypeSupported?.(m));
// Son d'un titre (fichier du téléphone, ou flux du PC) décodé pour être mis dans la vidéo
async function musicBuffer(track, ac) {
  const data = isNative ? await (await localApi()).media.audioBuffer(track.id) : await (await fetch(`/api/stream/${track.id}`)).arrayBuffer();
  return ac.decodeAudioData(data);
}
export async function cardVideo(c, format = 'story', onTick, { music = null, ac = null } = {}) {
  const { shapes, content } = await cardImage(c, format, { layers: true });
  const W = content.width;
  const H = content.height;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  // Fond pixel : mêmes réglages et même nombre de cellules en largeur que la carte dans l'appli (≈ 60)
  const bd = cardBackdrop(c);
  const paint = fieldPainter(bd.palette, bd.opts);
  const lw = 60;
  const cell = W / lw;
  const lh = Math.ceil(H / cell);
  const low = document.createElement('canvas');
  low.width = lw;
  low.height = lh;
  const lg = low.getContext('2d');
  const img = lg.createImageData(lw, lh);
  const t = c.theme;
  const DUR = c.duration || 10;
  // Musique : extrait pris vers le tiers du son (souvent le refrain), fondu d'entrée et de sortie
  let audio = null;
  if (music && ac) {
    try {
      const buf = await musicBuffer(music, ac);
      const dest = ac.createMediaStreamDestination();
      const gain = ac.createGain();
      gain.connect(dest);
      const at = c.musicAt != null ? Math.max(0, c.musicAt - 0.6) : buf.duration * 0.35;
      audio = { buf, dest, gain, offset: Math.max(0, Math.min(at, buf.duration - DUR - 0.5)) };
    } catch {
      audio = null; // son indisponible : vidéo sans musique
    }
  }
  const withAudio = !!audio;
  const types = withAudio ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', ...VIDEO_TYPES] : VIDEO_TYPES;
  const mime = types.find((m) => MediaRecorder.isTypeSupported?.(m));
  // Chaque image est envoyée à la main à l'enregistreur (indépendant du rafraîchissement de l'écran)
  const stream = cv.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const pushFrame = track?.requestFrame ? () => track.requestFrame() : () => {};
  const videoTracks = (track?.requestFrame ? stream : cv.captureStream(30)).getVideoTracks();
  const rec = new MediaRecorder(new MediaStream([...videoTracks, ...(withAudio ? audio.dest.stream.getAudioTracks() : [])]), { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  const draw = (tt) => {
    if (isPixelDA()) {
      paint(img, lw, lh, tt);
      lg.putImageData(img, 0, 0);
      x.imageSmoothingEnabled = false;
      x.drawImage(low, 0, 0, lw * cell, lh * cell);
    } else {
      // DA Spotify : fond dégradé de la carte, comme dans l'appli
      const g = x.createLinearGradient(0, 0, W * 0.4, H);
      g.addColorStop(0, t.bg);
      g.addColorStop(1, t.bg2 || t.bg);
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
    }
    x.drawImage(shapes, 0, 0);
    if (c.kind === 'lyrics') drawKaraoke(tt);
    // Entrée de la carte comme dans l'appli : le contenu monte en fondu
    const p = Math.min(1, tt / 0.7);
    const ease = 1 - Math.pow(1 - p, 3);
    x.globalAlpha = ease;
    x.drawImage(content, 0, (1 - ease) * 40);
    x.globalAlpha = 1;
  };
  // ----- Paroles animées (carte « paroles ») -----
  const lyr = c.kind === 'lyrics' ? (c.lyr?.lines?.length ? c.lyr.lines : c.lines.map((tx) => ({ text: tx, chosen: true }))) : [];
  const synced = !!(c.lyr?.synced && c.musicAt != null && lyr.every((l2) => l2.t != null));
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const firstChosen = Math.max(0, lyr.findIndex((l2) => l2.chosen));
  let pos = firstChosen;
  const rows = (txt, size) => {
    x.font = `900 ${size}px ${font}`;
    const out = [];
    let line = '';
    for (const w of String(txt).split(' ')) {
      const test = line ? `${line} ${w}` : w;
      if (x.measureText(test).width > W - 160 && line) (out.push(line), (line = w));
      else line = test;
    }
    out.push(line);
    return out.slice(0, 3);
  };
  // Mise en page calculée une seule fois, à taille fixe (le texte ne bouge plus quand il défile)
  const lyrSize = format === 'post' ? 62 : 74;
  const lyrBlocks = lyr.map((l2, k) => ({ k, size: lyrSize, r: rows(l2.text, lyrSize) }));
  function drawKaraoke(tt) {
    const box = c._lyrBox;
    if (!box || !lyr.length) return;
    // Ligne en cours : d'après le temps du son (paroles synchronisées), sinon une ligne choisie toutes les ~2 s
    let cur;
    if (synced) {
      const songT = Math.max(0, c.musicAt - 0.6) + tt;
      cur = 0;
      lyr.forEach((l2, k) => l2.t <= songT + 0.15 && (cur = k));
    } else {
      const chosenIdx = lyr.map((l2, k) => (l2.chosen ? k : -1)).filter((k) => k >= 0);
      cur = chosenIdx[Math.min(chosenIdx.length - 1, Math.floor(tt / (DUR / chosenIdx.length)))] ?? 0;
    }
    pos += (cur - pos) * 0.16; // défilement doux
    const mid = box.top + (box.bottom - box.top) * 0.18; // ligne jouée vers le haut de la zone des paroles
    x.save();
    x.beginPath();
    x.rect(0, box.top, W, box.bottom - box.top);
    x.clip();
    // Position de chaque ligne : la ligne « pos » est au milieu, les autres au-dessus / en dessous
    const blocks = lyrBlocks;
    const hOf = (b) => b.r.length * b.size * 1.1 + 34;
    let base = Math.floor(pos);
    let yAt = mid - (pos - base) * hOf(blocks[base] || blocks[0]);
    const ys = [];
    ys[base] = yAt;
    for (let k = base + 1; k < blocks.length; k++) ys[k] = ys[k - 1] + hOf(blocks[k - 1]);
    for (let k = base - 1; k >= 0; k--) ys[k] = ys[k + 1] - hOf(blocks[k]);
    blocks.forEach((b) => {
      const d = Math.abs(b.k - pos);
      x.globalAlpha = Math.max(0, d < 1 ? 1 - d * 0.62 : 0.38 - (d - 1) * 0.1);
      if (x.globalAlpha <= 0.02) return;
      x.fillStyle = t.fg;
      x.font = `900 ${b.size}px ${font}`;
      b.r.forEach((row, j) => x.fillText(row, 80, ys[b.k] + b.size + j * b.size * 1.1));
    });
    x.restore();
    x.globalAlpha = 1;
  }
  draw(0);
  if (withAudio) {
    await ac.resume().catch(() => {});
    const src = ac.createBufferSource();
    src.buffer = audio.buf;
    src.connect(audio.gain);
    const now = ac.currentTime + 0.05;
    audio.gain.gain.setValueAtTime(0, now);
    audio.gain.gain.linearRampToValueAtTime(1, now + 0.6);
    audio.gain.gain.setValueAtTime(1, now + DUR - 1.2);
    audio.gain.gain.linearRampToValueAtTime(0, now + DUR);
    src.start(now, audio.offset, DUR + 0.2);
  }
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
  const vidLabel = `Vidéo animée (${Math.round(c.duration || 10)} s)`;
  const img = await cardImage(c, format);
  const url = URL.createObjectURL(img);
  const mobile = window.Capacitor?.isNativePlatform?.() || /iphone|ipad|android/i.test(navigator.userAgent);
  const ov = document.createElement('div');
  ov.className = 'story-save story-export';
  ov.innerHTML = `<div class="ss-box"><img src="${url}" alt="Aperçu">
    <div class="se-btns">
      ${canRecordVideo() ? `<button class="btn primary" data-x="video">${vidLabel}</button>` : ''}
      ${canRecordVideo() && c.music ? `<label class="se-music"><input type="checkbox" id="se-sound" checked> Avec le son : <b>${String(c.music.title).replace(/[<>&]/g, '')}</b></label>` : ''}
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
      // Le son est préparé tout de suite (pendant le clic), sinon le navigateur peut le bloquer
      const sound = ov.querySelector('#se-sound')?.checked && c.music;
      const ac = sound ? new (window.AudioContext || window.webkitAudioContext)() : null;
      try {
        const vid = await cardVideo(c, format, (p) => (b.textContent = `Création… ${Math.round(p * 100)} %`), { music: sound ? c.music : null, ac });
        ac?.close().catch(() => {});
        hint.textContent = '';
        b.textContent = vidLabel;
        await shareFile(vid, name.replace(/\.png$/, vid.type.includes('mp4') ? '.mp4' : '.webm'));
      } catch (err) {
        hint.textContent = `Vidéo impossible : ${err.message}`;
      } finally {
        b.disabled = false;
        if (b.textContent.startsWith('Création')) b.textContent = vidLabel;
      }
    }
  });
}

// Image Story du résumé (utilisée aussi par la page des stats)
// ---------- Palette tirée de la pochette (carte résumé) ----------
// On lit vraiment les pixels de la pochette : couleurs les plus présentes (regroupées par teinte proche) et couleur
// la plus vive. Fond = teinte principale assombrie, formes = couleur vive, texte = blanc ou foncé selon le fond.
const hexOf = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const satOf = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const mixRgb = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
export async function coverTheme(url) {
  const img = await loadImg(url);
  if (!img) return null;
  const N = 48;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, N, N);
  let data;
  try {
    data = x.getImageData(0, 0, N, N).data;
  } catch {
    return null; // image protégée (CORS) : on garde le thème habituel
  }
  // Regroupement par couleurs proches (4 bits par canal), avec la moyenne réelle de chaque groupe
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const k = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    k.n++; k.r += r; k.g += g; k.b += b;
    buckets.set(key, k);
  }
  const groups = [...buckets.values()].map((k) => ({ n: k.n, c: [k.r / k.n, k.g / k.n, k.b / k.n] })).sort((a, b) => b.n - a.n);
  // Teinte principale : la plus présente en ignorant les blancs et noirs extrêmes (bords, fonds unis)
  const mid = groups.filter((g) => lum(g.c) > 0.06 && lum(g.c) < 0.92 && g.n >= N * N * 0.01);
  const dom = (mid[0] || groups[0]).c;
  // Couleur vive : saturée et lumineuse, bien présente dans l'image
  const vivid = groups.filter((g) => g.n >= N * N * 0.008 && lum(g.c) > 0.15).sort((a, b) => satOf(b.c) * (0.4 + lum(b.c)) * Math.sqrt(b.n) - satOf(a.c) * (0.4 + lum(a.c)) * Math.sqrt(a.n))[0]?.c || dom;
  // Deuxième couleur : la plus présente qui ne ressemble ni à la principale ni à la vive
  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 70;
  const second = (mid.find((g) => far(g.c, dom) && far(g.c, vivid)) || {}).c || mixRgb(vivid, [255, 255, 255], 0.4);
  const base = satOf(dom) < 0.12 && satOf(vivid) > 0.2 ? mixRgb(dom, vivid, 0.3) : dom; // pochette grise : une pointe de sa couleur
  // Fond à une luminosité choisie (sombre mais pas noir), dans la teinte de la pochette
  const toLum = (c, target) => {
    const l = lum(c) || 0.001;
    return l > target ? mixRgb(c, [0, 0, 0], 1 - target / l) : mixRgb(c, mixRgb(vivid, [255, 255, 255], 0.2), Math.min(0.6, (target - l) / Math.max(0.05, lum(vivid) - l)));
  };
  const bg = toLum(base, 0.07);
  const bg2 = toLum(base, 0.17);
  const dark = lum(bg) < 0.45;
  return {
    bg: hexOf(bg),
    bg2: hexOf(bg2),
    fg: dark ? '#ffffff' : '#12091f',
    shape: hexOf(satOf(vivid) > 0.15 ? vivid : mixRgb(vivid, [255, 255, 255], 0.35)),
    alt: hexOf(second),
    fromCover: true,
  };
}
// Applique la palette de la pochette à la carte résumé (garde ses formes)
async function themeSummaryFromCover(c) {
  if (!c?.img) return c;
  const th = await coverTheme(c.img).catch(() => null);
  if (th) c.theme = { ...th, shapeSet: c.theme?.shapeSet || 'blobs' };
  return c;
}

// Durée de la vidéo de paroles : de la 1re ligne choisie jusqu'au début de la ligne qui suit la dernière (le passage
// exact du son), entre 5 et 30 s ; paroles non synchronisées : 10 s
function lyricsDuration(lyr, at) {
  if (!lyr?.synced || at == null) return 10;
  const ls2 = lyr.lines;
  const last = ls2.map((l2, k) => (l2.chosen ? k : -1)).filter((k) => k >= 0).pop();
  const end = ls2[last + 1]?.t ?? (ls2[last]?.t ?? at) + 4;
  return Math.max(5, Math.min(30, end - at + 1.2));
}

// Story de paroles : couleurs de la pochette, fond animé, et le passage du son qui correspond aux lignes choisies
export async function shareLyricsStory(track, lines, at = null, lyr = null) {
  const seed = Math.floor(Date.now() / 1000);
  const artist = (track.artists || []).map((a) => a.name).join(', ');
  const c = {
    kind: 'lyrics', kicker: pickFrom(['🎤 En boucle dans ma tête', '🎧 Ce passage…', '💬 Les mots justes', '🔁 Je l’ai en tête', '🔥 Ce son'], seed),
    title: track.title, artist, lines, img: track.thumb, music: track, musicAt: at, lyr, duration: lyricsDuration(lyr, at),
    theme: { bg: '#130a24', bg2: '#2a1650', fg: '#ffffff', shape: '#b07cf7', alt: '#2ef28b', shapeSet: pickFrom(['blobs', 'rings', 'waves'], seed) },
    style: pickFrom(['waves', 'plasma', 'rings', 'stars'], seed),
  };
  await themeSummaryFromCover(c);
  return exportSheet(c, 'story', `boombox-paroles-${String(track.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}.png`);
}

// Ton récap (stats sur 7 jours, 30 jours, tout…) : même fenêtre d'export que le récap animé (vidéo ou image).
// Couleurs, fond animé et tournures changent à chaque export.
export async function shareStatsStory(s, { title, name }) {
  const seed = Math.floor(Date.now() / 1000);
  const period = ['year', 'week', 'month', 'day'][seed % 4];
  const { cards } = buildCards(s, { label: title, tag: 'en ce moment', name: title }, period, seed);
  const c = cards.find((x) => x.kind === 'summary');
  c.kicker = title;
  c.music = s.topTracks[0]?.track || null;
  c.style = pickFrom(['waves', 'plasma', 'rings', 'stars', 'rain'], seed);
  await themeSummaryFromCover(c);
  return exportSheet(c, 'story', name);
}

export async function storyFrom(s, range) {
  const { cards } = buildCards(s, { label: range.label, tag: range.tag, name: range.label }, 'other');
  return cardImage(await themeSummaryFromCover(cards.find((c) => c.kind === 'summary')), 'story');
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
  themeSummaryFromCover(cards.find((c) => c.kind === 'summary'));
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
      const bd = cardBackdrop(cards[i]);
      pixelBackdrop(slot.querySelector('.wr-card'), bd.palette, bd.opts);
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
