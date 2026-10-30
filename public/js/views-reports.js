// Rapports d'import et de mise à jour des playlists : ce qui a été ajouté, ce qui était déjà là, ce qui n'a pas
// fonctionné et pourquoi. Page « Rapports d'import » + panneau « Synchronisation » d'une playlist.
import { html, raw, icon, plural, modal, toast } from './ui.js';
import { state, getReports, api, addToPlaylist, addReport } from './state.js';
import { sameSong, isRemix } from './twins.js';
import { canSync, syncPlaylistNow, setPlaylistSync, linkSource } from './playlist-sync.js';

const when = (ts) => new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// Rapports affichés (pour le bouton « Rechercher à nouveau »), et un seul écouteur de clic pour toutes les pages
const shown = new Map();
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-retry]');
  const r = b && shown.get(b.dataset.retry);
  if (!r) return;
  e.preventDefault();
  retryMissing(r, b).catch((er) => ((b.disabled = false), (b.textContent = 'Réessayer'), toast(er.message)));
});

function reportHtml(r, open = false) {
  if (r.id) shown.set(r.id, r);
  const added = r.added || [];
  const missing = r.missing || [];
  const title = r.type === 'sync' ? 'Mise à jour' : 'Import';
  const ok = !missing.length;
  return html`<details class="rep ${ok ? 'ok' : 'warn'}" ${open ? 'open' : ''}>
    <summary><span class="rep-ic">${icon(r.type === 'sync' ? 'sync' : 'import', 18)}</span>
      <div class="rep-head"><b>${title} · ${r.name}</b><span class="muted">${when(r.at)} · depuis ${r.source || '?'}</span></div>
      <div class="rep-nums"><span class="rep-n good">${plural(added.length, 'ajouté')}</span>${r.alreadyThere != null ? html`<span class="rep-n">${r.alreadyThere} déjà là</span>` : ''}${missing.length ? html`<span class="rep-n bad">${missing.length} introuvable${missing.length > 1 ? 's' : ''}</span>` : html`<span class="rep-n good">${icon('check', 14)} tout est bon</span>`}</div></summary>
    <div class="rep-body">
      ${r.sourceCount != null ? html`<p class="muted">${r.sourceCount} titres dans la playlist d'origine${r.hereCount != null ? ` · ${r.hereCount} dans Boombox après l'opération` : ''}.${r.skipped ? ` ${r.skipped} titres restent à traiter : ils seront ajoutés à la prochaine mise à jour.` : ''}</p>` : ''}
      ${missing.length ? html`<h4>N'ont pas fonctionné</h4><p class="muted" style="margin-top:-6px">Raison : aucun équivalent trouvé sur YouTube Music (titre absent, version locale, faute dans le nom…). Tu peux les chercher à la main et les ajouter avec « + Ajouter ».</p>${r.playlistId ? html`<button class="btn primary sm rep-retry" data-retry="${r.id || ''}" style="margin-bottom:10px">${icon('search', 16)} Rechercher à nouveau les ${missing.length} introuvables</button>` : ''}<ul class="rep-list bad">${missing.map((m) => html`<li>${m.replace(/ — introuvable sur YouTube$/, '')}</li>`)}</ul>` : ''}
      ${added.length ? html`<h4>Ajoutés</h4><ul class="rep-list">${added.slice(0, 400).map((m) => html`<li>${m}</li>`)}</ul>` : html`<p class="muted">Aucun nouveau titre : la playlist était déjà à jour.</p>`}
      ${r.playlistId ? html`<a class="outline-btn" href="#/playlist/${r.playlistId}">Ouvrir la playlist</a>` : ''}
    </div></details>`;
}

export async function reportsPage(el, _p, ctx) {
  el.innerHTML = String(html`<div class="page" style="max-width:900px"><h1>Rapports d'import</h1><p class="muted">Chaque import et chaque mise à jour de playlist : ce qui a été ajouté, ce qui était déjà là, et ce qui n'a pas fonctionné (avec la raison).</p><div id="reps"><div class="loading"><div class="spinner"></div></div></div></div>`);
  const reps = await getReports(80).catch(() => []);
  if (!ctx.alive()) return;
  el.querySelector('#reps').innerHTML = reps.length ? reps.map((r, i) => String(reportHtml(r, i === 0))).join('') : String(html`<div class="empty"><h2>Aucun rapport pour l'instant</h2><p>Les rapports apparaissent après un import ou une mise à jour de playlist.</p><a class="btn white" href="#/import">Importer une playlist</a></div>`);
}

