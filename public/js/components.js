// Composants réutilisables : pochettes, listes de titres, cartes, menus contextuels des titres.
import { html, raw, esc, icon, fmtTime, fmtAgo, artistLinks, contextMenu, toast, promptText, isMobile, plural } from './ui.js';
import { state, api, bus, isLiked, toggleLike, likeMany, createPlaylist, addToPlaylist, removeFromPlaylist, movePlaylistItem, toggleBan, setting } from './state.js';
import { player, ctl, startAt } from './player.js';
import { sync } from './sync.js';
import { lastMixes } from './dailymix.js';
import { sendToFriend } from './views-social.js';

// Registre des listes affichées (pour retrouver un titre depuis le DOM).
export const lists = new Map();
let seq = 0;
export function registerList(tracks, context, extra = {}) {
  const id = 'l' + ++seq;
  lists.set(id, { tracks, context, ...extra });
  return id;
}

// ---------- Pochettes ----------
// Demande la taille d'image adaptée à l'affichage (évite de charger des images 544 px pour une miniature de 40 px).
export function sized(url, px = 300) {
  if (!url || url.startsWith('data:')) return url;
  if (/googleusercontent\.com|ggpht\.com/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`).replace(/=s\d+/, `=s${px}`);
  if (/i\.ytimg\.com/.test(url) && px <= 160) return url.replace(/\/(hq|sd|maxres)default\.jpg/, '/mqdefault.jpg');
  return url;
}

export function cover(item, cls = '', px = 300) {
  if (item?.thumb) return html`<div class="cover ${cls}"><img src="${sized(item.thumb, px)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`;
  return html`<div class="cover ${cls}">${icon('music')}</div>`;
}

export function playlistCover(p, cls = '', px = 300) {
  if (p.cover) return html`<div class="cover ${cls}"><img src="${p.cover}" alt="" loading="lazy" decoding="async"></div>`;
  // Image par défaut : les pochettes des premiers titres en 2×2 (pochettes différentes, dans l'ordre de la playlist).
  // 2 ou 3 pochettes : on les répète en damier ; une seule : elle prend toute la place.
  const thumbs = [...new Set((p.tracks || []).map((t) => t.thumb).filter(Boolean))].slice(0, 4);
  if (thumbs.length >= 2) {
    const [a, b, c] = thumbs;
    const grid = thumbs.length === 4 ? thumbs : thumbs.length === 3 ? [a, b, c, a] : [a, b, b, a];
    return raw(`<div class="cover mosaic ${esc(cls)}">${grid.map((u) => `<img src="${esc(sized(u, Math.ceil(px / 2)))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join('')}</div>`);
  }
  if (thumbs.length) return cover({ thumb: thumbs[0] }, cls, px);
  return html`<div class="cover ${cls}"><img src="/assets/cover-default.png" alt=""></div>`;
}

export const likedCover = (cls = '') => html`<div class="cover liked ${cls}"><img src="/assets/cover-liked.png" alt=""></div>`;

// ---------- Liste de titres ----------
// playlistId : permet « Retirer de cette playlist » ; reorder : autorise le glisser-déposer pour réordonner.
// plays : affiche le nombre de lectures (pages d'artiste) à la place de l'album
export function trackList(tracks, { context, album = true, added = false, playlistId = null, reorder = false, coverArt = true, numbered = true, plays = false } = {}) {
  if (plays) album = true;
  // « Ne plus proposer » : le son disparaît partout, sauf dans tes playlists et tes likes où il reste visible (grisé)
  const banned = new Set(setting('banned', []));
  const mine = playlistId || context?.type === 'liked' || context?.type === 'playlist';
  if (banned.size && !mine) tracks = tracks.filter((t) => !banned.has(t.id));
  const listId = registerList(tracks, context, { playlistId, reorder });
  const cls = `${album ? '' : 'no-album'} ${added ? '' : 'no-date'}`;
  const o = { album, added, playlistId, coverArt, numbered, plays };
  // Longue liste : on n'affiche que le début ; la suite arrive au fil du défilement (bien plus fluide sur téléphone)
  const first = tracks.length > FIRST_ROWS + 40 ? FIRST_ROWS : tracks.length;
  const rows = tracks.slice(0, first).map((t, i) => trackRow(t, i, listId, o));
  if (first < tracks.length) {
    pendingRows.set(listId, { tracks, o, next: first });
    watchMoreRows();
  }
  return html`<div class="tracks ${cls}" data-list-wrap="${listId}">
    <div class="track-head">
      <span class="t-num">#</span><span>Titre</span>
      ${album ? html`<span>${plays ? 'Lectures' : 'Album'}</span>` : ''}
      ${added ? html`<span class="h-date">Date d’ajout</span>` : ''}
      <span class="r">${icon('clock', 16)}</span>
    </div>
    ${rows}${first < tracks.length ? raw(`<div class="tl-more" data-more="${listId}"></div>`) : ''}
  </div>`;
}

const FIRST_ROWS = 100;
const MORE_ROWS = 150;
const pendingRows = new Map();
let moreWatched = false;
// Quand la fin des titres affichés approche (moins de 2 écrans), on ajoute les suivants
function appendMoreRows() {
  for (const el of document.querySelectorAll('.tl-more')) {
    const p = pendingRows.get(el.dataset.more);
    if (!p) { el.remove(); continue; }
    if (el.getBoundingClientRect().top > Math.max(innerHeight, 700) * 3) continue;
    const to = Math.min(p.tracks.length, p.next + MORE_ROWS);
    el.insertAdjacentHTML('beforebegin', p.tracks.slice(p.next, to).map((t, i) => String(trackRow(t, p.next + i, el.dataset.more, p.o))).join(''));
    p.next = to;
    if (to >= p.tracks.length) (pendingRows.delete(el.dataset.more), el.remove());
    refreshTrackMarks(true);
    el.closest('[data-list-wrap]')?.dispatchEvent(new CustomEvent('tracks:more', { bubbles: true }));
  }
}
function watchMoreRows() {
  if (moreWatched) return;
  moreWatched = true;
  let timer = 0;
  const tick = () => ((timer = 0), appendMoreRows());
  const soon = () => timer || (timer = setTimeout(tick, 80));
  document.addEventListener('scroll', soon, { capture: true, passive: true });
  // Liste courte à l'écran ou page déjà défilée : on vérifie aussi juste après l'affichage
  new MutationObserver(soon).observe(document.getElementById('view') || document.body, { childList: true, subtree: false });
  setTimeout(tick, 300);
}

function trackRow(t, i, listId, o) {
  const playing = player.track?.id === t.id;
  const playIcon = raw(String(icon('play', 16)).replace('class="ic"', 'class="ic play-i"'));
  const dl = window.__bbOffline?.has(t.id);
  return html`<div class="track ${playing ? 'playing' : ''} ${dl ? 'dl' : ''} ${setting('banned', []).includes(t.id) ? 'banned' : ''}" data-list="${listId}" data-i="${i}" data-id="${t.id}" draggable="true">
    <div class="t-num"><span>${o.numbered ? i + 1 : ''}</span>${playIcon}<div class="eq"><i></i><i></i><i></i></div></div>
    <div class="t-main">
      ${o.coverArt ? cover(t, '', 96) : ''}
      <div class="t-text">
        <span class="t-title">${dl ? html`<span class="dl-dot" title="Téléchargé">${icon('import', 12)}</span>` : ''}${t.title}</span>
        <span class="t-artists">${t.video ? html`<span class="tag">CLIP</span>` : ''}${o.counts?.[t.id] ? html`<span class="t-count">${o.counts[t.id]} écoute${o.counts[t.id] > 1 ? 's' : ''}</span> • ` : ''}${artistLinks(t)}</span>
      </div>
    </div>
    ${o.plays ? html`<span class="t-album t-plays" title="${t.playsSpotify ? 'Écoutes sur Spotify' : t.plays ? 'Lectures sur YouTube Music (arrondi)' : ''}">${t.playsSpotify ? t.playsSpotify.toLocaleString('fr-FR') : t.plays || ''}</span>` : o.album ? html`<span class="t-album">${t.album?.id ? html`<a class="link" href="#/album/${t.album.id}">${t.album.name}</a>` : t.album?.name || ''}</span>` : ''}
    ${o.added ? html`<span class="t-date">${fmtAgo(t.addedAt)}</span>` : ''}
    <div class="t-end">
      <button class="t-like ${isLiked(t.id) ? 'on' : ''}" data-act="like" aria-label="Liker">${icon(isLiked(t.id) ? 'heartFill' : 'heart')}</button>
      <span class="t-dur">${t.duration ? fmtTime(t.duration) : ''}</span>
      <button class="t-more" data-act="more" aria-label="Plus d'options">${icon('more')}</button>
    </div>
  </div>`;
}

// Met à jour l'indicateur « en cours » et les cœurs sans tout re-rendre (rapide même sur 2 000 titres).
let markedId = null;
let markedLikes = -1;
let markedDom = null;
export function refreshTrackMarks(force = false) {
  const id = player.track?.id;
  document.body.classList.toggle('paused', player.paused);
  const view = document.getElementById('view');
  const domChanged = markedDom !== view.firstElementChild;
  markedDom = view.firstElementChild;
  if (id !== markedId || domChanged || force) {
    document.querySelectorAll('.track.playing').forEach((el) => el.dataset.id !== id && el.classList.remove('playing'));
    if (id) document.querySelectorAll(`.track[data-id="${CSS.escape(id)}"]`).forEach((el) => el.classList.add('playing'));
    markedId = id;
  }
  if (state.libVersion === markedLikes && !domChanged && !force) return;
  markedLikes = state.libVersion;
  document.querySelectorAll('.track[data-id]').forEach((el) => {
    const like = el.querySelector('.t-like');
    if (like) {
      const on = isLiked(el.dataset.id);
      if (like.classList.contains('on') !== on) {
        like.classList.toggle('on', on);
        like.innerHTML = String(icon(on ? 'heartFill' : 'heart'));
      }
    }
  });
}

function rowInfo(el) {
  const row = el.closest('.track');
  if (!row) return null;
  const l = lists.get(row.dataset.list);
  if (!l) return null;
  const i = Number(row.dataset.i);
  return { row, list: l, i, track: l.tracks[i] };
}

function playRow(info) {
  if (sync.jam && !sync.isJamHost() && !sync.listenAlong) {
    sync.jamAdd(info.track);
    return;
  }
  ctl.playList(info.list.tracks, info.i, info.list.context);
}

// ---------- Sélecteur « Ajouter à une playlist » ----------
// Comme Spotify : la liste de tes playlists avec une coche là où le son est déjà ; un clic ajoute ou retire,
// le panneau reste ouvert pour en cocher plusieurs d'un coup. Fonctionne aussi pour plusieurs titres à la fois.
let picker = null;
export function openPlaylistPicker(tracks, at = null) {
  const arr = [].concat(tracks).filter((t) => t?.id);
  if (!arr.length) return;
  picker?.close();
  const el = document.createElement('div');
  el.className = 'pl-picker';
  el.innerHTML = String(html`<div class="pp-head"><b>${arr.length === 1 ? 'Ajouter à une playlist' : `Ajouter ${plural(arr.length, 'titre')}`}</b><button class="icon-btn" data-pp="close" aria-label="Fermer">${icon('close', 20)}</button></div>
    ${arr.length === 1 ? html`<div class="pp-track">${cover(arr[0], '', 96)}<div class="t-text"><span class="t-title">${arr[0].title}</span><span class="t-artists muted">${(arr[0].artists || []).map((a) => a.name).join(', ')}</span></div></div>` : ''}
    <div class="pp-search"><input placeholder="Rechercher une playlist" autocomplete="off"></div>
    <button class="pp-row pp-new" data-pp="new"><span class="pp-cov">${icon('plus', 22)}</span><span class="pp-name">Nouvelle playlist</span></button>
    <div class="pp-list"></div>
    <div class="pp-foot"><button class="btn white" data-pp="close">OK</button></div>`);
  // Fond (transparent) derrière la fenêtre : un appui à côté la ferme, sur téléphone comme sur PC
  const bd = document.createElement('div');
  bd.className = 'pp-backdrop';
  bd.addEventListener('pointerdown', (e) => (e.preventDefault(), e.stopPropagation(), close()));
  document.body.appendChild(bd);
  document.body.appendChild(el);
  const ids = arr.map((t) => t.id);
  let q = '';
  const forced = new Map(); // coche voulue en attendant la synchro : clé playlist (ou 'liked') → 'all' / 'none'
  const pick = (key, real) => {
    if (!forced.has(key)) return real;
    if (forced.get(key) === real) forced.delete(key);
    return forced.get(key) || real;
  };
  const stateOf = (p) => {
    const have = new Set(p.tracks.filter((t) => !t._deleted).map((t) => t.id));
    const n = ids.filter((id) => have.has(id)).length;
    return pick(p.id, n === ids.length ? 'all' : n ? 'some' : 'none');
  };
  const likedState = () => {
    const n = ids.filter((id) => isLiked(id)).length;
    return pick('liked', n === ids.length ? 'all' : n ? 'some' : 'none');
  };
  const mark = (s) => `<span class="pp-mark ${s}">${s === 'all' ? icon('check', 16) : s === 'some' ? '–' : ''}</span>`;
  // Dossiers : une ligne qui se déroule pour ajouter aux playlists qu'il contient (déroulés pendant une recherche)
  const openFolders = new Set();
  const plRow = (p, nested) => `<button class="pp-row ${nested ? 'nested' : ''}" data-pl="${p.id}">${String(playlistCover(p, '', 96))}<span class="pp-name">${esc(p.name)}<small>${plural(p.tracks.length, 'titre')}</small></span>${mark(stateOf(p))}</button>`;
  const draw = () => {
    const match = (p) => !q || p.name.toLowerCase().includes(q);
    const folders = state.library.folders || [];
    const known = new Set(folders.map((f) => f.id));
    const rows = [];
    if (!q || 'titres likés'.includes(q)) rows.push(`<button class="pp-row" data-liked="1">${String(likedCover())}<span class="pp-name">Titres likés</span>${mark(likedState())}</button>`);
    for (const f of folders) {
      const inside = state.library.playlists.filter((p) => p.folderId === f.id && match(p));
      if (q && !inside.length) continue;
      const open = openFolders.has(f.id) || !!q;
      const n = inside.filter((p) => stateOf(p) !== 'none').length;
      rows.push(`<button class="pp-row pp-folder ${open ? 'open' : ''}" data-folder="${f.id}"><span class="pp-cov">${icon('folder', 22)}</span><span class="pp-name">${esc(f.name)}<small>Dossier · ${plural(inside.length, 'playlist')}${n ? ` · déjà dans ${n}` : ''}</small></span><span class="pp-chev">${icon('down', 18)}</span></button>`);
      if (open) inside.forEach((p) => rows.push(plRow(p, true)));
    }
    state.library.playlists.filter((p) => (!p.folderId || !known.has(p.folderId)) && match(p)).forEach((p) => rows.push(plRow(p, false)));
    el.querySelector('.pp-list').innerHTML = rows.join('') || '<p class="muted" style="padding:12px">Aucune playlist</p>';
  };
  draw();
  const busy = new Set();
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pp === 'close') return close();
    if (b.dataset.pp === 'new') {
      const name = await promptText('Nouvelle playlist', { value: arr.length === 1 ? arr[0].title : '', label: 'Créer' });
      if (name && name !== 'Annuler') {
        const p = await createPlaylist(name, arr);
        toast(`Ajouté à ${p.name}`);
      }
      return;
    }
    if (b.dataset.folder) {
      const id = b.dataset.folder;
      openFolders.has(id) ? openFolders.delete(id) : openFolders.add(id);
      return draw();
    }
    const key = b.dataset.pl || 'liked';
    if (busy.has(key)) return;
    busy.add(key);
    b.classList.add('busy');
    const was = b.dataset.liked ? likedState() : stateOf(state.library.playlists.find((x) => x.id === b.dataset.pl) || { tracks: [] });
    forced.set(key, was === 'all' ? 'none' : 'all');
    draw();
    try {
      if (b.dataset.liked) {
        if (was === 'all') for (const t of arr) await toggleLike(t);
        else await likeMany(arr);
      } else {
        const p = state.library.playlists.find((x) => x.id === b.dataset.pl);
        if (p && was === 'all') {
          for (const t of arr) await removeFromPlaylist(p.id, t);
        } else if (p) {
          await addToPlaylist(p.id, arr, { quiet: true });
          toast(`Ajouté à ${p.name}`);
        }
      }
    } catch (err) {
      forced.delete(key);
      draw();
      throw err;
    } finally {
      busy.delete(key);
      b.classList.remove('busy');
    }
  });
  el.querySelector('.pp-search input').addEventListener('input', (e) => ((q = e.target.value.toLowerCase().trim()), draw()));
  // Position : près du bouton cliqué (ou au centre sur téléphone)
  const r = el.getBoundingClientRect();
  if (at && innerWidth > 640) {
    el.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, at.x - r.width / 2)) + 'px';
    el.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, at.y - r.height - 12)) + 'px';
  } else el.classList.add('centered');
  const onLib = () => el.isConnected && draw();
  bus.addEventListener('library', onLib);
  const onDown = (e) => !el.contains(e.target) && !e.target.closest('.modal-backdrop, .modal, #modal-root') && close();
  const onKey = (e) => e.key === 'Escape' && close();
  setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
  document.addEventListener('keydown', onKey);
  function close() {
    bus.removeEventListener('library', onLib);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    el.remove();
    bd.remove();
    picker = null;
  }
  picker = { close };
  // Pas de focus auto sur écran tactile : ça ouvrirait le clavier de l'iPhone par-dessus la liste
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => el.querySelector('.pp-search input')?.focus({ preventScroll: true }), 50);
}

