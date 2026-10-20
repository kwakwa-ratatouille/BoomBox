// Playlists publiques / collaboratives : profil d'un ami, playlist d'un ami, réglages de partage de mes playlists.
// Publique : les amis l'écoutent et peuvent l'ajouter à leur bibliothèque (copie), rien de plus.
// Collaborateur : il peut ajouter / retirer des sons et la renommer, comme le propriétaire.
import { html, raw, icon, toast, modal, contextMenu, plural, promptText } from './ui.js';
import { createPlaylist, isLiked, toggleLike, bus, state } from './state.js';
import { player, ctl } from './player.js';
import { cover, playlistCover, openPlaylistPicker } from './components.js';
import { db, doc, getDoc } from './cloud.js';
import { social } from './social.js';
import { avatar, activityLine, bindActivity, sortedFriends, searchAndSend, addFriendDialog } from './views-social.js';

const artists = (t) => (t?.artists || []).map((a) => a.name).join(', ');
const listen = (type, fn) => {
  const h = () => fn();
  bus.addEventListener(type, h);
  return () => bus.removeEventListener(type, h);
};

// ---------- Profil d'un ami : activité et playlists publiques ----------
export async function userPage(el, params) {
  const code = params.code;
  if (code === social.code) return void (location.hash = '#/profile');
  el.innerHTML = '<div class="page"><p class="muted">Chargement…</p></div>';
  const card = await getDoc(doc(db, 'people', code)).catch(() => null);
  if (!card?.exists()) return void (el.innerHTML = '<div class="page"><div class="empty"><h2>Profil introuvable</h2></div></div>');
  const d = card.data();
  const [lists, likes] = await Promise.all([social.publicPlaylists(code).catch(() => []), d.likes ? social.friendLikes(code) : null]);
  let showLikes = false;
  const lctx = { type: 'shared', name: `Titres likés de ${d.name}` };
  const draw = () => {
    const f = social.friend(code) || { code, name: d.name, photo: d.photo, color: d.color, share: !!d.share, activity: d.share ? d.activity : null };
    el.innerHTML = String(html`<div class="page">
      ${d.banner && !state.safeMode ? html`<div class="user-banner" style="background-image:url('${d.banner}')"></div>` : ''}
      <div class="user-hero">${avatar(f, 'user-av')}<div style="min-width:0"><div class="muted" style="font-size:12px">PROFIL</div><h1 class="ellipsis">${f.name}</h1><div class="user-act">${activityLine(f)}</div>
        <div class="row-flex" style="gap:8px;margin-top:10px"><a class="btn white" href="#/friends?c=${code}">${icon('chat', 16)} Message</a>${!social.isAdded(code) && !f.sameSpace ? html`<button class="btn ghost" id="u-add">${icon('plus', 16)} Ajouter</button>` : ''}</div></div></div>
      <section class="section"><div class="section-head"><h2>Playlists publiques</h2></div>
        ${lists.length ? html`<div class="cards row">${lists.map((pl) => html`<a class="card" href="#/shared/${code}/${pl.id}">${playlistCover(pl)}<b class="ellipsis">${pl.name}</b><span class="muted ellipsis">${plural(pl.tracks.length, 'titre')}</span></a>`)}</div>` : html`<p class="muted">Aucune playlist publique pour l'instant.</p>`}
      </section>
      ${likes ? html`<section class="section"><div class="section-head"><h2>Titres likés</h2><button class="outline-btn" id="u-likes">${showLikes ? 'Masquer' : `Voir les ${likes.length} titres`}</button></div>
        <div class="row-flex" style="gap:8px;margin-bottom:12px"><button class="btn primary" id="u-lplay">${icon('play', 16)} Écouter</button></div>
        ${showLikes ? html`<div class="sp-list">${likes.map((t, i) => html`<div class="sp-row" data-li="${i}"><span class="muted sp-n">${i + 1}</span>${cover(t, '', 96)}<div class="t-text"><span class="t-title ellipsis">${t.title}</span><span class="t-artists muted ellipsis">${artists(t)}</span></div></div>`)}</div>` : ''}</section>` : ''}
      </div>`);
    el.querySelector('#u-likes')?.addEventListener('click', () => ((showLikes = !showLikes), draw()));
    el.querySelector('#u-lplay')?.addEventListener('click', () => ctl.playList(likes, 0, lctx));
    el.querySelectorAll('[data-li]').forEach((r) => (r.onclick = () => ctl.playList(likes, +r.dataset.li, lctx)));
    bindActivity(el);
    el.querySelector('#u-add')?.addEventListener('click', () => social.addFriend(code).then((n) => (toast(`Demande d’ami envoyée à ${n}`), draw())).catch((e) => toast(e.message)));
  };
  draw();
  return { cleanup: listen('social', draw) };
}

// ---------- Playlist d'un ami (publique, ou partagée avec moi comme collaborateur) ----------
export async function sharedPlaylistPage(el, params) {
  const { owner, id } = params;
  if (owner === social.code) return void (location.hash = `#/playlist/${id}`);
  let pl;
  const draw = () => {
    if (pl === undefined) return void (el.innerHTML = '<div class="page"><p class="muted">Chargement…</p></div>');
    if (!pl) return void (el.innerHTML = '<div class="page"><div class="empty"><h2>Playlist indisponible</h2><p class="muted">Elle a été supprimée ou repassée en privé.</p></div></div>');
    const edit = social.canEdit(pl);
    const ctx = { type: 'shared', name: pl.name };
    el.innerHTML = String(html`<div class="page">
      <div class="user-hero">${playlistCover(pl, 'sp-cover')}<div style="min-width:0"><div class="muted" style="font-size:12px">${pl.visibility === 'public' ? 'PLAYLIST PUBLIQUE' : 'PLAYLIST PARTAGÉE'}${edit ? ' · TU PEUX LA MODIFIER' : ''}</div>
        <h1 class="ellipsis" ${edit ? raw('id="sp-name" title="Renommer" style="cursor:text"') : ''}>${pl.name}</h1>
        <div class="muted"><a class="link" href="#/user/${pl.owner}">${pl.ownerName}</a> · ${plural(pl.tracks.length, 'titre')}${pl.description ? ` · ${pl.description}` : ''}</div>
        <div class="row-flex" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn primary" id="sp-play">${icon('play', 16)} Écouter</button><button class="btn ghost" id="sp-shuffle">${icon('shuffle', 16)} Aléatoire</button>
          <button class="btn ghost" id="sp-save">${icon('plus', 16)} Ajouter à ma bibliothèque</button>${edit ? html`<button class="btn ghost" id="sp-add">${icon('search', 16)} Ajouter des sons</button>` : ''}</div></div></div>
      <div class="sp-list">${pl.tracks.map((t, i) => html`<div class="sp-row" data-i="${i}"><span class="muted sp-n">${i + 1}</span>${cover(t, '', 96)}<div class="t-text"><span class="t-title ellipsis">${t.title}</span><span class="t-artists muted ellipsis">${artists(t)}</span></div>
        <button class="icon-btn" data-more="${i}" title="Plus">${icon('more', 18)}</button>${edit ? html`<button class="icon-btn" data-rm="${i}" title="Retirer">${icon('close', 18)}</button>` : ''}</div>`)}</div>
    </div>`);
    el.querySelector('#sp-play').onclick = () => ctl.playList(pl.tracks, 0, ctx);
    el.querySelector('#sp-shuffle').onclick = () => {
      if (!player.shuffle) ctl.toggleShuffle();
      ctl.playList(pl.tracks, Math.floor(Math.random() * pl.tracks.length), ctx);
    };
    el.querySelector('#sp-save').onclick = async () => {
      const p = await createPlaylist(pl.name, pl.tracks, pl.description || `Playlist de ${pl.ownerName}`, pl.cover ? { cover: pl.cover } : {});
      toast(`« ${p.name} » ajoutée à ta bibliothèque`, { action: 'Ouvrir', onAction: () => (location.hash = `#/playlist/${p.id}`) });
    };
    el.querySelectorAll('.sp-row').forEach((r) => (r.onclick = (e) => !e.target.closest('button') && ctl.playList(pl.tracks, Number(r.dataset.i), ctx)));
    el.querySelectorAll('[data-more]').forEach((b) => (b.onclick = (e) => {
      const t = pl.tracks[Number(b.dataset.more)];
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.right - 220, r.bottom, [
        { label: "Ajouter à la file d'attente", icon: 'addQueue', action: () => ctl.addToQueue(t) },
        { label: 'Ajouter à une playlist…', icon: 'plus', action: () => openPlaylistPicker(t, { x: r.left, y: r.top }) },
        { label: isLiked(t.id) ? 'Retirer des Titres likés' : 'Ajouter aux Titres likés', icon: isLiked(t.id) ? 'heartFill' : 'heart', action: () => toggleLike(t) },
      ]);
    }));
    if (!edit) return;
    const save = (patch) => social.editShared(pl, patch).catch((er) => toast(/permission/i.test(er.code || er.message) ? "Tu n'es plus collaborateur de cette playlist" : er.message));
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => save({ tracks: pl.tracks.filter((_, i) => i !== Number(b.dataset.rm)) })));
    el.querySelector('#sp-add').onclick = () => searchAndSend((payload) => save({ tracks: [...pl.tracks, ...payload.tracks.filter((t) => !pl.tracks.some((x) => x.id === t.id))] }), 'Ajouter à la playlist');
    el.querySelector('#sp-name').onclick = async () => {
      const name = await promptText('Renommer la playlist', { value: pl.name });
      if (name) save({ name });
    };
  };
  draw();
  return { cleanup: social.watchShared(owner, id, (d) => ((pl = d), draw())) };
}