// Panneau « Synchronisation » d'une playlist importée : état, dernier rapport, actions
export async function openSyncPanel(p) {
  if (!canSync(p)) return linkSource(p);
  const draw = async (w) => {
    const pl = state.library.playlists.find((x) => x.id === p.id) || p;
    const reps = (await getReports(80).catch(() => [])).filter((r) => r.playlistId === p.id);
    w.querySelector('.sp-body').innerHTML = String(html`
      <div class="sp-status ${pl.sync ? 'on' : ''}">${icon('sync', 18)}<div><b>${pl.sync ? `Synchronisée avec ${pl.source.platform}` : 'Synchronisation désactivée'}</b><span class="muted">${pl.syncedAt ? `Dernière vérification : ${when(pl.syncedAt)}` : 'Jamais vérifiée'} · vérification automatique toutes les 30 min, appli ouverte</span></div></div>
      <div class="row-flex" style="margin:12px 0 4px;flex-wrap:wrap"><button class="btn white" data-sp="now">${icon('sync', 16)} Vérifier maintenant</button><button class="btn ghost" data-sp="link">Changer le lien</button><button class="btn ghost" data-sp="toggle">${pl.sync ? 'Désactiver' : 'Activer'}</button><a class="btn ghost" href="${pl.source.url}" target="_blank" rel="noopener">Ouvrir sur ${pl.source.platform}</a></div>
      <h4 style="margin:18px 0 8px">Dernières mises à jour</h4>
      ${raw(reps.length ? reps.slice(0, 5).map((r, i) => String(reportHtml(r, i === 0))).join('') : '<p class="muted">Aucun rapport encore : clique sur « Vérifier maintenant ».</p>')}`);
  };
  await modal({
    title: `Synchronisation · ${p.name}`,
    wide: true,
    body: '<div class="sp-body"><div class="loading"><div class="spinner"></div></div></div>',
    actions: [{ label: 'Fermer' }],
    onMount: (w) => {
      draw(w);
      w.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-sp]')?.dataset.sp;
        if (!a) return;
        const pl = state.library.playlists.find((x) => x.id === p.id) || p;
        if (a === 'now') {
          e.target.closest('button').disabled = true;
          toast('Vérification en cours…');
          await syncPlaylistNow(pl).catch((err) => toast('Synchronisation impossible : ' + err.message));
        } else if (a === 'toggle') await setPlaylistSync(pl, !pl.sync);
        else if (a === 'link') await linkSource(pl);
        setTimeout(() => draw(w), 600);
      });
    },
  });
}

// « Rechercher à nouveau » : les sons introuvables d'un import repassent par la recherche actuelle de Boombox
// (YouTube Music, titre seul si besoin, puis SoundCloud) ; ceux trouvés sont ajoutés à la playlist, avec un rapport.
export async function retryMissing(r, btn) {
  const items = (r.missing || []).map((m) => m.replace(/ — introuvable sur YouTube$/, '')).map((m) => {
    const i = m.indexOf(' - ');
    return i > 0 ? { artist: m.slice(0, i).trim(), title: m.slice(i + 3).trim(), label: m } : { artist: '', title: m.trim(), label: m };
  });
  if (!items.length || !r.playlistId) return;
  const say = (t) => btn && (btn.textContent = t);
  btn && (btn.disabled = true);
  say('Recherche sur YouTube Music…');
  const job = await api('/api/match', { method: 'POST', body: { items: items.map(({ artist, title }) => ({ artist, title })), kind: 'track', retry: true } });
  let j;
  do {
    await new Promise((res) => setTimeout(res, 1000));
    j = await api(`/api/import/${job.id}`);
    say(`YouTube Music : ${j.done} / ${j.total}…`);
  } while (j.status !== 'done');
  const found = [];
  const still = [];
  items.forEach((it, i) => (j.results[i] ? found.push(j.results[i]) : still.push(it)));
  // Plan B : SoundCloud (même titre, même artiste, pas un remix)
  for (let k = 0; k < still.length; k++) {
    const it = still[k];
    say(`SoundCloud : ${k + 1} / ${still.length}…`);
    const list = await api(`/api/soundcloud/search?q=${encodeURIComponent(`${it.artist} ${it.title}`.trim())}`).catch(() => []);
    const want = { title: it.title, artists: it.artist ? [{ name: it.artist }] : [] };
    const hit = (list || []).find((t) => (it.artist ? sameSong(t, want) : String(t.title).toLowerCase().includes(it.title.toLowerCase())) && !isRemix(t, it.title));
    if (hit) (found.push(hit), (still[k] = null));
  }
  const missing = still.filter(Boolean).map((it) => it.label);
  if (found.length) await addToPlaylist(r.playlistId, found, { quiet: true });
  await addReport({ type: 'import', playlistId: r.playlistId, name: r.name, source: 'Nouvelle recherche', sourceCount: items.length, added: found.map((t) => `${(t.artists || []).map((a) => a.name).join(', ')} - ${t.title}`), missing: missing.map((m) => `${m} — introuvable sur YouTube`) }).catch(() => {});
  toast(found.length ? `${plural(found.length, 'son retrouvé')} et ajouté${found.length > 1 ? 's' : ''} à « ${r.name} »${missing.length ? ` · ${missing.length} toujours introuvable${missing.length > 1 ? 's' : ''}` : ''}` : 'Toujours introuvables, même sur SoundCloud', { timeout: 7000 });
  say(found.length ? `✓ ${found.length} ajouté${found.length > 1 ? 's' : ''}` : 'Toujours introuvables');
}