// ---------- Menu contextuel d'un titre ----------
export function playlistSubmenu(tracks) {
  const arr = [].concat(tracks);
  return () => [
    {
      label: 'Nouvelle playlist',
      icon: 'plus',
      action: async () => {
        const name = await promptText('Nouvelle playlist', { value: arr.length === 1 ? arr[0].title : '', label: 'Créer' });
        if (name) {
          const p = await createPlaylist(name, arr);
          toast(`Ajouté à ${p.name}`);
        }
      },
    },
    { sep: true },
    ...state.library.playlists.map((p) => ({ label: p.name, action: () => addToPlaylist(p.id, arr) })),
  ];
}

export function trackMenu(track, x, y, { playlistId, index } = {}) {
  const artists = (track.artists || []).filter((a) => a.id);
  const onPc = !window.Capacitor?.isNativePlatform?.() && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // Menu court et clair : l'essentiel en haut, le reste rangé dans « Plus »
  contextMenu(x, y, [
    { label: 'Ajouter à une playlist…', icon: 'plus', action: () => openPlaylistPicker(track, { x, y: y + 40 }) },
    { label: isLiked(track.id) ? 'Retirer des Titres likés' : 'Ajouter aux Titres likés', icon: isLiked(track.id) ? 'heartFill' : 'heart', action: () => toggleLike(track) },
    { label: sync.jam ? 'Ajouter à la file de la party' : "Ajouter à la file d'attente", icon: 'addQueue', action: () => ctl.addToQueue(track) },
    playlistId && { label: 'Retirer de cette playlist', icon: 'trash', action: () => removeFromPlaylist(playlistId, track) },
    { sep: true },
    !track.local && { label: 'Regarder le clip', icon: 'video', action: () => openClip(track) },
    artists.length === 1 && { label: "Aller à l'artiste", icon: 'person', action: () => (location.hash = `#/artist/${artists[0].id}`) },
    artists.length > 1 && { label: "Aller à l'artiste", icon: 'person', submenu: artists.map((a) => ({ label: a.name, action: () => (location.hash = `#/artist/${a.id}`) })) },
    track.album?.id && { label: "Aller à l'album", icon: 'library', action: () => (location.hash = `#/album/${track.album.id}`) },
    { label: 'Envoyer à un ami…', icon: 'send', action: () => sendToFriend({ tracks: [track] }, { x, y }) },
    { label: 'Plus', icon: 'more', submenu: () => [
      { label: 'Lire ensuite', icon: 'playNext', action: () => ctl.playNext(track) },
      { label: 'Lancer la radio du titre', icon: 'radio', action: () => ctl.playRadio(track) },
      setting('banned', []).includes(track.id)
        ? { label: 'Proposer à nouveau ce titre', icon: 'check', action: () => toggleBan(track) }
        : { label: 'Ne plus proposer ce titre', icon: 'close', action: async () => { await toggleBan(track); if (player.track?.id === track.id && !player.remoteSender) player.next(); } },
      onPc && !track.local && { label: 'Télécharger sur le PC', icon: 'import', action: () => import('./views-local.js').then((m) => m.downloadToPc([track])) },
      !track.local && { label: 'Copier le lien YouTube', icon: 'link', action: () => navigator.clipboard?.writeText(`https://music.youtube.com/watch?v=${track.id}`).then(() => toast('Lien copié')) },
    ] },
  ]);
}

