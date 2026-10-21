// « Ton récap » : statistiques d'écoute complètes (chiffres clés, évolution, habitudes, tops, découvertes).
// Graphiques : une seule série (couleur d'accent), barres fines arrondies, info-bulle au survol,
// et un tableau équivalent pour chaque graphique (accessibilité).
import { pixelBackdrop, accentPalette } from './pixel-bg.js';
import { html, raw, icon, plural, esc } from './ui.js';
import { getStatsFull } from './state.js';
import { cover, card, trackList, rememberTracks } from './components.js';
import { storyFrom } from './views-wrapped.js';
import { shareStory } from './story.js';
import { toast } from './ui.js';

const PERIODS = [[7, '7 jours'], [30, '30 jours'], [90, '3 mois'], [365, '1 an'], [3650, 'Tout']];
const WEEK = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const fmtN = (n) => Math.round(n).toLocaleString('fr-FR');

function delta(cur, prev) {
  if (!prev) return '';
  const d = Math.round(((cur - prev) / prev) * 100);
  const up = d >= 0;
  return html`<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(d)} %</span>`;
}

// Graphique en barres (une série). data : [{ label, value, tip }]
function barChart(data, { title, labelEvery = 1, unit = 'écoute' }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = Math.ceil(max / 5) * 5 || 5;
  return html`<figure class="chart" aria-label="${title}">
    <div class="chart-plot">
      <div class="chart-grid"><span>${fmtN(nice)}</span><span>${fmtN(nice / 2)}</span><span>0</span></div>
      <div class="chart-bars" style="--n:${data.length}">
        ${data.map((d) => html`<div class="bar-slot" tabindex="0" aria-label="${d.tip}: ${plural(d.value, unit)}">
          <div class="bar" style="height:${(d.value / nice) * 100}%"></div>
          <div class="bar-tip"><b>${plural(d.value, unit)}</b><span>${d.tip}</span></div>
        </div>`)}
      </div>
    </div>
    <div class="chart-x" style="--n:${data.length}">${data.map((d, i) => html`<span>${i % labelEvery === 0 ? d.label : ''}</span>`)}</div>
    <details class="chart-table"><summary>Voir en tableau</summary><table>${data.map((d) => html`<tr><td>${d.tip}</td><td>${fmtN(d.value)}</td></tr>`)}</table></details>
  </figure>`;
}

