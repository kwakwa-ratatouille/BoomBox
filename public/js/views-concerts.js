// Concerts près de chez toi : concerts à venir des artistes que tu suis (annoncés sur Spotify), triés par date,
// filtrés selon la distance à ta position (position du navigateur, ou une ville que tu tapes).
import { html, icon, plural, toast, debounce } from './ui.js';
import { state, api, ls } from './state.js';

const RADII = [[50, '50 km'], [100, '100 km'], [250, '250 km'], [0, 'Partout']];

function km(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fmtDate = (iso) => {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('fr-FR', { day: 'numeric' }),
    month: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
    full: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (iso.includes('T') ? ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''),
  };
};

export function concertCard(c, here) {
  const d = fmtDate(c.date);
  const dist = here && c.lat != null ? Math.round(km(here, c)) : null;
  return html`<a class="concert" href="${c.url}" target="_blank" rel="noopener"><div class="concert-date"><b>${d.day}</b><span>${d.month}</span></div>
    <div class="concert-info"><b class="ellipsis">${c.artist || c.title}${c.festival ? html` <span class="tag">FESTIVAL</span>` : ''}</b><span class="ellipsis">${c.venue}${c.city ? ` · ${c.city}` : ''}</span><span class="muted ellipsis">${d.full}${dist != null ? ` · à ${dist} km` : ''}</span></div>
    <span class="concert-go">${icon('forward', 18)}</span></a>`;
}

export async function concerts(el, _p, ctx) {
  let here = ls.get('boombox.geo', null);
  let radius = ls.get('boombox.geoRadius', 100);
  let data = { concerts: [], pending: 0 };
  let timer = null;

  const load = async () => {
    const names = state.library.follows.map((f) => f.name).filter(Boolean);
    if (!names.length) return render();
    data = await api('/api/concerts', { method: 'POST', body: { names } }).catch(() => data);
    if (!ctx.alive()) return;
    render();
    clearTimeout(timer);
    if (data.pending) timer = setTimeout(load, 5000); // artistes encore en cours de récupération
  };

  const render = () => {
    const all = data.concerts;
    const near = here && radius ? all.filter((c) => c.lat != null && km(here, c) <= radius) : all;
    el.innerHTML = String(html`<div class="page" style="max-width:900px">
      <h1>Concerts près de chez toi</h1>
      <p class="muted">Les concerts à venir des ${plural(state.library.follows.length, 'artiste')} que tu suis, d'après Spotify.</p>
      <div class="geo-bar">
        <span class="geo-where">${icon('pin', 16)}${here ? here.label : 'Position non définie'}</span>
        <button class="outline-btn" id="geo-me">Utiliser ma position</button>
        <div class="search-box geo-city"><input id="geo-city" placeholder="ou tape ta ville…" autocomplete="off"></div>
        <div class="chips">${RADII.map(([r, label]) => html`<button class="chip ${radius === r ? 'active' : ''}" data-r="${r}">${label}</button>`)}</div>
      </div>
      ${data.pending ? html`<p class="muted" style="font-size:13px">Recherche des concerts… encore ${plural(data.pending, 'artiste')} à vérifier.</p>` : ''}
      ${!state.library.follows.length ? html`<div class="empty">${icon('bell')}<h2>Suis des artistes</h2><p>Abonne-toi à tes artistes préférés pour voir leurs concerts ici.</p></div>`
        : near.length ? html`<div class="concert-list">${near.map((c) => concertCard(c, here))}</div>`
        : html`<div class="empty"><h2>Aucun concert ${here && radius ? `à moins de ${radius} km` : 'annoncé'}</h2><p>${here && radius ? 'Élargis la distance pour voir plus loin.' : 'Reviens bientôt : la liste se met à jour chaque semaine.'}</p></div>`}
      ${here && radius && near.length < all.length ? html`<p class="muted" style="margin-top:16px">${plural(all.length - near.length, 'autre concert')} plus loin (choisis « Partout » pour les voir).</p>` : ''}
    </div>`);
    el.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => ((radius = +b.dataset.r), ls.set('boombox.geoRadius', radius), render())));
    el.querySelector('#geo-me').onclick = () => {
      if (!navigator.geolocation) return toast('Position indisponible sur cet appareil');
      navigator.geolocation.getCurrentPosition(
        (p) => {
          here = { lat: p.coords.latitude, lon: p.coords.longitude, label: 'Ma position' };
          ls.set('boombox.geo', here);
          render();
        },
        () => toast('Position refusée : tape plutôt ta ville'),
        { timeout: 10000 },
      );
    };
    const city = el.querySelector('#geo-city');
    city.onkeydown = debounce(async (e) => {
      if (e.key !== 'Enter' || !city.value.trim()) return;
      // Ville → coordonnées (OpenStreetMap, gratuit)
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(city.value.trim())}`).then((x) => x.json()).catch(() => []);
      if (!r[0]) return toast('Ville introuvable');
      here = { lat: +r[0].lat, lon: +r[0].lon, label: r[0].display_name.split(',')[0] };
      ls.set('boombox.geo', here);
      render();
    }, 50);
  };

  render();
  load();
  return { onLibrary: () => {}, cleanup: () => clearTimeout(timer) };
}