// « Regarder le clip » (comme « Passer à la vidéo » sur Spotify) : le clip officiel du son en grand ;
// la musique se met en pause pendant le clip et reprend à la fermeture
export async function openClip(track) {
  const ov = document.createElement('div');
  ov.className = 'clip-ov';
  ov.innerHTML = `<div class="clip-box"><div class="clip-head"><div class="ellipsis"><b>${esc(track.title)}</b><span>${esc((track.artists || []).map((a) => a.name).join(', '))}</span></div><button class="icon-btn" aria-label="Fermer">${icon('close')}</button></div><div class="clip-frame"><div class="loading"><div class="spinner"></div></div></div></div>`;
  document.body.appendChild(ov);
  const wasPlaying = !player.paused && !player.remoteSender;
  if (wasPlaying) ctl.pause();
  const close = () => {
    ov.remove();
    if (wasPlaying) ctl.play();
  };
  ov.querySelector('.clip-head button').onclick = close;
  ov.addEventListener('click', (e) => e.target === ov && close());
  // Clip officiel : recherche « titre artiste » parmi les vidéos ; sinon la version du son
  let vid = track.video ? track.id : null;
  if (!vid) {
    const r = await api(`/api/search?q=${encodeURIComponent(`${track.title} ${track.artists?.[0]?.name || ''}`)}&type=video`).catch(() => null);
    vid = r?.items?.[0]?.id || track.id;
  }
  if (!ov.isConnected) return;
  ov.querySelector('.clip-frame').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(vid)}?autoplay=1&playsinline=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen title="Clip"></iframe>`;
}

// ---------- Cartes ----------
export function card(item, { sub, href, play, isNew } = {}) {
  const round = item.type === 'artist';
  const link = href || hrefOf(item);
  const p = play ?? playKeyOf(item);
  return html`<div class="card" data-href="${link}">
    ${isNew ? html`<span class="new-dot">NOUVEAU</span>` : ''}
    ${item.coverHtml || cover(item, round ? 'round' : '')}
    ${p ? html`<button class="card-play" data-play="${p}" aria-label="Lire">${icon('play')}</button>` : ''}
    <div class="card-title">${item.title || item.name}</div>
    <div class="card-sub">${sub ?? subOf(item)}</div>
  </div>`;
}

export function hrefOf(item) {
  switch (item.type) {
    case 'artist': return `#/artist/${item.id}`;
    case 'album': return `#/album/${item.id}`;
    case 'playlist': return `#/ytplaylist/${item.id}`;
    case 'local': return `#/playlist/${item.id}`;
    default: return item.album?.id ? `#/album/${item.album.id}` : '';
  }
}

