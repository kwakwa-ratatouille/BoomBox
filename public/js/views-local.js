// « Mes fichiers » : les musiques déjà sur le PC (.mp3, .m4a, .flac…), jouables comme les autres sons,
// et le téléchargement de sons / playlists dans le dossier Musique\Boombox du PC.
import { html, icon, plural, toast, promptText } from './ui.js';
import { api } from './state.js';
import { trackList, rememberTracks } from './components.js';
import { isNative } from './native.js';

export const canUseLocal = () => !isNative && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export async function localPage(el, _p, ctx) {
  if (!canUseLocal()) {
    el.innerHTML = String(html`<div class="page"><div class="empty">${icon('folder', 40)}<h2>Mes fichiers</h2><p class="muted">Ouvre Boombox sur ton PC pour ajouter les musiques déjà présentes dessus (.mp3, .m4a, .flac…). Tu pourras ensuite les écouter ici quand ton téléphone passe par ton PC.</p></div></div>`);
    return;
  }
  let q = '';
  let data = null;
  let dlDir = '';
  api('/api/download/folder').then((r) => ctx.alive() && ((dlDir = r.dir), data && draw())).catch(() => {});
  const load = async (refresh = false) => {
    el.querySelector('#lf-list') && (el.querySelector('#lf-list').innerHTML = '<p class="muted">Lecture des dossiers…</p>');
    data = await api(`/api/local${refresh ? '?refresh=1' : ''}`).catch((e) => ({ folders: [], tracks: [], error: e.message }));
    if (ctx.alive()) draw();
  };
  const draw = () => {
    const all = data?.tracks || [];
    const ql = q.toLowerCase();
    const list = ql ? all.filter((t) => `${t.title} ${t.artists.map((a) => a.name).join(' ')} ${t.album?.name || ''}`.toLowerCase().includes(ql)) : all;
    rememberTracks(list);
    const lctx = { type: 'local', id: 'local', name: 'Mes fichiers' };
    el.innerHTML = String(html`<div class="page">
      <div class="row-flex" style="justify-content:space-between;flex-wrap:wrap;gap:12px"><div><h1 style="margin:0">Mes fichiers</h1><p class="muted" style="margin:4px 0 0">${plural(all.length, 'musique')} sur ce PC · jouables, likables et ajoutables à tes playlists</p></div>
        <div class="row-flex" style="gap:8px"><button class="btn white" id="lf-play" ${list.length ? '' : 'disabled'}>${icon('play', 16)} Tout écouter</button><button class="btn ghost" id="lf-refresh">Actualiser</button></div></div>
      <div class="np-card lf-folders"><b>Dossiers lus</b>
        ${(data?.folders || []).map((f, i) => html`<div class="lf-folder"><span class="code ellipsis">${f}</span><button class="icon-btn" data-rm="${i}" title="Retirer">${icon('close', 16)}</button></div>`)}
        <div class="row-flex" style="gap:8px;margin-top:8px"><button class="btn ghost sm" id="lf-add">+ Ajouter un dossier</button><button class="btn ghost sm" id="lf-dl">Ouvrir mes téléchargements</button></div>
        <div class="lf-dldir"><span class="muted">Les sons que tu télécharges depuis Boombox vont dans</span><span class="code ellipsis">${dlDir || 'Musique\\Boombox'}</span><button class="btn ghost sm" id="lf-dldir">Changer</button></div></div>
      ${all.length ? html`<div class="search-box" style="max-width:420px;margin:8px 0 16px"><input id="lf-q" placeholder="Rechercher dans mes fichiers" value="${q}" autocomplete="off"></div>` : ''}
      <div id="lf-list">${list.length ? trackList(list, { context: lctx, album: true }) : html`<div class="empty"><h2>${all.length ? 'Aucun résultat' : 'Aucune musique trouvée'}</h2><p class="muted">${all.length ? '' : 'Ajoute le dossier où sont tes .mp3 (par exemple Téléchargements ou une clé USB).'}</p></div>`}</div>
    </div>`);
    el.querySelector('#lf-play')?.addEventListener('click', () => import('./player.js').then(({ ctl, startAt }) => ctl.playList(list, startAt(list), lctx)));
    el.querySelector('#lf-refresh').onclick = () => load(true);
    el.querySelector('#lf-q')?.addEventListener('input', (e) => {
      q = e.target.value;
      const pos = e.target.selectionStart;
      draw();
      const inp = el.querySelector('#lf-q');
      inp.focus();
      inp.setSelectionRange(pos, pos);
    });
    el.querySelector('#lf-add').onclick = async () => {
      const p = await promptText('Ajouter un dossier', { placeholder: 'C:\\Users\\…\\Musique', label: 'Ajouter' });
      if (!p) return;
      data = await api('/api/local/folders', { method: 'POST', body: { folders: [...(data?.folders || []), p.trim().replace(/^"|"$/g, '')] } }).catch((e) => (toast(e.message), data));
      draw();
    };
    el.querySelector('#lf-dldir').onclick = () => pickDownloadFolder().then((d) => d && ctx.alive() && ((dlDir = d), draw()));
    el.querySelector('#lf-dl').onclick = () => api('/api/download/open', { method: 'POST', body: {} }).catch(() => {});
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      const folders = data.folders.filter((_, i) => i !== Number(b.dataset.rm));
      data = await api('/api/local/folders', { method: 'POST', body: { folders } }).catch(() => data);
      draw();
    }));
  };
  el.innerHTML = '<div class="page"><p class="muted">Lecture de tes dossiers de musique…</p></div>';
  await load();
}

// Télécharger des sons dans Musique\Boombox (PC seulement)
export async function downloadToPc(tracks, name = '') {
  if (!canUseLocal()) return toast('Le téléchargement en fichier se fait depuis Boombox sur ton PC');
  const list = [].concat(tracks).filter((t) => t?.id);
  if (!list.length) return;
  toast(`Téléchargement de ${plural(list.length, 'son')}…`, { timeout: 4000 });
  try {
    const r = await api('/api/download', { method: 'POST', body: { name, tracks: list.map((t) => ({ id: t.id, title: t.title, artists: t.artists })) } });
    toast(`${plural(r.ok, 'son')} téléchargé${r.ok > 1 ? 's' : ''}${r.failed.length ? ` (${r.failed.length} en échec)` : ''}`, { action: 'Ouvrir le dossier', timeout: 8000, onAction: () => api('/api/download/open', { method: 'POST', body: { name } }) });
  } catch (e) {
    toast(e.message);
  }
}

// Choix du dossier des téléchargements dans la fenêtre « Parcourir » de Windows. Renvoie le nouveau dossier, ou null.
export async function pickDownloadFolder() {
  toast('Choisis le dossier dans la fenêtre Windows qui vient de s’ouvrir', { timeout: 4000 });
  try {
    const r = await api('/api/download/folder', { method: 'POST', body: { pick: true } });
    if (r.cancelled) return null;
    toast(`Les prochains téléchargements iront dans ${r.dir}`);
    return r.dir;
  } catch (e) {
    toast(e.message);
    return null;
  }
}
