// Classement Boombox : tous les utilisateurs qui partagent leur activité, classés par minutes d'écoute,
// nombre d'écoutes, artistes ou titres différents, sur la semaine, le mois ou l'année en cours.
// Un appui ouvre le profil (ajouter en ami, voir ses playlists et son top).
import { html, icon, plural } from './ui.js';
import { db, collection, getDocs, query, limit } from './cloud.js';
import { social } from './social.js';
import { avatar } from './views-social.js';
import { pixelBackdrop, RANKING_PALETTE } from './pixel-bg.js';

const PERIODS = [['week', 'Cette semaine'], ['month', 'Ce mois-ci'], ['year', 'Cette année'], ['all', 'Depuis toujours']];
const METRICS = [
  ['minutes', "Minutes d'écoute", (n) => `${n.toLocaleString('fr-FR')} min`],
  ['plays', 'Écoutes', (n) => plural(n, 'écoute')],
  ['artists', 'Artistes différents', (n) => plural(n, 'artiste')],
  ['tracks', 'Titres différents', (n) => plural(n, 'titre')],
];

let people = null;
let loadedAt = 0;
async function loadPeople() {
  if (people && Date.now() - loadedAt < 120e3) return people;
  const snap = await getDocs(query(collection(db, 'people'), limit(1000)));
  people = snap.docs.map((d) => ({ code: d.id, ...d.data() }));
  loadedAt = Date.now();
  return people;
}

// Chiffres encore valables pour la période (une semaine passée ne compte plus)
function valueOf(p, period, metric) {
  const s = p.stats;
  if (!s?.[period]) return 0;
  const now = new Date();
  const start = { week: new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime(), month: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), year: new Date(now.getFullYear(), 0, 1).getTime(), all: 0 }[period];
  if ((s[`${period}0`] || 0) < start) return 0;
  return s[period][metric] || 0;
}

export async function rankingPage(el, params, ctx) {
  let period = params.period || 'week';
  let metric = params.metric || 'minutes';
  el.innerHTML = '<div class="page"><p class="muted">Chargement du classement…</p></div>';
  let list;
  try {
    list = await loadPeople();
  } catch (e) {
    el.innerHTML = String(html`<div class="page"><div class="empty"><h2>Classement indisponible</h2><p class="muted">${e.message}</p></div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  // En-tête (logo + fond animé) dessiné une seule fois ; seule la liste est redessinée quand on change d'onglet
  el.innerHTML = String(html`<div class="page rk-page">
    <div class="ai-head ai-hero rk-hero"><img class="ai-badge" src="/assets/pixel/section-ranking.png" alt=""><div><h1>Classement</h1><p class="muted">Tous les utilisateurs de Boombox qui partagent leur activité. Appuie sur quelqu'un pour voir son profil, l'ajouter en ami ou enregistrer ses playlists.</p></div></div>
    <div class="rk-body"></div></div>`);
  pixelBackdrop(el.querySelector('.rk-hero'), RANKING_PALETTE, { accents: ['#FFD34D', '#ffffff'] });
  const body = el.querySelector('.rk-body');
  const render = () => {
    const fmt = METRICS.find((m) => m[0] === metric)[2];
    const ranked = list.filter((p) => p.share !== false && p.name).map((p) => ({ p, v: valueOf(p, period, metric) })).sort((a, b) => b.v - a.v || a.p.name.localeCompare(b.p.name));
    const active = ranked.filter((r) => r.v > 0);
    const rest = ranked.filter((r) => r.v === 0);
    const me = social.code;
    const row = (r, i) => html`<a class="rk-row ${r.p.code === me ? 'me' : ''}" href="${r.p.code === me ? '#/profile' : `#/user/${r.p.code}`}">
      <span class="rk-n ${i < 3 && r.v ? `top${i + 1}` : ''}">${r.v ? i + 1 : '–'}</span>
      <div class="fa-av">${avatar({ name: r.p.name, photo: r.p.photo, color: r.p.color })}</div>
      <div class="rk-main"><b class="ellipsis">${r.p.name}${r.p.code === me ? ' (toi)' : ''}</b>
        <span class="muted ellipsis">${social.isAdded(r.p.code) ? 'Ami' : r.p.code === me ? 'Ton profil' : 'Voir le profil'}${r.p.top?.artists?.[0] ? ` · fan de ${r.p.top.artists[0].name}` : ''}</span></div>
      <span class="rk-v">${r.v ? fmt(r.v) : ''}</span></a>`;
    body.innerHTML = String(html`
      <div class="row-flex rk-tabs">${PERIODS.map(([k, l]) => html`<button class="chip ${k === period ? 'active' : ''}" data-p="${k}">${l}</button>`)}</div>
      <div class="row-flex rk-tabs">${METRICS.map(([k, l]) => html`<button class="chip ${k === metric ? 'active' : ''}" data-m="${k}">${l}</button>`)}</div>
      ${active.length >= 3 ? html`<div class="rk-podium">${[1, 0, 2].map((i) => html`<a class="rk-pod p${i + 1}" href="${active[i].p.code === me ? '#/profile' : `#/user/${active[i].p.code}`}">${avatar({ name: active[i].p.name, photo: active[i].p.photo, color: active[i].p.color })}<b class="ellipsis">${active[i].p.name}</b><span>${fmt(active[i].v)}</span><i>${i + 1}</i></a>`)}</div>` : ''}
      <div class="rk-list">${active.map(row)}</div>
      ${!active.length ? html`<p class="muted">Personne n'a encore écouté sur cette période.</p>` : ''}
      ${rest.length ? html`<h3 style="margin:24px 0 8px;font-size:16px">Autres utilisateurs</h3><div class="rk-list">${rest.map((r) => row(r, 0))}</div>` : ''}
      <p class="muted" style="font-size:12px;margin-top:20px">${icon('info', 14)} Les chiffres se mettent à jour toutes les heures. Désactive « Partager mon activité d'écoute » dans les paramètres pour ne pas apparaître.</p>`);
    body.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => ((period = b.dataset.p), render())));
    body.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => ((metric = b.dataset.m), render())));
  };
  render();
}