function playKeyOf(item) {
  switch (item.type) {
    case 'artist': return `artist:${item.id}`;
    case 'album': return `album:${item.id}`;
    case 'playlist': return `ytplaylist:${item.id}`;
    case 'local': return `local:${item.id}`;
    case 'song':
    case 'video':
    case undefined: return item.id ? `track:${item.id}` : '';
    default: return '';
  }
}

function subOf(item) {
  switch (item.type) {
    case 'artist': return 'Artiste';
    case 'album': return [item.year, item.kind, (item.artists || []).map((a) => a.name).join(', ')].filter(Boolean).join(' • ');
    case 'playlist': return `Playlist${item.author ? ' • ' + item.author : ''}`;
    default: return (item.artists || []).map((a) => a.name).join(', ');
  }
}

// Registre des titres individuels affichés en carte (pour les lire).
const trackCards = new Map();
export function rememberTracks(tracks) {
  tracks.forEach((t) => trackCards.set(t.id, t));
}

export async function playKey(key) {
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  try {
    if (kind === 'track') {
      const t = trackCards.get(id);
      if (t) return ctl.playRadio(t);
    }
    if (kind === 'liked') return ctl.playList(state.library.liked, startAt(state.library.liked), { type: 'liked', name: 'Titres likés' });
    if (kind === 'daily') {
      const m = lastMixes.find((x) => x.id === id);
      if (m) return ctl.playList(m.tracks, startAt(m.tracks), { type: 'daily', id: m.id, name: m.name });
    }
    if (kind === 'local') {
      const p = state.library.playlists.find((x) => x.id === id);
      if (!p?.tracks.length) return toast('Playlist vide');
      return ctl.playList(p.tracks, startAt(p.tracks), { type: 'playlist', id, name: p.name });
    }
    if (kind === 'album') {
      const a = await api(`/api/album/${id}`);
      return ctl.playList(a.tracks, startAt(a.tracks), { type: 'album', id, name: a.title });
    }
    if (kind === 'ytplaylist') {
      const p = await api(`/api/ytplaylist/${id}`);
      return ctl.playList(p.tracks, startAt(p.tracks), { type: 'ytplaylist', id, name: p.title });
    }
    if (kind === 'artist') {
      const a = await api(`/api/artist/${id}`);
      if (!a.topTracks.length) return toast('Aucun titre trouvé');
      return ctl.playList(a.topTracks, startAt(a.topTracks), { type: 'artist', id, name: a.name });
    }
    if (kind === 'mix') {
      const t = trackCards.get(id);
      if (t) return ctl.playRadio(t);
    }
  } catch (e) {
    toast('Lecture impossible : ' + e.message);
  }
}