export async function statsPage(el, params, ctx) {
  const days = Number(params.days) || 30;
  el.innerHTML = String(html`<div class="page stats-page"><h1 class="stats-title">Ton récap</h1>
    <div class="search-tabs">${PERIODS.map(([d, l]) => html`<a class="chip ${d === days ? 'active' : ''}" href="#/stats?days=${d}">${l}</a>`)}</div>
    <div class="stat-grid">${raw('<div class="sk" style="height:96px"></div>'.repeat(4))}</div><div class="sk" style="height:260px"></div></div>`);
  const s = await getStatsFull(days);
  if (!ctx.alive()) return;
  rememberTracks(s.topTracks.map((t) => t.track));

  const series = s.series.map(([k, v]) => {
    const d = new Date(k.length === 7 ? k + '-15' : k);
    return s.daily
      ? { label: days <= 7 ? WEEK[(d.getDay() + 6) % 7] : String(d.getDate()), value: v, tip: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }
      : { label: MONTHS[d.getMonth()], value: v, tip: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
  });
  const hours = s.hours.map((v, h) => ({ label: h % 3 === 0 ? `${h}h` : '', value: v, tip: `${h}h – ${h + 1}h` }));
  const weekdays = s.weekdays.map((v, i) => ({ label: WEEK[i], value: v, tip: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'][i] }));
  const favHour = s.hours.indexOf(Math.max(...s.hours));
  const favDay = s.weekdays.indexOf(Math.max(...s.weekdays));
  const maxA = s.topArtists[0]?.count || 1;
  const periodLabel = PERIODS.find(([d]) => d === days)?.[1].toLowerCase();
  // Partage de ces stats en image Story (Insta…)
  const share = async () => {
    toast('Création de l’image…');
    const label = PERIODS.find(([d]) => d === days)?.[1] || '';
    shareStory(await storyFrom(s, { label: `Mes stats · ${label}` }), `boombox-stats-${days}j.png`);
  };

  el.innerHTML = String(html`<div class="page stats-page">
    <div class="row-flex stats-hero" style="justify-content:space-between"><h1 class="stats-title">Ton récap</h1><div class="row-flex">${s.plays ? html`<button class="btn ghost" id="st-share">${icon('share', 18)} Partager en Story</button>` : ''}<a class="btn wrapped-btn" href="#/wrapped">✨ Récap animé (jour, semaine, mois, année)</a></div></div>
    <div class="search-tabs">${PERIODS.map(([d, l]) => html`<a class="chip ${d === days ? 'active' : ''}" href="#/stats?days=${d}">${l}</a>`)}</div>
    ${!s.hasImported ? html`<p class="muted" style="margin-top:-8px">Astuce : importe ton historique Spotify (Importer une playlist → Données Spotify) pour inclure tes écoutes passées.</p>` : ''}
    ${!s.plays ? html`<div class="empty"><h2>Pas encore d'écoutes sur cette période</h2><p>Lance de la musique, ton récap se remplira tout seul.</p></div>` : html`

    <div class="stat-grid">
      <div class="stat"><b>${fmtN(s.minutes)}</b>minutes d'écoute ${days < 3650 ? delta(s.minutes, s.prevMinutes) : ''}<small>${fmtN(s.minutes / 60)} h au total</small></div>
      <div class="stat"><b>${fmtN(s.plays)}</b>écoutes ${days < 3650 ? delta(s.plays, s.prevPlays) : ''}<small>${s.perDay.toFixed(1).replace('.', ',')} par jour en moyenne</small></div>
      <div class="stat"><b>${fmtN(s.uniqueArtists)}</b>artistes différents<small>${fmtN(s.uniqueTracks)} titres différents</small></div>
      <div class="stat"><b>${s.streak} j</b>de suite en ce moment<small>Record : ${s.bestStreak} jours d'affilée</small></div>
    </div>

    <section class="section"><div class="section-head"><h2>${s.daily ? 'Écoutes par jour' : 'Écoutes par mois'}</h2>${s.peak?.[1] ? html`<span class="muted">Record : ${plural(s.peak[1], 'écoute')} le ${new Date(s.peak[0]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</span>` : ''}</div>
      ${barChart(series, { title: 'Écoutes par période', labelEvery: s.daily && days > 7 ? 3 : 1 })}</section>

    <div class="stats-2col">
      <section class="section"><div class="section-head"><h2>Tes heures d'écoute</h2>${s.hasLive && s.hours.some(Boolean) ? html`<span class="muted">Surtout vers ${favHour}h</span>` : ''}</div>
        ${s.hours.some(Boolean) ? barChart(hours, { title: "Écoutes par heure de la journée" }) : html`<p class="muted">Disponible pour les écoutes faites dans Boombox.</p>`}</section>
      <section class="section"><div class="section-head"><h2>Tes jours d'écoute</h2>${s.weekdays.some(Boolean) ? html`<span class="muted">Surtout le ${['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][favDay]}</span>` : ''}</div>
        ${s.weekdays.some(Boolean) ? barChart(weekdays, { title: 'Écoutes par jour de la semaine' }) : html`<p class="muted">Pas assez de données.</p>`}</section>
    </div>

    <div class="stats-2col">
      <section class="section"><div class="section-head"><h2>Top artistes</h2><span class="muted">${periodLabel}</span></div>
        ${s.topArtists.map((a, i) => html`<a class="rank" href="${a.artist.id ? `#/artist/${a.artist.id}` : '#/stats'}"><span class="n">${i + 1}</span>${cover({ thumb: a.thumb }, 'round', 96)}
          <div style="flex:1;min-width:0"><b class="ellipsis" style="display:block">${a.artist.name}</b><div class="muted" style="font-size:12px">${plural(a.count, 'écoute')} · ${fmtN(a.seconds / 60)} min</div><div class="bar-line"><div style="width:${(a.count / maxA) * 100}%"></div></div></div></a>`)}</section>
      <section class="section"><div class="section-head"><h2>Top titres</h2><span class="muted">${periodLabel}</span></div>
        ${s.topTracks.length ? trackList(s.topTracks.map((t) => ({ ...t.track, plays: plural(t.count, 'écoute') })), { context: { type: 'top', name: `Top titres · ${periodLabel}` }, plays: true }) : html`<p class="muted">—</p>`}</section>
    </div>

    ${s.topAlbums.length ? html`<section class="section"><div class="section-head"><h2>Top albums</h2></div>
      <div class="cards row">${s.topAlbums.map((a) => card({ type: 'album', id: a.album.id, title: a.album.name, thumb: a.thumb }, { sub: `${a.artist?.name || ''} · ${plural(a.count, 'écoute')}`, href: a.album.id ? `#/album/${a.album.id}` : '', play: a.album.id ? `album:${a.album.id}` : '' }))}</div></section>` : ''}

    ${s.discoveries.length ? html`<section class="section"><div class="section-head"><div><h2>Tes découvertes</h2><div class="muted">Artistes écoutés pour la première fois ces ${periodLabel}</div></div></div>
      <div class="cards row">${s.discoveries.map((a) => card({ type: 'artist', id: a.artist.id, name: a.artist.name, thumb: a.thumb }, { sub: plural(a.count, 'écoute'), href: a.artist.id ? `#/artist/${a.artist.id}` : '', play: a.artist.id ? `artist:${a.artist.id}` : '' }))}</div></section>` : ''}
    `}
  </div>`);
  pixelBackdrop(el.querySelector('.stats-hero'), accentPalette(), { accents: ['#FFD34D'] });
  el.querySelector('#st-share')?.addEventListener('click', share);
}
