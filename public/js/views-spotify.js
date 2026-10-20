// Profils Spotify : recherche par nom, page du profil avec ses playlists publiques, ajout dans ma bibliothèque
// (la playlist ajoutée devient la mienne, liée à sa source : ses nouveaux titres arrivent tout seuls).
import { html, icon, toast, plural, esc } from './ui.js';
import { api, createPlaylist, state } from './state.js';

// Cartes « Profils Spotify » pour la recherche
export const spotifyUserCards = (users) =>
  html`<div class="cards">${users.map((u) => html`<a class="card" href="#/spuser/${u.id}">
    <div class="cover round">${u.avatar ? html`<img src="${u.avatar}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon('person')}</div>
    <div class="card-title">${u.name}</div><div class="card-sub">Profil Spotify</div></a>`)}</div>`;

// Importe une playlist Spotify et la crée dans ma bibliothèque (sans passer par l'aperçu)
async function addPlaylist(pl, owner) {
  const job0 = await api('/api/import', { method: 'POST', body: { input: pl.url } });
  let job = job0;
  const t0 = Date.now();
  while (job.status !== 'done' && job.status !== 'error' && Date.now() - t0 < 10 * 60e3) {
    await new Promise((r) => setTimeout(r, 1200));
    job = await api(`/api/import/${job0.id}`).catch(() => job);
  }
  if (job.status !== 'done') throw new Error(job.error || 'Import impossible');
  const p = await createPlaylist(job.name || pl.name, job.tracks, job.description || `Playlist de ${owner}`, {
    cover: job.cover || pl.cover,
    source: { platform: 'Spotify', url: pl.url, owner: job.owner || owner },
  });
  return { p, n: job.tracks.length, missing: job.unmatched?.length || 0 };
}

export async function spotifyUserPage(el, { id }, ctx) {
  el.innerHTML = '<div class="page"><p class="muted">Chargement du profil…</p></div>';
  let u;
  try {
    u = await api(`/api/spotify/user/${encodeURIComponent(id)}`);
  } catch (e) {
    el.innerHTML = String(html`<div class="page"><div class="empty"><h2>Profil introuvable</h2><p class="muted">${e.message}</p></div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  const busy = new Set();
  const have = (pl) => state.library.playlists.some((p) => p.source?.url === pl.url);
  const render = () => {
    el.innerHTML = String(html`<div class="page">
      <div class="user-hero">
        <div class="sp-av">${u.avatar ? html`<img src="${u.avatar}" alt="" referrerpolicy="no-referrer">` : icon('person', 48)}</div>
        <div style="min-width:0"><div class="muted" style="font-size:12px">PROFIL SPOTIFY</div><h1 class="ellipsis">${u.name}</h1>
          <div class="row-flex" style="gap:8px;margin-top:10px;flex-wrap:wrap">
            ${u.playlists.length ? html`<button class="btn white" id="sp-all">${icon('plus', 16)} Ajouter toutes ses playlists</button>` : ''}
            <a class="btn ghost" href="${u.url}" target="_blank" rel="noopener">Ouvrir dans Spotify</a></div></div></div>
      <section class="section"><div class="section-head"><h2>Playlists publiques</h2><span class="muted">${plural(u.playlists.length, 'playlist')}</span></div>
        ${u.playlists.length ? html`<div class="sp-pls">${u.playlists.map((pl) => html`<div class="sp-pl">
            <a href="#/import?url=${encodeURIComponent(pl.url)}" title="Voir les titres avant d'ajouter"><div class="cover">${pl.cover ? html`<img src="${pl.cover}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon('music')}</div></a>
            <div class="sp-pl-info"><b class="ellipsis">${pl.name}</b>
              ${have(pl) ? html`<span class="muted">✓ Dans ta bibliothèque</span>` : busy.has(pl.id) ? html`<span class="muted">Ajout en cours…</span>` : html`<button class="btn primary sm" data-add="${pl.id}">${icon('plus', 14)} Ajouter</button>`}</div></div>`)}</div>`
        : html`<p class="muted">Aucune playlist publique sur ce profil.</p>`}
        <p class="muted" style="font-size:12px;margin-top:12px">Les playlists ajoutées deviennent les tiennes (modifiables) et restent liées à Spotify : les nouveaux titres arrivent tout seuls. Spotify n'affiche que ses 10 premières playlists publiques.</p>
      </section></div>`);
    const add = async (pl) => {
      if (busy.has(pl.id) || have(pl)) return;
      busy.add(pl.id);
      render();
      try {
        const r = await addPlaylist(pl, u.name);
        toast(`« ${r.p.name} » ajoutée : ${plural(r.n, 'titre')}${r.missing ? ` (${r.missing} introuvables)` : ''}`, { action: 'Ouvrir', onAction: () => (location.hash = `#/playlist/${r.p.id}`) });
      } catch (e) {
        toast(`${pl.name} : ${e.message}`);
      }
      busy.delete(pl.id);
      if (ctx.alive()) render();
    };
    el.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => add(u.playlists.find((p) => p.id === b.dataset.add))));
    el.querySelector('#sp-all')?.addEventListener('click', async () => {
      toast(`Ajout de ${plural(u.playlists.filter((p) => !have(p)).length, 'playlist')}…`);
      for (const pl of u.playlists) await add(pl);
    });
  };
  render();
  return { onLibrary: render };
}