// ---------- Réglages de partage d'une de mes playlists (menu ⋯) ----------
export function playlistShareItems(p) {
  const n = (p.collaborators || []).length;
  return [
    { label: p.visibility === 'public' ? 'Rendre privée' : 'Rendre publique (visible par tes amis)', icon: p.visibility === 'public' ? 'pin' : 'users', action: () => social.setVisibility(p, p.visibility === 'public' ? 'private' : 'public') },
    { label: n ? `Collaborateurs (${n})…` : 'Inviter des collaborateurs…', icon: 'edit', action: () => collaboratorsDialog(p) },
  ];
}

async function collaboratorsDialog(p) {
  const friends = sortedFriends();
  if (!friends.length) return toast("Ajoute d'abord des amis (code ami)", { action: 'Ajouter', onAction: addFriendDialog });
  const cur = new Set((p.collaborators || []).map((c) => c.code));
  const v = await modal({
    title: `Collaborateurs de « ${p.name} »`,
    body: String(html`<p class="muted" style="margin-top:0">Les collaborateurs peuvent ajouter, retirer des sons et renommer la playlist, comme toi. Les autres amis peuvent seulement l'écouter et l'ajouter à leur bibliothèque (si elle est publique).</p>
      ${friends.map((f) => html`<label class="collab-row">${avatar(f)}<b class="ellipsis" style="flex:1">${f.name}</b><input type="checkbox" value="${f.code}" ${cur.has(f.code) ? 'checked' : ''}></label>`)}`),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, value: (w) => [...w.querySelectorAll('input:checked')].map((i) => i.value) }],
  });
  if (!Array.isArray(v)) return;
  await social.setCollaborators(p, v.map((code) => ({ code, name: social.friend(code)?.name || '' })));
  toast(v.length ? `${plural(v.length, 'collaborateur')} sur « ${p.name} »` : 'Plus aucun collaborateur');
}
