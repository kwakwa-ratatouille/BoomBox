// Découverte : nouveaux artistes et sons, par style ou « pour toi » (basé sur des artistes de référence).
import { html, raw, icon, plural, toast, debounce, contextMenu } from './ui.js';
import { state, api, ls, setting, saveSettings, getStats, toggleFollow, isFollowing } from './state.js';
import { ctl, startAt } from './player.js';
import { card, cover, trackList, playlistSubmenu, openPlaylistPicker } from './components.js';
import { pixelBackdrop, DISCOVER_PALETTE } from './pixel-bg.js';

const STYLES = ['Pour toi', 'Rap français', 'Rap US', 'Pop', 'R&B', 'Afro', 'Électro', 'House', 'Rock', 'Indé', 'Drill', 'Reggaeton', 'K-pop', 'Lo-fi', 'Jazz', 'Variété française', 'Années 2000'];
let last = null; // résultats gardés en mémoire (on peut changer de page et revenir)

export async function discoverPage(el, _p, ctx) {
  let style = ls.get('boombox.discoverStyle', 'Pour toi');

  // Artistes de référence choisis ici (réglage du profil). Aucun choisi : on part de tous les abonnements
  // (et des artistes les plus écoutés), sans les afficher un par un.
  const extraSeeds = () => setting('discoverSeeds', []);
  const followSeeds = () => state.library.follows.map((f) => ({ id: f.id, name: f.name, thumb: f.thumb }));
  const seeds = () => (extraSeeds().length ? extraSeeds() : followSeeds());
  const isSeed = (id) => extraSeeds().some((s) => s.id === id);
  let showFollows = ls.get('boombox.discoverFollowsOpen', false);
  const setSeeds = async (list) => {
    await saveSettings({ discoverSeeds: list.slice(-40) });
    render();
    load();
  };

  const render = () => {
    el.innerHTML = String(html`<div class="page">
      <div class="ai-head ai-hero"><img class="ai-badge" src="/assets/pixel/section-discover.png" alt=""><div><h1>Découverte</h1><p class="muted">De nouveaux artistes et sons, pris hors de ce que tu écoutes déjà.</p></div></div>
      <div class="search-tabs dc-styles">${STYLES.map((s) => html`<button class="chip ${s === style ? 'active' : ''}" data-style="${s}">${s}</button>`)}</div>
      ${style === 'Pour toi' ? html`<div class="np-card seeds">
        <div class="row-flex" style="justify-content:space-between;gap:12px;flex-wrap:wrap"><h4 style="margin:0">Basé sur ${extraSeeds().length ? plural(extraSeeds().length, 'artiste choisi') : 'tes abonnements et tes écoutes'}</h4>
          ${extraSeeds().length ? html`<button class="more muted" id="seed-clear">Tout retirer</button>` : ''}</div>
        ${extraSeeds().length
          ? html`<div class="seed-list">${extraSeeds().map((s) => html`<button class="seed on" data-unseed="${s.id}" title="Retirer">${cover(s, 'round', 64)}${s.name}${icon('close', 14)}</button>`)}</div>`
          : html`<p class="muted" style="margin:6px 0 10px;font-size:13px">Choisis des artistes (ci-dessous ou en cherchant) pour affiner les suggestions.</p>`}
        <div class="search-box seed-search"><input id="seed-q" placeholder="Ajouter un artiste de référence…" autocomplete="off"><div id="seed-res" class="suggest hidden"></div></div>
        ${state.library.follows.length ? html`<div class="seed-follows ${showFollows ? 'open' : ''}">
          <div class="row-flex" style="justify-content:space-between;margin:12px 0 6px"><span class="muted" style="font-size:13px">Tes abonnements (${state.library.follows.length}) · clique pour choisir</span><button class="outline-btn sm" id="seed-more">${showFollows ? 'Réduire' : `Voir les ${state.library.follows.length}`}</button></div>
          <div class="seed-list">${followSeeds().map((s) => html`<button class="seed ${isSeed(s.id) ? 'on' : ''}" data-toggle-seed="${s.id}">${cover(s, 'round', 64)}${s.name}</button>`)}</div></div>` : ''}
      </div>` : ''}
      <div class="row-flex" style="margin:8px 0 24px">
        <button class="btn primary" id="dc-shuffle">${icon('shuffle', 18)} Sons aléatoires</button>
        <button class="btn ghost" id="dc-refresh">Actualiser</button>
        <button class="btn ghost" id="dc-addall">Tout ajouter à une playlist</button>
      </div>
      <div id="dc-results">${last && last.style === style ? '' : raw('<div class="sk-page"><div class="sk sk-title"></div><div class="sk-cards">' + '<div class="sk sk-card"></div>'.repeat(6) + '</div></div>')}</div>
    </div>`);
    pixelBackdrop(el.querySelector('.ai-hero'), DISCOVER_PALETTE, { accents: ['#FFD34D', '#ffffff'] });
    el.querySelectorAll('[data-style]').forEach((b) => (b.onclick = () => {
      style = b.dataset.style;
      ls.set('boombox.discoverStyle', style);
      render();
      if (!last || last.style !== style) load();
    }));
    el.querySelectorAll('[data-unseed]').forEach((b) => (b.onclick = () => setSeeds(extraSeeds().filter((s) => s.id !== b.dataset.unseed))));
    el.querySelector('#seed-clear')?.addEventListener('click', () => setSeeds([]));
    el.querySelector('#seed-more')?.addEventListener('click', () => {
      showFollows = !showFollows;
      ls.set('boombox.discoverFollowsOpen', showFollows);
      render();
    });
    el.querySelectorAll('[data-toggle-seed]').forEach((b) => (b.onclick = () => {
      const f = followSeeds().find((x) => x.id === b.dataset.toggleSeed);
      setSeeds(isSeed(f.id) ? extraSeeds().filter((s) => s.id !== f.id) : [...extraSeeds(), f]);
    }));
    wireSeedSearch();
    el.querySelector('#dc-shuffle').onclick = () => {
      if (!last?.tracks.length) return toast('Rien à lire pour le moment');
      const list = last.tracks.slice().sort(() => Math.random() - 0.5);
      ctl.playList(list, startAt(list), { type: 'discover', name: `Découverte · ${style}` });
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
        if (!isSeed(a.id)) await setSeeds([...extraSeeds(), { id: a.id, name: a.name, thumb: a.thumb }]);
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
