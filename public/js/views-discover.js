// Découverte : nouveaux artistes et sons, par style ou « pour toi » (basé sur des artistes de référence).
import { html, icon, plural, toast, debounce, contextMenu } from './ui.js';
import { state, api, ls, setting, saveSettings, getStats, toggleFollow, isFollowing } from './state.js';
import { ctl } from './player.js';
import { card, cover, trackList, playlistSubmenu, openPlaylistPicker } from './components.js';

const STYLES = ['Pour toi', 'Rap français', 'Rap US', 'Pop', 'R&B', 'Afro', 'Électro', 'House', 'Rock', 'Indé', 'Drill', 'Reggaeton', 'K-pop', 'Lo-fi', 'Jazz', 'Variété française', 'Années 2000'];
let last = null; // résultats gardés en mémoire (on peut changer de page et revenir)

export async function discoverPage(el, _p, ctx) {
  let style = ls.get('boombox.discoverStyle', 'Pour toi');

  // Artistes de référence : tes abonnements + ceux ajoutés ici (réglage du profil)
  const extraSeeds = () => setting('discoverSeeds', []);
  const seeds = () => {
    const out = [...state.library.follows.map((f) => ({ id: f.id, name: f.name, thumb: f.thumb, follow: true }))];
    for (const s of extraSeeds()) if (!out.some((x) => x.id === s.id)) out.push(s);
    return out;
  };

  const render = () => {
    el.innerHTML = String(html`<div class="page">
      <div class="ai-head"><span class="ai-badge" style="background:linear-gradient(135deg,#ff4d8d,#ff9f2e)">${icon('radio', 28)}</span><div><h1>Découverte</h1><p class="muted">De nouveaux artistes et sons, pris hors de ce que tu écoutes déjà.</p></div></div>
      <div class="search-tabs">${STYLES.map((s) => html`<button class="chip ${s === style ? 'active' : ''}" data-style="${s}">${s}</button>`)}</div>
      ${style === 'Pour toi' ? html`<div class="np-card seeds">
        <h4>Basé sur ces artistes <span class="muted" style="font-weight:400;font-size:13px">(tes abonnements + ceux que tu ajoutes)</span></h4>
        <div class="seed-list">${seeds().length ? seeds().map((s) => html`<span class="seed">${cover(s, 'round', 64)}${s.name}${s.follow ? '' : html`<button data-unseed="${s.id}" aria-label="Retirer">${icon('close', 14)}</button>`}</span>`) : html`<span class="muted">Ajoute quelques artistes que tu aimes pour lancer les suggestions.</span>`}</div>
        <div class="search-box seed-search"><input id="seed-q" placeholder="Ajouter un artiste de référence…" autocomplete="off"><div id="seed-res" class="suggest hidden"></div></div>
      </div>` : ''}
      <div class="row-flex" style="margin:8px 0 24px">
        <button class="btn primary" id="dc-shuffle">${icon('shuffle', 18)} Sons aléatoires</button>
        <button class="btn ghost" id="dc-refresh">Actualiser</button>
        <button class="btn ghost" id="dc-addall">Tout ajouter à une playlist</button>
      </div>
      <div id="dc-results">${last && last.style === style ? '' : '<div class="sk-page"><div class="sk sk-title"></div><div class="sk-cards">' + '<div class="sk sk-card"></div>'.repeat(6) + '</div></div>'}</div>
    </div>`);
    el.querySelectorAll('[data-style]').forEach((b) => (b.onclick = () => {
      style = b.dataset.style;
      ls.set('boombox.discoverStyle', style);
      render();
      if (!last || last.style !== style) load();
    }));
    el.querySelectorAll('[data-unseed]').forEach((b) => (b.onclick = async () => {
      await saveSettings({ discoverSeeds: extraSeeds().filter((s) => s.id !== b.dataset.unseed) });
      render();
    }));
    wireSeedSearch();
    el.querySelector('#dc-shuffle').onclick = () => {
      if (!last?.tracks.length) return toast('Rien à lire pour le moment');
      const list = last.tracks.slice().sort(() => Math.random() - 0.5);
      ctl.playList(list, 0, { type: 'discover', name: `Découverte · ${style}` });
    };
    el.querySelector('#dc-refresh').onclick = () => load();
    el.querySelector('#dc-addall').onclick = (e) => {
      if (!last?.tracks.length) return;
      const r = e.currentTarget.getBoundingClientRect();
      openPlaylistPicker(last.tracks, { x: r.left + r.width / 2, y: r.top });
    };
    if (last && last.style === style) showResults();
  };

  function wireSeedSearch() {
    const input = el.querySelector('#seed-q');
    const box = el.querySelector('#seed-res');
    if (!input) return;
    input.addEventListener('input', debounce(async () => {
      const q = input.value.trim();
      if (!q) return box.classList.add('hidden');
      const { items } = await api(`/api/search?q=${encodeURIComponent(q)}&type=artist`);
      box.innerHTML = items.slice(0, 6).map((a) => String(html`<button data-seed="${a.id}">${cover(a, 'round', 64)}<span>${a.name}</span></button>`)).join('');
      box.classList.toggle('hidden', !items.length);
      box.querySelectorAll('[data-seed]').forEach((b) => (b.onmousedown = async () => {
        const a = items.find((x) => x.id === b.dataset.seed);
        await saveSettings({ discoverSeeds: [...extraSeeds(), { id: a.id, name: a.name, thumb: a.thumb }].slice(-30) });
        render();
        load();
      }));
    }, 250));
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 200));
  }

  async function load() {
    const out = el.querySelector('#dc-results');
    if (out) out.innerHTML = '<div class="sk-page"><div class="sk sk-title"></div><div class="sk-cards">' + '<div class="sk sk-card"></div>'.repeat(6) + '</div></div>';
    // Artistes déjà connus : abonnements, likes et artistes écoutés récemment
    const known = new Set(state.library.follows.map((f) => f.name));
    state.library.liked.forEach((t) => t.artists?.[0] && known.add(t.artists[0].name));
    const s = await getStats(90).catch(() => null);
    s?.topArtists.forEach((a) => known.add(a.artist.name));
    const s2 = seeds();
    if (style === 'Pour toi' && !s2.length && s?.topArtists.length) {
      // Pas encore d'abonnements : on part des artistes les plus écoutés
      s2.push(...s.topArtists.filter((a) => a.artist.id).map((a) => ({ id: a.artist.id, name: a.artist.name })));
    }
    try {
      const r = await api('/api/discover', { method: 'POST', body: { seeds: s2, known: [...known], genre: style === 'Pour toi' ? '' : style } });
      last = { style, ...r };
    } catch (e) {
      if (out) out.innerHTML = String(html`<p style="color:var(--danger)">${e.message}</p>`);
      return;
    }
    if (ctx.alive()) showResults();
  }

  function showResults() {
    const out = el.querySelector('#dc-results');
    if (!out || !last) return;
    if (!last.tracks.length && !last.artists.length) {
      out.innerHTML = '<p class="muted">Pas de suggestions pour le moment. Ajoute des artistes de référence ou choisis un style.</p>';
      return;
    }
    out.innerHTML = String(html`
      ${last.artists.length ? html`<section class="section"><div class="section-head"><h2>Nouveaux artistes</h2></div>
        <div class="cards row">${last.artists.map((a) => html`<div class="card" data-href="#/artist/${a.id}">${cover(a, 'round')}<button class="card-play" data-play="artist:${a.id}" aria-label="Lire">${icon('play')}</button><div class="card-title">${a.name}</div><button class="outline-btn" style="margin-top:8px" data-follow="${a.id}">${isFollowing(a.id) ? 'Abonné' : "S'abonner"}</button></div>`)}</div></section>` : ''}
      ${last.tracks.length ? html`<section class="section"><div class="section-head"><h2>Nouveaux sons</h2><span class="muted">${plural(last.tracks.length, 'titre')}</span></div>
        ${trackList(last.tracks, { context: { type: 'discover', name: `Découverte · ${last.style}` }, numbered: false })}</section>` : ''}`);
    // Bouton « + » sur chaque titre pour l'ajouter à une playlist
    out.querySelectorAll('.track').forEach((row, i) => {
      const b = document.createElement('button');
      b.className = 't-add';
      b.title = 'Ajouter à une playlist';
      b.innerHTML = String(icon('plus', 18));
      b.onclick = (e) => {
        e.stopPropagation();
        const r = b.getBoundingClientRect();
        openPlaylistPicker(last.tracks[i], { x: r.left + r.width / 2, y: r.top });
      };
      row.querySelector('.t-end').prepend(b);
    });
    out.querySelectorAll('[data-follow]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const a = last.artists.find((x) => x.id === b.dataset.follow);
      await toggleFollow(a);
      b.textContent = isFollowing(a.id) ? 'Abonné' : "S'abonner";
    }));
  }

  render();
  if (!last || last.style !== style) load();
}
