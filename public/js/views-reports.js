// Rapports d'import et de mise à jour des playlists : ce qui a été ajouté, ce qui était déjà là, ce qui n'a pas
// fonctionné et pourquoi. Page « Rapports d'import » + panneau « Synchronisation » d'une playlist.
import { html, raw, icon, plural, modal, toast } from './ui.js';
import { state, getReports } from './state.js';
import { canSync, syncPlaylistNow, setPlaylistSync, linkSource } from './playlist-sync.js';

const when = (ts) => new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

function reportHtml(r, open = false) {
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
      ${missing.length ? html`<h4>N'ont pas fonctionné</h4><p class="muted" style="margin-top:-6px">Raison : aucun équivalent trouvé sur YouTube Music (titre absent, version locale, faute dans le nom…). Tu peux les chercher à la main et les ajouter avec « + Ajouter ».</p><ul class="rep-list bad">${missing.map((m) => html`<li>${m.replace(/ — introuvable sur YouTube$/, '')}</li>`)}</ul>` : ''}
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