// ---------- Gestion des événements (délégation globale) ----------
let suppressClick = 0;
export function setupDelegation() {
  // Petite animation sur les cœurs au clic
  document.addEventListener('click', (e) => {
    const heart = e.target.closest('.like-btn, .t-like');
    if (!heart) return;
    heart.classList.remove('pop');
    void heart.offsetWidth;
    heart.classList.add('pop');
    setTimeout(() => heart.classList.remove('pop'), 450);
  }, true);
  document.addEventListener('click', (e) => {
    // Le clic qui suit un glissement ou un appui long ne doit pas lancer le titre
    if (Date.now() - suppressClick < 450 && e.target.closest('.track')) return;
    const playBtn = e.target.closest('[data-play]');
    if (playBtn) {
      e.stopPropagation();
      e.preventDefault();
      return playKey(playBtn.dataset.play);
    }
    const act = e.target.closest('[data-act]');
    const info = rowInfo(e.target);
    if (act && info) {
      e.stopPropagation();
      if (act.dataset.act === 'like') return toggleLike(info.track);
      if (act.dataset.act === 'more') {
        const r = act.getBoundingClientRect();
        return trackMenu(info.track, r.left - 180, r.bottom, { playlistId: info.list.playlistId, index: info.i });
      }
    }
    // Un clic sur un titre le lance (comme YouTube Music) ; les liens artiste/album restent cliquables.
    if (info && !e.target.closest('a')) return playRow(info);
    const cardEl = e.target.closest('[data-href]');
    if (cardEl && !e.target.closest('a,button')) {
      if (cardEl.dataset.href) location.hash = cardEl.dataset.href;
      else if (cardEl.querySelector('[data-play]')) playKey(cardEl.querySelector('[data-play]').dataset.play);
    }
  });


  document.addEventListener('contextmenu', (e) => {
    const info = rowInfo(e.target);
    if (!info) {
      // Clic droit sur la carte d'une de mes playlists (profil, accueil, bibliothèque…) : même menu que dans la liste
      const pid = e.target.closest('.card[data-href^="#/playlist/"], .quick-item[data-href^="#/playlist/"]')?.dataset.href.split('/')[2];
      const p = pid && state.library.playlists.find((x) => x.id === pid);
      if (!p) return;
      e.preventDefault();
      import('./views.js').then((v) => v.playlistMenu(p, e.clientX, e.clientY));
      return;
    }
    e.preventDefault();
    trackMenu(info.track, e.clientX, e.clientY, { playlistId: info.list.playlistId, index: info.i });
  });

  // Téléphone (comme Spotify) : glisser un titre vers la droite = l'ajouter à la file d'attente ;
  // vers la gauche = panneau « Ajouter à une playlist » ; appui long = menu du titre (panneau en bas).
  let sw = null;
  // Son d'une ligne : liste de sons, ou ligne de la file d'attente (« Suivant dans la file », panneau File d'attente)
  const swipeTrack = (row) => rowInfo(row)?.track || (row.dataset.qjump != null ? player.upcoming?.()[Number(row.dataset.qjump)] : null);
  document.addEventListener('touchstart', (e) => {
    const row = e.target.closest('.track, .q-item[data-qjump]');
    if (!row || e.touches.length > 1) return;
    sw = { row, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, locked: null };
    sw.long = setTimeout(() => {
      if (!sw || sw.locked) return;
      const info = rowInfo(row);
      sw = null;
      suppressClick = Date.now();
      navigator.vibrate?.(12);
      if (info) trackMenu(info.track, 0, 0, { playlistId: info.list.playlistId, index: info.i });
    }, 550);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!sw) return;
    const dx = e.touches[0].clientX - sw.x;
    const dy = e.touches[0].clientY - sw.y;
    if (!sw.locked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      sw.locked = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
      clearTimeout(sw.long);
    }
    if (sw.locked !== 'h') return;
    // Résistance au-delà du seuil (comme Spotify) : la ligne suit le doigt puis freine
    const soft = (v) => (Math.abs(v) <= 70 ? v : Math.sign(v) * (70 + (Math.abs(v) - 70) * 0.35));
    sw.dx = Math.max(-150, Math.min(150, dx));
    sw.row.classList.add('swiping');
    sw.row.style.transform = `translateX(${soft(sw.dx)}px)`;
    sw.row.dataset.swipe = sw.dx > 70 ? 'queue' : sw.dx < -70 ? 'add' : sw.dx > 0 ? 'queue-hint' : 'add-hint';
    // Fond révélé sous le titre (comme Spotify) : icône + action, qui s'allume quand on a glissé assez loin
    if (!sw.bg) {
      const host = sw.row.parentElement;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      sw.bg = document.createElement('div');
      sw.bg.className = 'swipe-bg';
      sw.bg.style.cssText = `top:${sw.row.offsetTop}px;left:${sw.row.offsetLeft}px;width:${sw.row.offsetWidth}px;height:${sw.row.offsetHeight}px`;
      sw.bg.innerHTML = `<span class="sb-q">${icon('addQueue', 22)}<b>File d'attente</b></span><span class="sb-a"><b>Ajouter à une playlist</b>${icon('plus', 22)}</span>`;
      sw.row.before(sw.bg);
    }
    sw.bg.dataset.dir = sw.dx > 0 ? 'right' : 'left';
    sw.bg.classList.toggle('armed', Math.abs(sw.dx) > 70);
    if (Math.abs(sw.dx) > 70 && !sw.buzzed) (sw.buzzed = true), navigator.vibrate?.(8);
    if (Math.abs(sw.dx) <= 70) sw.buzzed = false;
  }, { passive: true });
  const endSwipe = () => {
    if (!sw) return;
    clearTimeout(sw.long);
    const { row, dx, locked, bg } = sw;
    sw = null;
    if (bg) (bg.classList.add('out'), setTimeout(() => bg.remove(), 260));
    if (locked !== 'h') return;
    suppressClick = Date.now();
    // Retour en place : petit rebond si l'action est validée
    row.style.transition = Math.abs(dx) > 70 ? 'transform 0.38s cubic-bezier(0.3, 1.45, 0.5, 1)' : 'transform 0.22s ease';
    row.style.transform = '';
    if (Math.abs(dx) > 70) (row.classList.add('swiped'), setTimeout(() => row.classList.remove('swiped'), 600));
    setTimeout(() => {
      row.style.transition = '';
      row.classList.remove('swiping');
      delete row.dataset.swipe;
    }, 400);
    const track = swipeTrack(row);
    if (!track) return;
    if (dx > 70) {
      ctl.addToQueue(track);
      navigator.vibrate?.(15);
    } else if (dx < -70) openPlaylistPicker(track);
  };
  document.addEventListener('touchend', endSwipe, { passive: true });
  document.addEventListener('touchcancel', endSwipe, { passive: true });

  // Glisser-déposer : vers une playlist de la barre latérale, ou réordonner une playlist.
  let dragInfo = null;
  document.addEventListener('dragstart', (e) => {
    const info = rowInfo(e.target);
    if (!info) return;
    dragInfo = info;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', info.track.title);
  });
  document.addEventListener('dragend', () => {
    dragInfo = null;
    document.querySelectorAll('.drop,.drag-over').forEach((x) => x.classList.remove('drop', 'drag-over'));
  });
  document.addEventListener('dragover', (e) => {
    if (!dragInfo) return;
    const target = e.target.closest('.lib-item[data-pl], .track');
    document.querySelectorAll('.drop,.drag-over').forEach((x) => x !== target && x.classList.remove('drop', 'drag-over'));
    if (!target) return;
    if (target.classList.contains('lib-item')) {
      e.preventDefault();
      target.classList.add('drop');
    } else if (dragInfo.list.reorder && target.dataset.list === dragInfo.row.dataset.list) {
      e.preventDefault();
      target.classList.add('drag-over');
    }
  });
  document.addEventListener('drop', async (e) => {
    if (!dragInfo) return;
    const info = dragInfo;
    dragInfo = null;
    const pl = e.target.closest('.lib-item[data-pl]');
    if (pl) {
      e.preventDefault();
      pl.classList.remove('drop');
      if (pl.dataset.pl === 'liked') {
        if (!isLiked(info.track.id)) toggleLike(info.track);
      } else addToPlaylist(pl.dataset.pl, [info.track]);
      return;
    }
    const row = e.target.closest('.track');
    if (row && info.list.reorder && row.dataset.list === info.row.dataset.list) {
      e.preventDefault();
      const to = Number(row.dataset.i);
      if (to === info.i) return;
      await movePlaylistItem(info.list.playlistId, info.i, to);
    }
  });
}
