// Point d'entrée : profils, routeur, barre latérale, barre de lecture, panneau de droite, lecteur mobile.
import { ACCENTS, html, raw, esc, icon, fmtTime, artistLinks, toast, promptText, contextMenu, debounce, isMobile, dominantColor, modal, plural } from './ui.js';
import { removeFromPlaylist, movePlaylist, moveRoot, rootEntries, movePlaylistToFolder, refreshPublicProfile, setting, saveSettings, state, api, on, emit, ls, setProfile, isLiked, toggleLike, createPlaylist, addToPlaylist, listProfiles, createProfile, deleteProfile, subscribeLibrary } from './state.js';
import { cloud, parseInvite, getDoc } from './cloud.js';
import { firebaseConfig } from './firebase-config.js';
import { player, ctl, TRANSITION_NAMES } from './player.js';
import { sync } from './sync.js';
import { lists, cover, playlistCover, likedCover, setupDelegation, refreshTrackMarks, trackList } from './components.js';
import { mountLyrics, openKaraoke } from './lyrics.js';
import { openPlaylistPicker } from './components.js';
import { pinPad, offerPinOnCreate } from './pin.js';
import { webUpdateBoot, webUpdateConfirm, webUpdateReady, checkWebUpdate, applyWebUpdate } from './updater.js';
import { startPlaylistSync } from './playlist-sync.js';
import { openCarMode } from './car.js';
import { startBlend } from './blend.js';
import { reportsPage } from './views-reports.js';
import * as V from './views.js';
import * as X from './views-extra.js';
import { concerts } from './views-concerts.js';
import { aiPage } from './views-ai.js';
import { profilePage, avatarHtml, followingPage } from './views-profile.js';
import { discoverPage } from './views-discover.js';
import { statsPage } from './views-stats.js';
import { wrappedPage } from './views-wrapped.js';
import { automix } from './automix.js';
import { isNative, nativeInfo } from './native.js';
import { offline } from './offline.js';
import { social } from './social.js';
import { friendsPage, friendsPanel } from './views-social.js';
import { userPage, sharedPlaylistPage } from './views-share.js';
import { startRelay } from './relay.js';

const $ = (s, r = document) => r.querySelector(s);

// ======================= PROFILS =======================
let firstProfileName = null; // prénom saisi à l'accueil (premier appareil)
async function pickProfile(force = false) {
  await listProfiles();
  const saved = ls.get('boombox.profile');
  const found = state.profiles.find((p) => p.id === saved);
  // Le profil déjà choisi sur cet appareil s'ouvre directement ; un autre profil protégé demande son code
  if (!force && found) return found;
  if (!force && state.profiles.length === 1 && (!state.profiles[0].pin || (hideSplash(), await pinPad(state.profiles[0])))) return state.profiles[0];
  if (!state.profiles.length) {
    // Premier lancement : le prénom a été demandé à l'accueil (sinon on le demande ici)
    let name = firstProfileName;
    while (!name) name = await promptText("Comment tu t'appelles ?", { placeholder: 'Prénom', label: 'Continuer' });
    const p = await createProfile(name);
    state.profiles.push(p);
    hideSplash();
    await offerPinOnCreate(p);
    return p;
  }
  return new Promise((resolve) => {
    hideSplash();
    const box = $('#profile-picker');
    const render = () => {
      box.innerHTML = String(html`<div><h1>Qui écoute ?</h1><div class="profiles">
        ${state.profiles.map((p) => html`<div class="profile-card" data-id="${p.id}">${p.photo ? html`<div class="pic" style="background:center/cover url('${p.photo}')"></div>` : html`<div class="pic" style="background:${p.color}">${p.name[0]?.toUpperCase()}</div>`}${p.name}</div>`)}
        <div class="profile-card" data-add><div class="pic add">${icon('plus')}</div>Ajouter</div>
      </div>
      ${state.profiles.length ? html`<button class="btn ghost" style="margin-top:40px" id="manage">Supprimer un profil</button>` : ''}</div>`);
      box.querySelectorAll('[data-id]').forEach((c) => (c.onclick = async () => {
        const p = state.profiles.find((x) => x.id === c.dataset.id);
        // Code demandé pour un profil protégé, sauf si c'est déjà celui de cet appareil (simple retour)
        if (p.pin && p.id !== state.profile?.id && !(await pinPad(p))) return;
        box.classList.add('hidden');
        resolve(p);
      }));
      box.querySelector('[data-add]').onclick = async () => {
        const name = await promptText('Nouveau profil', { placeholder: 'Prénom', label: 'Créer' });
        if (!name) return;
        const np = await createProfile(name);
        state.profiles.push(np);
        render();
        await offerPinOnCreate(np);
        render();
      };
      box.querySelector('#manage')?.addEventListener('click', () => {
        const r = box.querySelector('#manage').getBoundingClientRect();
        contextMenu(r.left, r.bottom, state.profiles.map((p) => ({
          label: `Supprimer « ${p.name} »`, icon: 'trash', danger: true,
          action: async () => {
            // Profil protégé : son code d'abord ; puis confirmation en tapant le nom du profil (suppression définitive)
            if (p.pin && !(await pinPad(p, { title: `Code de ${p.name} pour le supprimer` }))) return;
            const mine = p.id === state.profile?.id || p.id === ls.get('boombox.profile');
            const ok = await modal({
              title: `Supprimer ${p.name} ?`,
              body: String(html`<p class="muted">${mine ? "C'est le profil ouvert sur cet appareil. " : ''}Ses playlists, likes, abonnements, amis et messages seront définitivement perdus, sur tous les appareils.</p>
                <p class="muted" style="margin-bottom:6px">Pour confirmer, tape <b>${p.name}</b> :</p><input class="input" autocomplete="off" style="width:100%">`),
              actions: [{ label: 'Annuler' }, { label: 'Supprimer définitivement', danger: true, value: (w) => (w.querySelector('input').value.trim().toLowerCase() === p.name.trim().toLowerCase() ? 'ok' : 'mismatch') }],
            });
            if (ok === 'mismatch') return toast('Nom incorrect : profil non supprimé');
            if (ok !== 'ok') return;
            if (p.socialCode) await social.deleteCard(p.socialCode).catch(() => {});
            await deleteProfile(p.id);
            state.profiles = state.profiles.filter((x) => x.id !== p.id);
            toast(`Profil « ${p.name} » supprimé`);
            // Profil de cet appareil supprimé : on repart de zéro (choix d'un autre profil, ou création)
            if (mine) {
              ls.set('boombox.profile', null);
              return location.reload();
            }
            render();
          },
        })));
      });
    };
    render();
    box.classList.remove('hidden');
  });
}

document.addEventListener('pick-profile', async () => {
  const p = await pickProfile(true);
  if (p.id !== state.profile.id) {
    ls.set('boombox.profile', p.id);
    location.reload();
  }
});
document.addEventListener('profile-updated', renderAvatar);

function renderAvatar() {
  const b = $('#btn-profile');
  b.innerHTML = String(avatarHtml(state.profile));
  b.style.background = 'transparent';
  b.title = state.profile.name;
}

// ======================= ROUTEUR =======================
const routes = [
  [/^$/, V.home, 'home'],
  [/^search$/, V.search, 'search'],
  [/^liked$/, V.liked, 'liked'],
  [/^playlist\/([\w-]+)$/, V.playlist, 'playlist', ['id']],
  [/^album\/([\w-]+)$/, V.album, 'album', ['id']],
  [/^artist\/([\w-]+)$/, V.artist, 'artist', ['id']],
  [/^discography\/([\w-]+)$/, V.discography, 'discography', ['id']],
  [/^ytplaylist\/([\w-]+)$/, V.ytplaylist, 'ytplaylist', ['id']],
  [/^releases$/, V.releases, 'releases'],
  [/^library$/, V.library, 'library'],
  [/^import$/, X.importPage, 'import'],
  [/^settings$/, X.settings, 'settings'],
  [/^stats$/, statsPage, 'stats'],
  [/^wrapped$/, wrappedPage, 'wrapped'],
  [/^history$/, X.historyPage, 'history'],
  [/^jam$/, X.jam, 'jam'],
  [/^trash$/, V.trash, 'trash'],
  [/^concerts$/, concerts, 'concerts'],
  [/^reports$/, reportsPage, 'reports'],
  [/^lyrics$/, X.lyricsPage, 'lyrics'],
  [/^ai$/, aiPage, 'ai'],
  [/^profile$/, profilePage, 'profile'],
  [/^following$/, followingPage, 'following'],
  [/^friends$/, friendsPage, 'friends'],
  [/^user\/([A-Z2-9]{8})$/, userPage, 'user', ['code']],
  [/^shared\/([A-Z2-9]{8})\/([\w-]+)$/, sharedPlaylistPage, 'shared', ['owner', 'id']],
  [/^discover$/, discoverPage, 'discover'],
  [/^mix\/([\w-]+)$/, V.mixPage, 'mix', ['id']],
  [/^folder\/([\w-]+)$/, V.folderPage, 'folder', ['id']],
];

let routeToken = 0;
let current = { name: '', hooks: null, params: {} };

async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  let match = null;
  for (const [re, fn, name, keys = []] of routes) {
    const m = path.match(re);
    if (m) {
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      match = { fn, name };
      break;
    }
  }
  if (!match) match = { fn: V.home, name: 'home' };

  current.hooks?.cleanup?.();
  const token = ++routeToken;
  const view = $('#view');
  lists.clear();
  view.scrollTop = 0;
  view.innerHTML = '';
  document.documentElement.style.setProperty('--topbar-bg', '#121212');
  $('#topbar').classList.remove('solid');
  current = { name: match.name, hooks: null, params };
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === match.name));
  $('#topbar').classList.toggle('show-search', match.name === 'search');
  const input = $('#search-input');
  if (match.name === 'search') {
    if (document.activeElement !== input) input.value = params.q || '';
    if (!params.q && !isMobile()) input.focus();
  } else if (document.activeElement !== input) input.value = '';
  renderSidebarList();

  try {
    const hooks = await match.fn(view, params, { alive: () => token === routeToken });
    if (token === routeToken) current.hooks = hooks || null;
  } catch (e) {
    console.error(e);
    if (token === routeToken) view.innerHTML = String(html`<div class="page"><div class="empty"><h2>Erreur</h2><p>${e.message}</p></div></div>`);
  }
}
window.addEventListener('hashchange', route);

// Barre du haut opaque quand on fait défiler
$('#view').addEventListener('scroll', (e) => $('#topbar').classList.toggle('solid', e.target.scrollTop > 60), { passive: true });

// ======================= RECHERCHE (barre du haut) =======================
function setupSearch() {
  const input = $('#search-input');
  const box = $('#suggest');
  let sel = -1;
  const go = (q) => {
    box.classList.add('hidden');
    const target = `#/search?q=${encodeURIComponent(q)}`;
    if (current.name === 'search' && current.params.q) history.replaceState(null, '', target), route();
    else location.hash = target;
  };
  const navigate = debounce(() => {
    const q = input.value.trim();
    if (q) go(q);
  }, 450);
  const suggest = debounce(async () => {
    const q = input.value.trim();
    if (!q) return box.classList.add('hidden');
    const list = await api(`/api/suggest?q=${encodeURIComponent(q)}`).catch(() => []);
    if (input.value.trim() !== q || document.activeElement !== input) return;
    sel = -1;
    box.innerHTML = list.map((s) => String(html`<button data-s="${s}">${icon('search')}<span>${s}</span></button>`)).join('');
    box.classList.toggle('hidden', !list.length);
  }, 150);
  input.addEventListener('input', () => {
    suggest();
    navigate();
  });
  input.addEventListener('focus', () => {
    if (current.name !== 'search' && !isMobile()) location.hash = '#/search' + (input.value ? `?q=${encodeURIComponent(input.value)}` : '');
  });
  input.addEventListener('keydown', (e) => {
    const items = [...box.querySelectorAll('button')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, i) => b.classList.toggle('sel', i === sel));
      if (items[sel]) input.value = items[sel].dataset.s;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      navigate.cancel?.();
      if (input.value.trim()) go(input.value.trim());
      input.blur();
    } else if (e.key === 'Escape') box.classList.add('hidden');
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
  // Recherche vocale (Chrome, Edge, Safari)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voice = $('#voice-btn');
  if (SR) {
    voice.classList.remove('hidden');
    voice.onclick = () => {
      const rec = new SR();
      rec.lang = 'fr-FR';
      rec.interimResults = true;
      voice.classList.add('listening');
      input.placeholder = "Je t'écoute…";
      rec.onresult = (e) => {
        input.value = [...e.results].map((r) => r[0].transcript).join('');
        if (e.results[e.results.length - 1].isFinal) go(input.value.trim());
      };
      rec.onerror = (e) => e.error !== 'aborted' && toast(e.error === 'not-allowed' ? 'Autorise le micro pour la recherche vocale' : "Je n'ai pas compris, réessaie");
      rec.onend = () => {
        voice.classList.remove('listening');
        input.placeholder = 'Que souhaitez-vous écouter ?';
      };
      rec.start();
    };
  }
  box.addEventListener('mousedown', (e) => {
    const b = e.target.closest('[data-s]');
    if (b) {
      input.value = b.dataset.s;
      go(b.dataset.s);
    }
  });
}

// ======================= BARRE LATÉRALE =======================
let libFilter = ls.get('boombox.libFilter', null);
function renderSidebarList() {
  const ul = $('#lib-list');
  if (!ul) return;
  const q = $('#lib-filter').value.toLowerCase().trim();
  const lib = state.library;
  const ctxId = player.context?.id;
  document.querySelectorAll('#lib-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === libFilter));
  const items = [];
  if (libFilter !== 'artists' && (!q || 'titres likés'.includes(q))) {
    items.push(html`<li class="lib-item ${current.name === 'liked' ? 'active' : ''} ${player.context?.type === 'liked' ? 'playing' : ''}" data-href="#/liked" data-pl="liked">${likedCover()}
      <div class="ellipsis"><div class="lib-name ellipsis">Titres likés</div><div class="lib-sub">${icon('pin', 14)}Playlist • ${plural(lib.liked.length, 'titre')}</div></div></li>`);
  }
  if (libFilter !== 'artists') {
    // Tri choisi dans la bibliothèque (les épinglées restent toujours en haut)
    const sortMode = ls.get('boombox.libSort', 'custom');
    const SORTS = { recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), alpha: (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }), size: (a, b) => b.tracks.length - a.tracks.length };
    let pls = lib.playlists.filter((p) => !q || p.name.toLowerCase().includes(q));
    if (SORTS[sortMode]) pls = pls.slice().sort((a, b) => (!!b.pinned - !!a.pinned) || SORTS[sortMode](a, b));
    const canDrag = sortMode === 'custom' && !q;
    const grip = canDrag ? html`<span class="grip" aria-hidden="true">⋮⋮</span>` : '';
    const plItem = (p, nested) => html`<li class="lib-item ${nested ? 'nested' : ''} ${current.params.id === p.id ? 'active' : ''} ${ctxId === p.id ? 'playing' : ''}" data-href="#/playlist/${p.id}" data-pl="${p.id}" data-plmenu="${p.id}" draggable="${canDrag ? 'true' : 'false'}" title="${p.name}">${grip}${playlistCover(p, '', 96)}
        <div class="ellipsis"><div class="lib-name ellipsis">${p.name}</div><div class="lib-sub">${p.pinned ? icon('pin', 14) : ''}Playlist • ${plural(p.tracks.length, 'titre')}</div></div></li>`;
    const folders = lib.folders || [];
    const openFolders = ls.get('boombox.openFolders', []);
    const folderItem = (f) => {
      const inside = pls.filter((p) => p.folderId === f.id);
      if (q && !inside.length && !f.name.toLowerCase().includes(q)) return;
      const open = openFolders.includes(f.id) || !!q;
      items.push(html`<li class="lib-item folder ${open ? 'open' : ''} ${current.params.id === f.id ? 'active' : ''}" data-folder="${f.id}" data-foldermenu="${f.id}" draggable="${canDrag ? 'true' : 'false'}">${grip}<div class="cover folder-cover">${icon('folder')}</div>
        <div class="ellipsis" style="flex:1"><div class="lib-name ellipsis">${f.name}</div><div class="lib-sub">Dossier • ${plural(inside.length, 'playlist')}</div></div><span class="folder-chevron">${icon('forward', 18)}</span></li>`);
      if (open) for (const p of inside) items.push(plItem(p, true));
    };
    const known = new Set(folders.map((f) => f.id));
    if (canDrag) {
      // Ordre perso : dossiers et playlists mélangés, dans l'ordre choisi en les faisant glisser
      const byId = new Map(lib.playlists.map((p) => [p.id, p]));
      for (const e of rootEntries()) {
        if (e.kind === 'folder') folderItem(folders.find((f) => f.id === e.id));
        else items.push(plItem(byId.get(e.id), false));
      }
    } else {
      // Autres tris : les dossiers d'abord, puis les playlists hors dossier
      folders.forEach(folderItem);
      for (const p of pls.filter((p) => !p.folderId || !known.has(p.folderId))) items.push(plItem(p, false));
    }
  }
  if (libFilter !== 'playlists') {
    for (const f of lib.follows.filter((f) => !q || f.name.toLowerCase().includes(q))) {
      items.push(html`<li class="lib-item ${current.params.id === f.id ? 'active' : ''}" data-href="#/artist/${f.id}">${cover(f, 'round')}<div class="ellipsis"><div class="lib-name ellipsis">${f.name}</div><div class="lib-sub">Artiste</div></div></li>`);
    }
  }
  ul.innerHTML = items.join('') || '<li class="muted" style="padding:16px">Rien ici pour le moment.</li>';
}

function setupSidebar() {
  $('#lib-filter').addEventListener('input', renderSidebarList);
  $('#lib-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    libFilter = libFilter === c.dataset.filter ? null : c.dataset.filter;
    ls.set('boombox.libFilter', libFilter);
    renderSidebarList();
  });
  $('#lib-list').addEventListener('click', (e) => {
    const f = e.target.closest('[data-folder]');
    if (!f) return;
    const id = f.dataset.folder;
    const open = ls.get('boombox.openFolders', []);
    ls.set('boombox.openFolders', open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);
    renderSidebarList();
  });
  // Réordonner playlists et dossiers par glisser-déposer : l'élément déposé se place au-dessus de la cible.
  // Une playlist lâchée sur la moitié basse d'un dossier entre dedans.
  let plDrag = null; // { kind: 'playlist' | 'folder', id }
  const list = $('#lib-list');
  const clearMarks = () => list.querySelectorAll('.pl-drop-before, .pl-drop-end, .pl-drop-into').forEach((x) => x.classList.remove('pl-drop-before', 'pl-drop-end', 'pl-drop-into'));
  // Où tomberait l'élément glissé : { li, mode: 'before' | 'into' | 'end' }, ou null si impossible
  const dropAt = (e) => {
    const li = e.target.closest('[data-plmenu], [data-folder]');
    if (!li) return { li: [...list.querySelectorAll('[data-plmenu], [data-folder]')].pop(), mode: 'end' };
    const isFolder = 'folder' in li.dataset;
    const id = isFolder ? li.dataset.folder : li.dataset.plmenu;
    if (id === plDrag.id) return null;
    if (plDrag.kind === 'folder') return li.classList.contains('nested') ? null : { li, mode: 'before' };
    if (isFolder) {
      const r = li.getBoundingClientRect();
      return { li, mode: e.clientY > r.top + r.height / 2 ? 'into' : 'before' };
    }
    return { li, mode: 'before' };
  };
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('[data-plmenu], [data-folder]');
    if (!li || li.getAttribute('draggable') !== 'true') return;
    plDrag = 'folder' in li.dataset ? { kind: 'folder', id: li.dataset.folder } : { kind: 'playlist', id: li.dataset.plmenu };
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', plDrag.kind);
  });
  list.addEventListener('dragend', () => {
    plDrag = null;
    list.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
    clearMarks();
  });
  list.addEventListener('dragover', (e) => {
    if (!plDrag) return;
    e.preventDefault();
    clearMarks();
    const d = dropAt(e);
    d?.li?.classList.add(d.mode === 'end' ? 'pl-drop-end' : d.mode === 'into' ? 'pl-drop-into' : 'pl-drop-before');
  });
  list.addEventListener('drop', async (e) => {
    if (!plDrag) return;
    e.preventDefault();
    const d = dropAt(e);
    const drag = plDrag;
    plDrag = null;
    clearMarks();
    if (!d) return;
    const target = d.mode === 'end' ? null : 'folder' in d.li.dataset ? { kind: 'folder', id: d.li.dataset.folder } : { kind: 'playlist', id: d.li.dataset.plmenu };
    if (!target) await moveRoot(drag, { edge: 'bottom' });
    else if (d.mode === 'into') {
      await movePlaylistToFolder(drag.id, target.id);
      toast(`Déplacée dans « ${state.library.folders.find((f) => f.id === target.id)?.name || 'le dossier'} »`);
    } else if (drag.kind === 'playlist' && target.kind === 'playlist') await movePlaylist(drag.id, { before: target.id });
    else await moveRoot(drag, { before: target });
    ls.set('boombox.libHintSeen', true);
    $('#lib-hint').classList.add('hidden');
  });
  // Tri de la bibliothèque
  const sortSel = $('#lib-sort');
  sortSel.value = ls.get('boombox.libSort', 'custom');
  sortSel.onchange = () => {
    ls.set('boombox.libSort', sortSel.value);
    renderSidebarList();
    updateLibHint();
  };
  updateLibHint();
  setupSideResize();
  setupNavSplit();
  $('#lib-list').addEventListener('dblclick', (e) => {
    const f = e.target.closest('[data-folder]');
    if (f) location.hash = `#/folder/${f.dataset.folder}`;
  });
  $('#lib-list').addEventListener('contextmenu', (e) => {
    const fo = e.target.closest('[data-foldermenu]');
    if (fo) {
      e.preventDefault();
      return V.folderMenu(fo.dataset.foldermenu, e.clientX, e.clientY);
    }
    const li = e.target.closest('[data-plmenu]');
    if (!li) return;
    e.preventDefault();
    const p = state.library.playlists.find((x) => x.id === li.dataset.plmenu);
    if (p) V.playlistMenu(p, e.clientX, e.clientY);
  });
  $('#btn-new-playlist').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 4, [
      { label: 'Créer une playlist', icon: 'music', action: async () => {
        const p = await createPlaylist(`Ma playlist n°${state.library.playlists.length + 1}`);
        location.hash = `#/playlist/${p.id}`;
      } },
      { label: 'Créer un dossier de playlists', icon: 'folder', action: () => V.newFolder() },
    ]);
  };
  $('#btn-import').onclick = () => (location.hash = '#/import');
  $('#btn-profile').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.right - 240, r.bottom + 8, [
      { label: 'Profil', icon: 'person', action: () => (location.hash = '#/profile') },
      { label: `Amis et messages${social.unread ? ` (${social.unread})` : ''}`, icon: 'chat', action: () => (location.hash = '#/friends') },
      { label: 'Changer de profil', icon: 'users', action: () => document.dispatchEvent(new Event('pick-profile')) },
      { sep: true },
      { label: 'Ton récap', icon: 'chart', action: () => (location.hash = '#/stats') },
      { label: 'Historique', icon: 'clock', action: () => (location.hash = '#/history') },
      { label: 'Blend avec un ami', icon: 'users', action: startBlend },
      { label: 'Concerts près de chez toi', icon: 'ticket', action: () => (location.hash = '#/concerts') },
      { label: sync.jam ? 'Mode party (en cours)' : 'Mode party', icon: 'users', action: () => (location.hash = '#/jam') },
      { label: 'Assistant IA', icon: 'sparkle', action: () => (location.hash = '#/ai') },
      { label: 'Importer une playlist', icon: 'import', action: () => (location.hash = '#/import') },
      { label: "Rapports d'import", icon: 'sync', action: () => (location.hash = '#/reports') },
      { label: `Corbeille${state.library.trash?.length ? ` (${state.library.trash.length})` : ''}`, icon: 'trash', action: () => (location.hash = '#/trash') },
      { sep: true },
      { label: 'Paramètres', icon: 'settings', action: () => (location.hash = '#/settings') },
    ]);
  };
  $('#btn-jam-top').onclick = () => (location.hash = '#/jam');
  // Amis : panneau d'activité à droite (ordinateur) ou page Amis (téléphone)
  $('#btn-friends').onclick = () => (isMobile() || innerWidth <= 900 ? (location.hash = '#/friends') : togglePanel('friends'));
}

// ======================= CURSEURS (progression / volume) =======================
function slider(el, { onChange, onCommit }) {
  el.innerHTML = '<div class="fill"></div><div class="knob"></div>';
  let dragging = false;
  const frac = (e) => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    el.classList.add('drag');
    el.setPointerCapture(e.pointerId);
    const f = frac(e);
    el.style.setProperty('--v', f * 100 + '%');
    onChange?.(f);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const f = frac(e);
    el.style.setProperty('--v', f * 100 + '%');
    onChange?.(f);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('drag');
    onCommit?.(frac(e));
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => ((dragging = false), el.classList.remove('drag')));
  return {
    set(f) {
      if (!dragging) el.style.setProperty('--v', Math.min(1, Math.max(0, f || 0)) * 100 + '%');
    },
    get dragging() {
      return dragging;
    },
  };
}

// ======================= BARRE DE LECTURE =======================
const pb = {};
function setupPlayerBar() {
  const bar = $('#playerbar');
  bar.innerHTML = String(html`
    <div class="pb-track">
      <div id="pb-cover"></div>
      <div class="pb-text"><a class="pb-title ellipsis link" id="pb-title"></a><span class="pb-artist ellipsis" id="pb-artist"></span></div>
      <button class="like-btn" id="pb-like" aria-label="Liker">${icon('heart')}</button><button class="ctrl pb-add" id="pb-add" title="Ajouter à une playlist" aria-label="Ajouter à une playlist">${icon('addCircle', 20)}</button>
    </div>
    <div class="pb-center">
      <div class="pb-controls">
        <button class="ctrl" id="pb-shuffle" title="Aléatoire">${icon('shuffle')}</button>
        <button class="ctrl" id="pb-prev" title="Précédent">${icon('prev')}</button>
        <button class="play-btn mobile-keep" id="pb-play" title="Lecture">${icon('play')}</button>
        <button class="ctrl" id="pb-next" title="Suivant">${icon('next')}</button>
        <button class="ctrl" id="pb-repeat" title="Répéter">${icon('repeat')}</button>
      </div>
      <div class="progress"><span id="pb-cur">0:00</span><div class="slider" id="pb-seek"></div><span id="pb-dur">0:00</span></div>
    </div>
    <div class="pb-right">
      <button class="ctrl" data-panel="np" title="Vue « En cours de lecture »">${icon('video')}</button>
      <button class="ctrl" data-panel="lyrics" title="Paroles">${icon('lyrics')}</button>
      <button class="ctrl" data-panel="queue" title="File d'attente">${icon('queue')}</button>
      <button class="ctrl" data-panel="devices" title="Appareils">${icon('devices')}</button>
      <button class="ctrl" id="pb-more" title="Plus d'options : automix, vitesse, minuteur, mini-lecteur">${icon('more')}</button>
      <button class="ctrl" id="pb-mute" title="Muet">${icon('volume')}</button>
      <div class="slider vol" id="pb-vol"></div>
    </div>
    <div class="remote-banner hidden" id="pb-remote">${icon('devices', 14)}<span></span></div>`);
  Object.assign(pb, {
    cover: $('#pb-cover'), title: $('#pb-title'), artist: $('#pb-artist'), like: $('#pb-like'), play: $('#pb-play'),
    shuffle: $('#pb-shuffle'), repeat: $('#pb-repeat'), cur: $('#pb-cur'), dur: $('#pb-dur'), mute: $('#pb-mute'), remote: $('#pb-remote'), more: $('#pb-more'),
  });
  pb.seek = slider($('#pb-seek'), {
    onChange: (f) => (pb.cur.textContent = fmtTime(f * (sync.view().duration || 0))),
    onCommit: (f) => ctl.seek(f * (sync.view().duration || 0)),
  });
  pb.vol = slider($('#pb-vol'), { onChange: (f) => ctl.setVolume(f) });
  pb.play.onclick = (e) => (e.stopPropagation(), ctl.toggle());
  $('#pb-next').onclick = () => ctl.next();
  $('#pb-prev').onclick = () => ctl.prev();
  pb.shuffle.onclick = () => ctl.toggleShuffle();
  pb.repeat.onclick = () => ctl.cycleRepeat();
  pb.mute.onclick = () => ctl.toggleMute();
  // « + » : ajouter le son en cours à une ou plusieurs playlists (coches, ajout / retrait sans fermer)
  $('#pb-add').onclick = (e) => {
    e.stopPropagation();
    const t = sync.view().track;
    if (!t) return;
    const r = e.currentTarget.getBoundingClientRect();
    openPlaylistPicker(t, { x: r.left + r.width / 2, y: r.top });
  };
  pb.like.onclick = (e) => {
    e.stopPropagation();
    const t = sync.view().track;
    if (t) toggleLike(t);
  };
  // Menu « Plus d'options » : regroupe les réglages de lecture secondaires
  pb.more.onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left - 200, r.top - 330, [
      { label: setting('automix', false) ? 'Automix : activé' : 'Automix : désactivé', icon: setting('automix', false) ? 'check' : 'automix', action: toggleAutomix },
      { label: player.rate !== 1 ? `Vitesse : ×${String(player.rate).replace('.', ',')}` : 'Vitesse de lecture', icon: 'speed', submenu: speedItems },
      { label: player.sleep ? 'Minuteur : actif' : 'Minuteur de sommeil', icon: 'moon', submenu: sleepItems },
      { label: 'Paroles en plein écran', icon: 'lyrics', action: openKaraoke },
      { label: 'Mode voiture', icon: 'car', action: openCarMode },
      'documentPictureInPicture' in window && { label: 'Mini-lecteur flottant', icon: 'pip', action: togglePip },
      { label: 'Raccourcis clavier', icon: 'keyboard', action: showShortcuts },
    ]);
  };
  async function toggleAutomix() {
    const on = !setting('automix', false);
    if (on && player.engine?.name !== 'audio') return toast('L’automix nécessite la lecture audio directe (yt-dlp)');
    await saveSettings({ automix: on });
    player.setAutomix(on);
    toast(on ? 'Automix activé : enchaînements calés sur le rythme (et choix harmonique en aléatoire)' : 'Automix désactivé');
    updatePlayerState();
  }
  bar.querySelectorAll('[data-panel]').forEach((b) => (b.onclick = () => togglePanel(b.dataset.panel)));
  pb.cover.onclick = () => (isMobile() ? openFullPlayer() : togglePanel('np'));
  bar.addEventListener('click', (e) => {
    if (Date.now() - lastSwipe < 400) return;
    if (isMobile() && !e.target.closest('button,a')) openFullPlayer();
  });
  // Glisser le mini-lecteur : titre suivant / précédent
  swipe(bar, { left: () => ctl.next(), right: () => ctl.prev() });
  bar.addEventListener('contextmenu', (e) => {
    const t = sync.view().track;
    if (!t || !e.target.closest('.pb-track')) return;
    e.preventDefault();
    import('./components.js').then((c) => c.trackMenu(t, e.clientX, e.clientY - 300));
  });
}

let lastTrackId = null;
function updatePlayerTrack() {
  const v = sync.view();
  const t = v.track;
  $('#playerbar').classList.toggle('empty', !t);
  if (t?.id !== lastTrackId) {
    lastTrackId = t?.id;
    pb.cover.innerHTML = t ? String(cover(t, '', 120)) : '';
    pb.title.textContent = t?.title || '';
    pb.title.href = t?.album?.id ? `#/album/${t.album.id}` : '#/lyrics';
    pb.artist.innerHTML = t ? String(artistLinks(t)) : '';
    if (t?.thumb) dominantColor(t.thumb).then((c) => c && document.documentElement.style.setProperty('--mini', c));
  }
  const liked = !!(t && isLiked(t.id));
  if (pb.like.dataset.on !== String(liked)) {
    pb.like.dataset.on = String(liked);
    pb.like.classList.toggle('on', liked);
    pb.like.innerHTML = String(icon(liked ? 'heartFill' : 'heart'));
  }
  pb.like.style.visibility = t ? '' : 'hidden';
  pb.remote.classList.toggle('hidden', !v.remote);
  $('#app').classList.toggle('has-remote', !!v.remote);
  if (v.remote) pb.remote.querySelector('span').textContent = `Lecture sur ${v.deviceName || 'un autre appareil'}`;
  refreshTrackMarks();
}

function updatePlayerState() {
  const v = sync.view();
  pb.play.innerHTML = String(icon(v.paused !== false ? 'play' : 'pause'));
  pb.play.classList.toggle('buffering', !!v.buffering && !v.paused);
  pb.shuffle.classList.toggle('on', !!v.shuffle);
  pb.repeat.classList.toggle('on', v.repeat && v.repeat !== 'off');
  pb.repeat.innerHTML = String(icon(v.repeat === 'one' ? 'repeat1' : 'repeat'));
  pb.repeat.title = { off: 'Répéter : désactivé', all: 'Répéter : tout', one: 'Répéter : ce titre' }[v.repeat || 'off'];
  pb.mute.innerHTML = String(icon(v.muted || !v.volume ? 'volumeMute' : 'volume'));
  pb.vol.set(v.muted ? 0 : v.volume);
  // Point vert sur « Plus d'options » quand un réglage est actif (automix, vitesse, minuteur)
  pb.more.classList.toggle('on', !!(player.sleep || player.rate !== 1 || setting('automix', false)));
  renderPip();
  document.querySelectorAll('[data-playall]').forEach((b) => {
    const same = v.context && player.context?.id && current.params.id === v.context.id;
    if (same || (current.name === 'liked' && v.context?.type === 'liked')) b.innerHTML = String(icon(v.paused ? 'play' : 'pause'));
  });
  document.querySelectorAll('[data-shuffle]').forEach((b) => b.classList.toggle('on', !!v.shuffle));
  document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', panelMode === b.dataset.panel && !$('#rightpanel').classList.contains('hidden')));
  // Toujours visible : ouvre la page du mode party (rien ne se lance sans cliquer sur « Lancer la party »)
  $('#btn-jam-top').classList.remove('hidden');
  $('#btn-jam-top').classList.toggle('live', !!sync.jam);
  $('#btn-jam-top span').textContent = 'Party';
  $('#btn-jam-top').title = sync.jam ? 'Party en cours : ouvrir' : 'Mode party : une file commune, tes invités ajoutent leurs sons';
  refreshTrackMarks();
  updateFullPlayerState();
}

function updatePlayerTime() {
  const v = sync.view();
  const d = v.duration || v.track?.duration || 0;
  const pos = Math.min(v.position || 0, d || Infinity);
  if (!pb.seek.dragging) {
    pb.cur.textContent = fmtTime(pos);
    pb.seek.set(d ? pos / d : 0);
  }
  pb.dur.textContent = fmtTime(d);
  updateFullPlayerTime(pos, d);
  if (pipWin) renderPip();
}

// ======================= PANNEAU DE DROITE =======================
let panelMode = ls.get('boombox.panel', 'np');
let panelCleanup = null;
function togglePanel(mode) {
  const rp = $('#rightpanel');
  if (!rp.classList.contains('hidden') && panelMode === mode) {
    rp.classList.add('hidden');
    ls.set('boombox.panelOpen', false);
  } else {
    panelMode = mode;
    rp.classList.remove('hidden');
    ls.set('boombox.panel', mode);
    ls.set('boombox.panelOpen', true);
  }
  renderPanel();
  updatePlayerState();
}

function renderPanel() {
  const rp = $('#rightpanel');
  panelCleanup?.();
  panelCleanup = null;
  undockVideo();
  if (rp.classList.contains('hidden')) return;
  const v = sync.view();
  const t = v.track;
  const closeBtn = html`<button class="icon-btn" data-close-panel aria-label="Fermer">${icon('close')}</button>`;

  if (panelMode === 'np') {
    const showVideo = ls.get('boombox.video', false) && player.engine?.name === 'youtube' && !v.remote;
    rp.innerHTML = String(html`<div class="rp-head"><h3 class="ellipsis">${v.context?.name || 'En cours de lecture'}</h3><div class="rp-tabs">
      <button class="icon-btn ${showVideo ? 'on' : ''}" id="np-video" title="${showVideo ? 'Afficher la pochette' : 'Afficher le clip'}">${icon('video')}</button>${closeBtn}</div></div>
      <div class="rp-body">${t ? html`
        <div class="np-art ${showVideo ? 'video' : ''}" id="np-art">${showVideo ? '' : html`<img src="${t.thumb}" alt="" referrerpolicy="no-referrer">`}</div>
        <div class="np-title"><div style="flex:1;min-width:0"><h2 class="ellipsis">${t.title}</h2><div class="muted ellipsis">${artistLinks(t)}</div></div>
          <button class="like-btn ${isLiked(t.id) ? 'on' : ''}" id="np-like">${icon(isLiked(t.id) ? 'heartFill' : 'heart')}</button></div>
        <div class="np-card"><div class="row-flex" style="justify-content:space-between"><h4 style="margin:0">Paroles</h4><button class="icon-btn" data-karaoke title="Paroles en plein écran (F)">${icon('fullscreen', 18)}</button></div><div id="np-lyrics" class="np-lyrics"></div></div>
        <div class="np-card"><div class="row-flex" style="justify-content:space-between"><h4 style="margin:0">Suivant dans la file</h4><button class="more muted" data-panel-go="queue">Ouvrir la file</button></div>
          ${(v.upcoming || []).slice(0, 1).map((u) => html`<div class="q-item" data-qjump="0">${cover(u, '', 96)}<div class="t-text"><span class="t-title">${u.title}</span><span class="t-artists muted">${artistLinks(u)}</span></div></div>`)}</div>
        <div class="np-card"><h4>À propos de l'artiste</h4>${(t.artists || []).filter((a) => a.id).slice(0, 3).map((a) => html`<a class="q-item" href="#/artist/${a.id}">${icon('person')}<b>${a.name}</b></a>`)}</div>
      ` : html`<p class="muted">Lance un titre pour le voir ici.</p>`}</div>`);
    if (t) {
      const ly = $('#np-lyrics', rp);
      ly.closest('.np-card').style.setProperty('background', 'var(--lyr,#5a3a7a)');
      dominantColor(t.thumb).then((c) => c && rp.style.setProperty('--lyr', c));
      panelCleanup = mountLyrics(ly, t);
      $('#np-like', rp).onclick = () => toggleLike(t);
      if (showVideo) dockVideo($('#np-art', rp));
    }
    $('#np-video', rp).onclick = () => {
      if (player.engine?.name !== 'youtube') return toast('Le clip n’est disponible qu’avec le lecteur YouTube (voir Paramètres)');
      ls.set('boombox.video', !ls.get('boombox.video', false));
      renderPanel();
    };
  } else if (panelMode === 'queue') {
    const up = v.upcoming || [];
    const uq = v.remote ? [] : player.userQueue;
    const ctxUp = up.slice(uq.length);
    rp.innerHTML = String(html`<div class="rp-head"><h3>File d'attente</h3>${closeBtn}</div><div class="rp-body">
      ${t ? html`<div class="q-label">En cours de lecture</div><div class="q-item current">${cover(t, '', 96)}<div class="t-text"><span class="t-title">${t.title}</span><span class="t-artists muted">${artistLinks(t)}</span></div>${mixTag(t.id)}</div>${mixPlanInfo()}` : ''}
      ${uq.length ? html`<div class="row-flex" style="justify-content:space-between"><div class="q-label">Prochains titres de la file</div><button class="more muted" id="q-clear">Effacer</button></div>
        ${uq.map((u, i) => html`<div class="q-item" data-qjump="${i}">${cover(u, '', 96)}<div class="t-text"><span class="t-title">${u.title}</span><span class="t-artists muted">${artistLinks(u)}</span></div>${mixTag(u.id)}<button class="q-x icon-btn" data-qrm="${u.qid}">${icon('close')}</button></div>`)}` : ''}
      ${ctxUp.length ? html`<div class="q-label">Ensuite${v.context?.name ? ` : ${v.context.name}` : ''}</div>
        ${ctxUp.map((u, i) => html`<div class="q-item" data-qjump="${i + uq.length}">${cover(u, '', 96)}<div class="t-text"><span class="t-title">${u.title}</span><span class="t-artists muted">${u.autoplay ? html`<span class="tag">AUTO</span>` : ''}${artistLinks(u)}</span></div>${mixTag(u.id)}</div>`)}` : ''}
      ${!t && !up.length ? html`<p class="muted">La file d'attente est vide.</p>` : ''}
      ${sync.jam ? html`<a class="outline-btn" href="#/jam" style="display:inline-block;margin-top:16px">File de la party (${sync.jam.queue.length})</a>` : ''}
    </div>`);
    $('#q-clear', rp)?.addEventListener('click', () => ctl.clearQueue());
  } else if (panelMode === 'lyrics') {
    rp.innerHTML = String(html`<div class="rp-head"><h3>Paroles</h3><div class="rp-tabs"><button class="icon-btn" data-karaoke title="Paroles en plein écran (F)">${icon('fullscreen')}</button>${closeBtn}</div></div><div class="rp-body" id="rp-lyrics"></div>`);
    if (t) panelCleanup = mountLyrics($('#rp-lyrics', rp), t);
    else $('#rp-lyrics', rp).innerHTML = '<p class="muted">Rien en cours.</p>';
  } else if (panelMode === 'friends') {
    // Activité des amis : le panneau se redessine lui-même (nouvelle activité, « il y a … »)
    panelCleanup = friendsPanel(rp, closeBtn, () => togglePanel('friends'));
    return;
  } else if (panelMode === 'devices') {
    const me = state.device;
    const devs = sync.devices.filter((d) => d.id !== me.id);
    const activeId = sync.target || me.id;
    rp.innerHTML = String(html`<div class="rp-head"><h3>Appareils</h3>${closeBtn}</div><div class="rp-body">
      <div class="q-label">Appareil actuel</div>
      <div class="device ${activeId === me.id ? 'active' : ''}" data-dev="${me.id}">${icon(me.kind === 'mobile' ? 'phone' : 'laptop')}<div><b>${me.name}</b><small>${activeId === me.id ? 'Cet appareil · lecture ici' : 'Cet appareil'}</small></div></div>
      <div class="q-label">Autres appareils connectés</div>
      ${devs.length ? devs.map((d) => html`<div class="device ${activeId === d.id ? 'active' : ''}" data-dev="${d.id}">${icon(d.kind === 'mobile' ? 'phone' : 'laptop')}<div><b>${d.name}</b><small>${activeId === d.id ? 'Contrôlé depuis ici' : d.playing ? 'En lecture' : 'Disponible'}</small></div></div>`) : html`<p class="muted">Aucun autre appareil. Ouvre Boombox sur ton téléphone avec le même profil :</p>${state.status.lan.map((u) => html`<div class="code" style="margin:4px 0;display:inline-block">${u}</div>`)}`}
      ${devs.length ? html`<p class="muted" style="font-size:12px;margin-top:16px">Clique sur un appareil : la lecture y est transférée et ce PC/téléphone devient une télécommande. Clic droit pour juste le piloter.</p>` : ''}
    </div>`);
    rp.querySelectorAll('[data-dev]').forEach((d) => {
      d.onclick = () => sync.transfer(d.dataset.dev);
      d.oncontextmenu = (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Transférer la lecture ici', icon: 'devices', action: () => sync.transfer(d.dataset.dev) },
          { label: 'Piloter sans transférer', icon: 'play', action: () => sync.control(d.dataset.dev) },
        ]);
      };
    });
  }
  rp.querySelector('[data-close-panel]')?.addEventListener('click', () => togglePanel(panelMode));
  rp.querySelector('[data-panel-go]')?.addEventListener('click', (e) => togglePanel(e.currentTarget.dataset.panelGo));
  rp.querySelector('[data-karaoke]')?.addEventListener('click', openKaraoke);
  rp.querySelectorAll('[data-qjump]').forEach((q) => (q.onclick = (e) => !e.target.closest('[data-qrm],a') && ctl.jumpTo(Number(q.dataset.qjump))));
  // File d'attente réordonnable par glisser-déposer (sur cet appareil)
  if (panelMode === 'queue' && !sync.target) {
    let dragFrom = null;
    rp.querySelectorAll('[data-qjump]').forEach((q) => {
      q.draggable = true;
      q.addEventListener('dragstart', (e) => {
        dragFrom = Number(q.dataset.qjump);
        q.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'queue');
      });
      q.addEventListener('dragend', () => {
        q.classList.remove('dragging');
        rp.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
      });
      q.addEventListener('dragover', (e) => {
        if (dragFrom == null) return;
        e.preventDefault();
        rp.querySelectorAll('.drop-before').forEach((x) => x !== q && x.classList.remove('drop-before'));
        q.classList.add('drop-before');
      });
      q.addEventListener('drop', (e) => {
        e.preventDefault();
        const to = Number(q.dataset.qjump);
        if (dragFrom != null) player.moveUpcoming(dragFrom, dragFrom < to ? to - 1 : to);
        dragFrom = null;
      });
    });
  }
  rp.querySelectorAll('[data-qrm]').forEach((b) => (b.onclick = () => ctl.removeFromQueue(b.dataset.qrm)));
}

// Le clip YouTube est un iframe fixe qu'on positionne au-dessus de l'emplacement voulu
// (déplacer un iframe dans le DOM le rechargerait).
let dockTarget = null;
function dockVideo(target) {
  dockTarget = target;
  const wrap = $('#yt-wrap');
  wrap.classList.remove('offscreen');
  wrap.classList.add('docked');
  const place = () => {
    if (dockTarget !== target || !target.isConnected) return;
    const r = target.getBoundingClientRect();
    Object.assign(wrap.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    requestAnimationFrame(place);
  };
  place();
}
function undockVideo() {
  dockTarget = null;
  const wrap = $('#yt-wrap');
  wrap.classList.add('offscreen');
  wrap.classList.remove('docked');
  wrap.removeAttribute('style');
}

// ======================= LECTEUR PLEIN ÉCRAN (MOBILE) =======================
let fpOpen = false;
let fpCleanup = null;
let fpSeek = null;
function openFullPlayer() {
  if (!sync.view().track) return;
  fpOpen = true;
  history.pushState({ fp: true }, '');
  setupFullPlayerSwipe();
  renderFullPlayer();
}

// Téléphone : on ferme le lecteur plein écran en le glissant vers le bas (comme Spotify), depuis le haut de la page
let fpSwipeReady = false;
function setupFullPlayerSwipe() {
  if (fpSwipeReady) return;
  fpSwipeReady = true;
  const fp = $('#fullplayer');
  let y0 = null;
  let x0 = 0;
  let dy = 0;
  let t0 = 0;
  fp.addEventListener('touchstart', (e) => {
    // Pas pendant un défilement de la page, ni sur la barre de progression / le volume
    if (fp.scrollTop > 0 || e.target.closest('.slider, input, .fp-seek, .fp-lyrics, [data-no-swipe]')) return (y0 = null);
    y0 = e.touches[0].clientY;
    x0 = e.touches[0].clientX;
    dy = 0;
    t0 = performance.now();
    fp.style.transition = 'none';
  }, { passive: true });
  fp.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (Math.abs(e.touches[0].clientX - x0) > Math.abs(dy) && dy < 30) return; // geste horizontal
    if (dy <= 0) return;
    // Suit le doigt (légère résistance au début), coins du haut qui s'arrondissent comme une carte qu'on rabat
    const y = dy < 40 ? dy * 0.6 : dy - 16;
    fp.style.transform = `translateY(${y}px)`;
    fp.style.borderRadius = `${Math.min(28, dy / 5)}px ${Math.min(28, dy / 5)}px 0 0`;
  }, { passive: true });
  fp.addEventListener('touchend', () => {
    if (y0 == null) return;
    const fast = dy > 60 && dy / (performance.now() - t0) > 0.6; // petit geste rapide vers le bas
    const ease = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
    if (dy > 140 || fast) {
      fp.style.transition = `transform 0.34s ${ease}, border-radius 0.34s ${ease}`;
      fp.style.transform = 'translateY(105%)';
      fp.style.borderRadius = '28px 28px 0 0';
      setTimeout(() => {
        closeFullPlayer();
        fp.style.transition = fp.style.transform = fp.style.borderRadius = '';
      }, 340);
    } else {
      fp.style.transition = `transform 0.28s ${ease}, border-radius 0.28s ${ease}`;
      fp.style.transform = '';
      fp.style.borderRadius = '';
      setTimeout(() => (fp.style.transition = ''), 300);
    }
    y0 = null;
  });
}
function closeFullPlayer(fromPop = false) {
  if (!fpOpen) return;
  fpOpen = false;
  fpCleanup?.();
  $('#fullplayer').classList.add('hidden');
  if (!fromPop && history.state?.fp) history.back();
}
window.addEventListener('popstate', () => fpOpen && closeFullPlayer(true));

function renderFullPlayer() {
  if (!fpOpen) return;
  const fp = $('#fullplayer');
  const v = sync.view();
  const t = v.track;
  if (!t) return closeFullPlayer();
  fpCleanup?.();
  fp.classList.remove('hidden');
  fp.innerHTML = String(html`
    <div class="fp-head"><button class="icon-btn" id="fp-close">${icon('chevronDown')}</button><div><small>${v.remote ? `Lecture sur ${v.deviceName}` : 'En lecture depuis'}</small><b class="ellipsis">${v.context?.name || 'Boombox'}</b></div><button class="icon-btn" id="fp-more">${icon('more')}</button></div>
    <div class="fp-art"><img src="${t.thumb}" alt="" referrerpolicy="no-referrer"></div>
    <div class="fp-meta"><div style="flex:1;min-width:0"><h2 class="ellipsis">${t.title}</h2><div class="muted ellipsis">${artistLinks(t)}</div></div>
      <button class="like-btn ${isLiked(t.id) ? 'on' : ''}" id="fp-like">${icon(isLiked(t.id) ? 'heartFill' : 'heart')}</button></div>
    <div class="slider" id="fp-seek"></div>
    <div class="progress" style="justify-content:space-between"><span id="fp-cur" style="text-align:left">0:00</span><span id="fp-dur" style="text-align:right">0:00</span></div>
    <div class="fp-controls">
      <button class="ctrl" id="fp-shuffle">${icon('shuffle')}</button>
      <button class="ctrl big" id="fp-prev">${icon('prev')}</button>
      <button class="play-btn" id="fp-play">${icon('play')}</button>
      <button class="ctrl big" id="fp-next">${icon('next')}</button>
      <button class="ctrl" id="fp-repeat">${icon('repeat')}</button>
    </div>
    <div class="fp-extra"><button class="ctrl" id="fp-devices">${icon('devices')}</button><button class="ctrl" id="fp-sleep">${icon('moon')}</button><button class="ctrl" id="fp-queue">${icon('queue')}</button></div>
    <div class="fp-lyrics"><div class="row-flex" style="justify-content:space-between;margin:0 0 12px"><h4 style="margin:0">Paroles</h4><div class="row-flex"><button class="icon-btn" id="fp-car" title="Mode voiture">${icon('car', 20)}</button><button class="icon-btn" id="fp-kara" title="Paroles en plein écran">${icon('fullscreen', 20)}</button></div></div><div id="fp-lyr"></div></div>`);
  $('#fp-close').onclick = () => closeFullPlayer();
  $('#fp-like').onclick = () => toggleLike(t);
  $('#fp-play').onclick = () => ctl.toggle();
  $('#fp-prev').onclick = () => ctl.prev();
  $('#fp-next').onclick = () => ctl.next();
  $('#fp-shuffle').onclick = () => ctl.toggleShuffle();
  $('#fp-repeat').onclick = () => ctl.cycleRepeat();
  $('#fp-devices').onclick = () => (closeFullPlayer(), togglePanel('devices'));
  $('#fp-queue').onclick = () => (closeFullPlayer(), togglePanel('queue'));
  $('#fp-sleep').onclick = (e) => contextMenu(e.clientX - 120, e.clientY - 260, sleepItems());
  $('#fp-more').onclick = (e) => import('./components.js').then((c) => c.trackMenu(t, e.clientX - 220, e.clientY));
  fpSeek = slider($('#fp-seek'), { onCommit: (f) => ctl.seek(f * (sync.view().duration || 0)) });
  swipe(fp.querySelector('.fp-art'), { left: () => ctl.next(), right: () => ctl.prev() });
  swipe(fp.querySelector('.fp-head'), { down: () => closeFullPlayer() });
  swipe(fp.querySelector('.fp-art'), { down: () => closeFullPlayer() });
  dominantColor(t.thumb).then((c) => c && (fp.style.setProperty('--fp', c), fp.style.setProperty('--lyr', c)));
  fpCleanup = mountLyrics($('#fp-lyr'), t);
  $('#fp-kara')?.addEventListener('click', openKaraoke);
  $('#fp-car')?.addEventListener('click', openCarMode);
  updateFullPlayerState();
}
function updateFullPlayerState() {
  if (!fpOpen) return;
  const v = sync.view();
  const p = $('#fp-play');
  if (!p) return;
  p.innerHTML = String(icon(v.paused ? 'play' : 'pause'));
  $('#fp-shuffle').classList.toggle('on', !!v.shuffle);
  $('#fp-repeat').classList.toggle('on', v.repeat !== 'off');
  $('#fp-repeat').innerHTML = String(icon(v.repeat === 'one' ? 'repeat1' : 'repeat'));
  const like = $('#fp-like');
  if (like && v.track) {
    like.classList.toggle('on', isLiked(v.track.id));
    like.innerHTML = String(icon(isLiked(v.track.id) ? 'heartFill' : 'heart'));
  }
}
function updateFullPlayerTime(pos, d) {
  if (!fpOpen || !fpSeek) return;
  fpSeek.set(d ? pos / d : 0);
  $('#fp-cur').textContent = fmtTime(pos);
  $('#fp-dur').textContent = fmtTime(d);
}

function setupPanelResize() {
  const rp = $('#rightpanel');
  const setW = (w) => document.documentElement.style.setProperty('--right-w', Math.min(620, Math.max(300, w)) + 'px');
  const saved = ls.get('boombox.panelW', 360);
  setW(saved);
  const handle = document.createElement('div');
  handle.className = 'rp-resize';
  handle.title = 'Glisser pour redimensionner';
  document.getElementById('app').appendChild(handle);
  const place = () => {
    const r = rp.getBoundingClientRect();
    handle.style.display = rp.classList.contains('hidden') || innerWidth <= 900 ? 'none' : 'block';
    handle.style.left = r.left - 6 + 'px';
    handle.style.top = r.top + 'px';
    handle.style.height = r.height + 'px';
  };
  new ResizeObserver(place).observe(rp);
  new MutationObserver(place).observe(rp, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', place);
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('drag');
    const move = (ev) => setW(innerWidth - ev.clientX - 8);
    const up = () => {
      handle.classList.remove('drag');
      handle.removeEventListener('pointermove', move);
      ls.set('boombox.panelW', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-w')));
      place();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
  });
  place();
}

// Tempo / tonalité d'un titre analysé par l'automix (affiché dans la file d'attente)
function mixTag(id) {
  if (!player._automixOn()) return '';
  const a = automix.get(id);
  return a ? html`<span class="mix-tag" title="Tempo · tonalité (${a.key})">${Math.round(a.bpm)} BPM · ${a.camelot}</span>` : html`<span class="mix-tag pending" title="Analyse en cours">…</span>`;
}
function mixPlanInfo() {
  const p = player._automixOn() && player._mixPlan;
  if (!p) return player._automixOn() ? html`<div class="mix-plan muted">Automix : analyse en cours…</div>` : '';
  const pct = Math.round((p.rate - 1) * 100);
  return html`<div class="mix-plan">${icon('automix', 16)} Prochain mix à ${fmtTime(p.mixStart)} · ${Math.round(p.mixLen)} s${p.rate !== 1 ? `, tempo calé (${pct > 0 ? '+' : ''}${pct} %)` : ''}, transition « ${TRANSITION_NAMES[p.style] || p.style} »${player._styleFor(player.track?.id, p.id) === 'auto' ? ' (choisie automatiquement)' : ''}${setting('mixSmart', false) && player.shuffle ? ' · mix intelligent' : ''}${p.bassSwap ? ', échange des basses' : ''}</div>`;
}

// Sous-menus de la barre de lecture
const speedItems = () => [0.75, 1, 1.25, 1.5, 2].map((v) => ({ label: `×${String(v).replace('.', ',')}${v === 1 ? ' (normal)' : ''}`, icon: player.rate === v ? 'check' : null, action: () => player.setRate(v) }));
const sleepItems = () => [
  ...[5, 15, 30, 45, 60].map((m) => ({ label: `${m} minutes`, action: () => player.setSleep(m) })),
  { label: 'Fin du titre', action: () => player.setSleep('track') },
  player.sleep && { sep: true },
  player.sleep && { label: 'Désactiver le minuteur', icon: 'close', action: () => player.setSleep(null) },
];

// Astuce « glisse pour déplacer » : affichée tant qu'on ne l'a pas fait, et seulement en ordre perso
function updateLibHint() {
  const hint = $('#lib-hint');
  if (!hint) return;
  const custom = ls.get('boombox.libSort', 'custom') === 'custom';
  hint.textContent = custom ? 'Astuce : glisse une playlist par sa poignée ⋮⋮ pour la déplacer (ou clic droit → Déplacer).' : 'Choisis « Ordre perso » pour déplacer tes playlists.';
  hint.classList.toggle('hidden', custom && ls.get('boombox.libHintSeen', false));
}

// ======================= BARRE DE GAUCHE REDIMENSIONNABLE (comme Spotify) =======================
// Réduite (< 160 px) : seulement les pochettes ; agrandie (≥ 520 px) : grille de grandes pochettes.
const WIDE = 520;
function setupSideResize() {
  const app = $('#app');
  const side = $('#sidebar');
  const apply = (w) => {
    w = Math.round(Math.min(640, Math.max(72, w)));
    const collapsed = w < 160;
    const width = collapsed ? 84 : w;
    document.documentElement.style.setProperty('--side-w', width + 'px');
    app.classList.toggle('side-collapsed', collapsed);
    app.classList.toggle('side-wide', !collapsed && width >= WIDE);
    $('#lib-expand').title = width >= WIDE ? 'Réduire la bibliothèque' : 'Agrandir la bibliothèque';
    return width;
  };
  // Par défaut : une bibliothèque large (liste confortable) qui laisse la place au panneau de droite
  const DEFAULT = Math.round(Math.min(440, Math.max(300, innerWidth * 0.23)));
  let current = apply(ls.get('boombox.sideW', DEFAULT));
  const save = () => ls.set('boombox.sideW', current);
  const handle = document.createElement('div');
  handle.className = 'side-resize';
  handle.title = 'Glisser pour redimensionner la bibliothèque';
  app.appendChild(handle);
  const place = () => {
    const r = side.getBoundingClientRect();
    handle.style.display = innerWidth <= 768 ? 'none' : 'block';
    handle.style.left = r.right - 1 + 'px';
    handle.style.top = r.top + 'px';
    handle.style.height = r.height + 'px';
  };
  new ResizeObserver(place).observe(side);
  window.addEventListener('resize', place);
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('drag');
    const move = (ev) => (current = apply(ev.clientX - side.getBoundingClientRect().left));
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', () => {
      handle.classList.remove('drag');
      handle.removeEventListener('pointermove', move);
      save();
      place();
    }, { once: true });
  });
  // Clic sur « Bibliothèque » : réduire / déplier ; flèche : agrandir / revenir à la taille normale
  $('#lib-collapse').onclick = () => {
    current = apply(current < 160 ? ls.get('boombox.sideWOpen', DEFAULT) : (ls.set('boombox.sideWOpen', current), 72));
    save();
  };
  $('#lib-expand').onclick = () => {
    current = apply(current >= WIDE ? DEFAULT : 600);
    save();
  };
  place();
}

// Poignée entre le menu du haut et la bibliothèque : on la monte pour voir plus de playlists.
// Le menu passe par 4 crans (normal → compact sans logo → une rangée d'icônes → rangé, ses boutons
// passent alors dans la barre du haut), mémorisé. Par défaut : rangé, les playlists montent tout en haut.
function setupNavSplit() {
  const app = $('#app');
  const nav = $('.nav-main');
  const LEVELS = ['', 'nav-compact', 'nav-mini', 'nav-hidden'];
  nav.querySelectorAll('.nav-link:not(.brand-link)').forEach((a) => (a.title = [...a.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()));
  // (navLevel2 : la disposition par défaut a changé, l'ancien réglage n'est pas repris)
  let level = ls.get('boombox.navLevel2', 3);
  const apply = (l) => {
    level = Math.max(0, Math.min(3, l));
    LEVELS.forEach((c, i) => c && app.classList.toggle(c, i === level));
  };
  apply(level);
  const split = document.createElement('div');
  split.className = 'nav-split';
  split.title = 'Glisser vers le haut pour agrandir la bibliothèque (double-clic : menu rangé / normal)';
  nav.after(split);
  // Hauteur du menu à chaque cran, mesurée au début du glissement (dépend de la largeur de la barre)
  const heights = () => LEVELS.map((_, i) => {
    apply(i);
    return nav.offsetHeight;
  });
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    split.classList.add('drag');
    const start = level;
    const hs = heights();
    apply(start);
    const top = nav.getBoundingClientRect().top;
    const move = (ev) => {
      const want = ev.clientY - top;
      let best = 0;
      hs.forEach((h, i) => Math.abs(h - want) < Math.abs(hs[best] - want) && (best = i));
      if (best !== level) apply(best);
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', () => {
      split.classList.remove('drag');
      split.removeEventListener('pointermove', move);
      ls.set('boombox.navLevel2', level);
    }, { once: true });
  });
  split.addEventListener('dblclick', () => {
    apply(level ? 0 : 3);
    ls.set('boombox.navLevel2', level);
  });
}

// ======================= GESTES TACTILES =======================
let lastSwipe = 0;
function swipe(el, { left, right, down }) {
  if (!el) return;
  let x0 = null;
  let y0 = 0;
  let t0 = 0;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    x0 = t.clientX;
    y0 = t.clientY;
    t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    x0 = null;
    if (Date.now() - t0 > 700) return;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      lastSwipe = Date.now();
      (dx < 0 ? left : right)?.();
    } else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5 && down) {
      lastSwipe = Date.now();
      down();
    }
  }, { passive: true });
}

// ======================= COULEUR D'ACCENT =======================
// Mauve par défaut (charte Boombox) ; « auto » : la couleur suit la pochette du son en cours
function setAccentColor(c) {
  const h = c.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const root = document.documentElement.style;
  root.setProperty('--accent', c);
  root.setProperty('--accent-2', c);
  root.setProperty('--accent-rgb', rgb.join(', '));
}
// Couleur de pochette rendue lisible : assez claire et assez vive pour du texte noir dessus
function vivid(color) {
  const m = String(color).match(/\d+/g);
  if (!m) return null;
  let [r, g, b] = m.slice(0, 3).map((x) => +x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l0 = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  if (s < 0.15) return ACCENTS.Mauve; // pochette en noir et blanc : on garde le mauve
  s = Math.max(0.55, s);
  const l = Math.min(0.72, Math.max(0.6, l0));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(h + 1 / 3)}${f(h)}${f(h - 1 / 3)}`;
}
function applyAccent() {
  let c = state.library.settings?.accent || ACCENTS.Mauve;
  if (c === '#1ed760' || c === ACCENTS.Vert) c = state.library.settings?.accentChosen ? c : ACCENTS.Mauve; // ancien vert par défaut → mauve
  if (c === 'auto') {
    const t = sync.view().track;
    if (!t?.thumb) return setAccentColor(ACCENTS.Mauve);
    return dominantColor(t.thumb).then((dc) => setAccentColor((dc && vivid(dc)) || ACCENTS.Mauve)).catch(() => setAccentColor(ACCENTS.Mauve));
  }
  setAccentColor(c);
}

// ======================= MINI-LECTEUR FLOTTANT (PC) =======================
// Fenêtre « Picture-in-Picture » toujours au premier plan (Chrome / Edge).
let pipWin = null;
async function togglePip() {
  if (pipWin) return pipWin.close();
  if (!('documentPictureInPicture' in window)) return toast('Mini-lecteur disponible dans Chrome ou Edge');
  pipWin = await documentPictureInPicture.requestWindow({ width: 380, height: 150 });
  for (const ss of document.styleSheets) {
    try {
      const st = pipWin.document.createElement('style');
      st.textContent = [...ss.cssRules].map((r) => r.cssText).join('\n');
      pipWin.document.head.appendChild(st);
    } catch {
      const l = pipWin.document.createElement('link');
      l.rel = 'stylesheet';
      l.href = ss.href;
      pipWin.document.head.appendChild(l);
    }
  }
  pipWin.document.documentElement.style.cssText = document.documentElement.style.cssText;
  pipWin.document.body.className = 'pip-body';
  pipWin.document.addEventListener('keydown', (e) => handleKey(e, true)); // raccourcis aussi dans le mini-lecteur
  pipWin.addEventListener('pagehide', () => {
    pipWin = null;

  });

  renderPip(true);
}
let pipTrackId = null;
function renderPip(force = false) {
  if (!pipWin) return;
  const d = pipWin.document;
  const v = sync.view();
  const t = v.track;
  if (force || t?.id !== pipTrackId) {
    pipTrackId = t?.id;
    d.body.innerHTML = String(html`<div class="pip-player">
      ${t ? cover(t, '', 160) : ''}
      <div class="pip-info"><b class="ellipsis">${t?.title || 'Rien en cours'}</b><span class="ellipsis muted">${t ? (t.artists || []).map((a) => a.name).join(', ') : ''}</span>
        <div class="pip-ctrl"><button class="ctrl" data-pip="shuffle" title="Aléatoire">${icon('shuffle')}</button><button class="ctrl" data-pip="prev">${icon('prev')}</button><button class="play-btn" data-pip="toggle">${icon('play')}</button><button class="ctrl" data-pip="next">${icon('next')}</button>
        <button class="like-btn" data-pip="like" title="Liker">${icon('heart')}</button><button class="ctrl" data-pip="add" title="Ajouter à une playlist">${icon('plus')}</button></div>
        <div class="pip-menu hidden"></div>
        <div class="pip-bar"><div></div></div></div></div>`);
    d.querySelectorAll('[data-pip]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.pip;
      if (a === 'like') return t && toggleLike(t);
      if (a === 'shuffle') return ctl.toggleShuffle();
      if (a === 'add') return t && pipAddMenu(d, t);
      ctl[a]();
    }));
  }
  d.querySelector('[data-pip=shuffle]')?.classList.toggle('on', !!v.shuffle);
  const play = d.querySelector('[data-pip=toggle]');
  if (play) play.innerHTML = String(icon(v.paused !== false ? 'play' : 'pause'));
  const like = d.querySelector('[data-pip=like]');
  if (like && t) {
    like.classList.toggle('on', isLiked(t.id));
    like.innerHTML = String(icon(isLiked(t.id) ? 'heartFill' : 'heart'));
  }
  const dur = v.duration || t?.duration || 0;
  const bar = d.querySelector('.pip-bar div');
  if (bar) bar.style.width = (dur ? Math.min(100, ((v.position || 0) / dur) * 100) : 0) + '%';
}

// Liste des playlists dans la fenêtre du mini-lecteur (les menus de l'appli n'y sont pas affichables)
function pipAddMenu(d, t) {
  const m = d.querySelector('.pip-menu');
  if (!m.classList.contains('hidden')) return m.classList.add('hidden');
  const inPl = (p) => p.tracks.some((x) => x.id === t.id);
  m.innerHTML = state.library.playlists.length
    ? state.library.playlists.map((p) => String(html`<button data-pl="${p.id}" class="${inPl(p) ? 'in' : ''}">${inPl(p) ? '✓ ' : ''}${p.name}</button>`)).join('')
    : '<span class="muted" style="padding:8px">Aucune playlist</span>';
  m.classList.remove('hidden');
  m.querySelectorAll('[data-pl]').forEach((b) => (b.onclick = async () => {
    const p = state.library.playlists.find((x) => x.id === b.dataset.pl);
    if (!p) return;
    if (inPl(p)) await removeFromPlaylist(p.id, t);
    else await addToPlaylist(p.id, [t]);
    setTimeout(() => (m.classList.add('hidden'), pipAddMenu(d, t)), 400); // la liste se met à jour, elle reste ouverte
  }));
}

// ======================= RACCOURCIS CLAVIER =======================
// Mêmes raccourcis dans l'appli et dans le mini-lecteur flottant. Alt + flèches : pratiques même quand on
// tape ailleurs dans la page (sauf dans un champ de texte).
export const SHORTCUTS = [
  ['Espace  ou  Alt + ↓', 'Lecture / pause'],
  ['Alt + →', 'Son suivant'],
  ['Alt + ←', 'Son précédent (ou retour au début)'],
  ['→  /  ←', 'Avancer / reculer de 5 s (Maj : 15 s)'],
  ['Ctrl + ↑  /  Ctrl + ↓', 'Volume plus fort / moins fort'],
  ['M', 'Couper / remettre le son'],
  ['L', 'Liker le son en cours'],
  ['S', 'Lecture aléatoire'],
  ['R', 'Répéter (tout / ce titre / non)'],
  ['F', 'Paroles en plein écran'],
  ['V', 'Mode voiture'],
  ['Q', "File d'attente"],
  ['Ctrl + K  ou  /', 'Rechercher'],
  ['?', 'Afficher cette aide'],
];
function handleKey(e, inPip = false) {
  if (e.target.closest?.('input,textarea,select,[contenteditable]')) return;
  const v = sync.view();
  const k = e.key;
  const low = k.length === 1 ? k.toLowerCase() : k;
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  const act = (fn) => (e.preventDefault(), fn());
  if (e.code === 'Space' && plain) return act(() => ctl.toggle());
  if (k === 'ArrowDown' && e.altKey) return act(() => ctl.toggle());
  if (k === 'ArrowRight' && (e.altKey || e.ctrlKey)) return act(() => ctl.next());
  if (k === 'ArrowLeft' && (e.altKey || e.ctrlKey)) return act(() => ctl.prev());
  if (k === 'ArrowRight' && !e.ctrlKey && !e.altKey) return act(() => ctl.seek((v.position || 0) + (e.shiftKey ? 15 : 5)));
  if (k === 'ArrowLeft' && !e.ctrlKey && !e.altKey) return act(() => ctl.seek(Math.max(0, (v.position || 0) - (e.shiftKey ? 15 : 5))));
  if (k === 'ArrowUp' && (e.ctrlKey || e.altKey)) return act(() => ctl.setVolume((v.volume || 0) + 0.1));
  if (k === 'ArrowDown' && e.ctrlKey) return act(() => ctl.setVolume((v.volume || 0) - 0.1));
  if (!plain) {
    if (low === 'k' && e.ctrlKey && !inPip) return act(() => $('#search-input').focus());
    return;
  }
  if (low === 'm') return act(() => ctl.toggleMute());
  if (low === 'l' && v.track) return act(() => toggleLike(v.track));
  if (low === 's') return act(() => ctl.toggleShuffle());
  if (low === 'r') return act(() => ctl.cycleRepeat());
  if (low === 'f') return act(() => openKaraoke());
  if (low === 'v' && !inPip) return act(() => openCarMode());
  if (low === 'q' && !inPip) return act(() => togglePanel('queue'));
  if (k === '/' && !inPip) return act(() => $('#search-input').focus());
  if (k === '?' && !inPip) return act(() => showShortcuts());
}
export function showShortcuts() {
  modal({
    title: 'Raccourcis clavier',
    body: String(html`<div class="keys-help">${SHORTCUTS.map(([keys, what]) => html`<div><span>${what}</span><kbd>${keys}</kbd></div>`)}</div><p class="muted" style="font-size:12px;margin-top:12px">Ils marchent aussi dans le mini-lecteur flottant.</p>`),
    actions: [{ label: 'OK', primary: true }],
  });
}
function setupKeys() {
  document.addEventListener('keydown', (e) => handleKey(e));
}

// ======================= ALERTES NOUVELLES SORTIES =======================
// Comme Spotify : une notification discrète quand un artiste suivi sort quelque chose. Jamais plus d'une toutes
// les 6 heures (les sorties sont regroupées), et chaque sortie n'est annoncée qu'une fois.
function notifyReleases(list = []) {
  if (!setting('releaseAlerts', true) || !('Notification' in window) || Notification.permission !== 'granted') return;
  const seen = new Set(ls.get('boombox.notified', []));
  const fresh = list.filter((r) => r.isNew && !seen.has(r.id));
  if (!fresh.length || Date.now() - ls.get('boombox.notifiedAt', 0) < 6 * 3600e3) return;
  const artists = [...new Set(fresh.map((r) => r.artist?.name).filter(Boolean))];
  const first = fresh[0];
  const n = new Notification(fresh.length === 1 ? `Nouveau : ${first.title}` : `${fresh.length} nouvelles sorties`, {
    body: fresh.length === 1 ? `${first.artist?.name || ''} · ${first.kind || 'Sortie'}` : `${artists.slice(0, 3).join(', ')}${artists.length > 3 ? '…' : ''}`,
    icon: first.thumb || '/assets/logo-symbol.png',
    tag: 'boombox-releases',
  });
  n.onclick = () => (window.focus(), (location.hash = '#/releases'), n.close());
  ls.set('boombox.notified', [...seen, ...fresh.map((r) => r.id)].slice(-2000));
  ls.set('boombox.notifiedAt', Date.now());
}

// ======================= DÉMARRAGE =======================
async function boot() {
  // Appli mobile : mise à jour de l'interface déjà téléchargée → on l'applique avant tout (rechargement instantané)
  if (isNative) {
    await webUpdateBoot();
    if (webUpdateReady() && (await applyWebUpdate())) return;
    // Recherche de mise à jour dès le lancement (en fond) : même si le démarrage échoue, le correctif
    // téléchargé s'appliquera à l'ouverture suivante
    checkWebUpdate({
      onReady: (v, why) => {
        if (why === 'native') return toast('Une nouvelle version de l’appli est disponible : réinstalle-la (SideStore / iloader)', { timeout: 8000 });
        if (v) toast('Mise à jour de Boombox prête', { action: 'Installer', timeout: 15000, onAction: () => applyWebUpdate() });
      },
    }).catch(() => {});
  }
  // Démarrage trop long (réseau, Firebase…) : on le dit à l'écran au lieu de rester sur le logo
  const slow = setTimeout(() => {
    const s = $('#splash');
    if (s && !s.querySelector('.splash-msg')) s.insertAdjacentHTML('beforeend', '<p class="splash-msg">Connexion en cours… Vérifie ta connexion Internet. Si ça dure, ferme et rouvre Boombox.</p>');
  }, 15000);
  state.status = await api('/api/status').catch(() => state.status);
  await cloud.signIn();
  clearTimeout(slow);
  if (isNative) await handleLaunchLink();
  await ensureSpace();
  hideSplash();
  const profile = await pickProfile();
  setProfile(profile);
  renderAvatar();
  await subscribeLibrary();
  $('#app').classList.remove('hidden');
  on('profile', renderAvatar);
  applyAccent();
  on('settings', () => applyAccent()); // couleur changée dans les paramètres (ou sur un autre appareil)
  on('player:track', () => setting('accent', '') === 'auto' && applyAccent()); // mode auto : suit la pochette
  on('settings', applyAccent);

  setupDelegation();
  setupSearch();
  setupSidebar();
  refreshPublicProfile();
  // PC : les titres likés sont pré-téléchargés en arrière-plan (lecture instantanée, moins de requêtes à YouTube)
  if (!isNative && setting('predownload', true)) setTimeout(() => api('/api/predownload', { method: 'POST', body: { ids: state.library.liked.map((t) => t.id) } }).catch(() => {}), 60e3);
  startPlaylistSync(); // playlists importées liées à leur source (Spotify…) : nouveaux titres ajoutés tout seuls
  // En décembre, comme Spotify : on annonce une fois que le Wrapped de l'année est prêt
  {
    const y = new Date().getFullYear();
    if (new Date().getMonth() === 11 && !ls.get(`boombox.wrappedSeen.${y}`, false)) {
      setTimeout(() => toast(`✨ Ton Wrapped ${y} est prêt !`, { action: 'Voir', timeout: 12000, onAction: () => ((location.hash = `#/wrapped?year=${y}`), ls.set(`boombox.wrappedSeen.${y}`, true)) }), 4000);
    }
  }
  setupPlayerBar();
  setupKeys();
  player.init();
  if (isNative) {
    offline.init();
    document.addEventListener('offline-progress', () => refreshTrackMarks(true));
    checkExpiry();
    window.Capacitor.Plugins.App?.addListener('appUrlOpen', (e) => {
      if (parseInvite(e.url) && confirm('Lier cet appareil à la bibliothèque de ce lien ?')) {
        location.hash = '#/join?' + e.url.split('?')[1];
        location.reload();
      }
    });
  }
  if (setting('automix', false)) player.setAutomix(true);
  // Réglages changés (paramètres, menu ⋯ ou autre appareil) : le point du bouton ⋯, la case des paramètres
  // et le lecteur restent d'accord
  let automixWas = setting('automix', false);
  const syncAutomixUi = () => {
    const on = !!setting('automix', false);
    const cb = $('#s-automix');
    if (cb) cb.checked = on;
    $('#pl-mix')?.classList.toggle('on', on);
    if (on !== automixWas) {
      automixWas = on;
      if (!on || player.engine?.name === 'audio') player.setAutomix(on);
    }
    updatePlayerState();
  };
  on('settings', syncAutomixUi);
  on('library', syncAutomixUi);
  // Analyses reçues / plan d'automix : on rafraîchit l'affichage BPM / tonalité
  on('player:automix', () => panelMode === 'queue' && !$('#rightpanel').classList.contains('hidden') && renderPanel());
  sync.connect();
  // Appli mobile : lecture par le PC quand il est sur le même Wi-Fi (sinon récupération directe)
  if (isNative) startRelay().catch(() => {});
  // PC : le serveur s'annonce lui-même à la bibliothèque (adresse locale + tunnel Internet), même page fermée
  else if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    getDoc(cloud.ref('private', 'secret'))
      .then((s) => s.exists() && api('/api/relay/config', { method: 'POST', body: { projectId: firebaseConfig.projectId, apiKey: firebaseConfig.apiKey, spaceId: cloud.spaceId, secret: s.data().value } }))
      .catch(() => {});
  }
  // Amis : fiche publique, activité d'écoute (si partagée) et messages
  const friendsBadge = () => {
    const b = $('#friends-badge');
    b.textContent = social.unread;
    b.classList.toggle('hidden', !social.unread);
  };
  on('social', friendsBadge);
  social.start().catch((e) => console.warn('Amis :', e.message));

  on('library', () => {
    renderSidebarList();
    current.hooks?.onLibrary?.();
    updatePlayerTrack();
    refreshTrackMarks();
    if (panelMode === 'np') renderPanel();
    updateFullPlayerState();
  });
  on('player:track', () => {
    updatePlayerTrack();
    updatePlayerState();
    updatePlayerTime();
    renderSidebarList();
    renderPanel();
    current.hooks?.onTrack?.();
    if (fpOpen) renderFullPlayer();
  });
  on('player:state', updatePlayerState);
  on('player:time', updatePlayerTime);
  on('player:queue', () => panelMode === 'queue' && renderPanel());
  on('sync', () => {
    if (panelMode === 'devices') renderPanel();
    updatePlayerTrack();
    updatePlayerState();
  });
  on('jam', () => {
    current.hooks?.onJam?.();
    updatePlayerState();
  });
  on('releases', (n) => {
    for (const b of [$('#releases-badge'), $('#releases-badge-top')]) {
      b.textContent = n;
      b.classList.toggle('hidden', !n);
    }
  });
  setInterval(() => sync.target && updatePlayerTime(), 500);

  // Panneau de droite redimensionnable (poignée sur le bord gauche), largeur mémorisée
  setupPanelResize();
  // Le panneau de droite retrouve son état d'avant (ouvert/fermé, onglet, largeur) ; il n'est replié
  // d'office qu'en mode superposé (écran étroit), sans oublier qu'il était ouvert
  // Assez de place si la page du milieu garde au moins 560 px à côté de la bibliothèque et du panneau
  const cssPx = (v) => parseInt(getComputedStyle(document.documentElement).getPropertyValue(v)) || 0;
  const roomForPanel = () => innerWidth > 900 && innerWidth - cssPx('--side-w') - cssPx('--right-w') - 32 >= 560;
  if (ls.get('boombox.panelOpen', true) && roomForPanel()) $('#rightpanel').classList.remove('hidden');
  let wasWide = roomForPanel();
  window.addEventListener('resize', debounce(() => {
    const wide = roomForPanel();
    const rp = $('#rightpanel');
    if (wide !== wasWide && (wide ? ls.get('boombox.panelOpen', true) && rp.classList.contains('hidden') : !rp.classList.contains('hidden'))) {
      rp.classList.toggle('hidden', !wide);
      renderPanel();
      updatePlayerState();
    }
    wasWide = wide;
  }, 200));
  // En mode superposé (écran étroit), un clic à côté du panneau le ferme
  document.addEventListener('mousedown', (e) => {
    const rp = $('#rightpanel');
    if (innerWidth > 900 || rp.classList.contains('hidden') || rp.contains(e.target) || e.target.closest('[data-panel],.ctx,.modal-backdrop,#fullplayer')) return;
    rp.classList.add('hidden');
    renderPanel();
    updatePlayerState();
  });
  updatePlayerTrack();
  updatePlayerState();
  updatePlayerTime();
  renderPanel();
  await route();

  setTimeout(showWhatsNew, 1500);
  // Appli mobile : l'interface a bien démarré ; on cherche une version plus récente en ligne (sans réinstaller l'appli)
  if (isNative) {
    webUpdateConfirm();
    setTimeout(() => checkWebUpdate({
      onReady: (v, why) => {
        if (why === 'native') return toast('Nouvelle version de l’appli disponible : mets-la à jour dans SideStore', { timeout: 8000 });
        if (player.paused) return applyWebUpdate();
        toast(`Mise à jour de Boombox prête (${v})`, { action: 'Installer', timeout: 10000, onAction: () => applyWebUpdate() });
      },
    }), 8000);
  }

  // Badge des nouveautés (en arrière-plan)
  if (state.library.follows.length) {
    const checkReleases = () => V.fetchReleases().then((r) => (emit('releases', r.newCount), notifyReleases(r.releases))).catch(() => {});
    checkReleases();
    setInterval(checkReleases, 6 * 3600e3); // appli laissée ouverte : nouvelle vérification toutes les 6 h
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ======================= APPLI MOBILE =======================
// Ouverture par un lien boombox://join?s=…&k=… (QR code scanné depuis le PC)
// Ordinateur : les rangées de cartes (suggestions, artistes…) défilent avec des flèches ‹ › et en glissant à la souris
function enhanceRows(root = document) {
  if (!matchMedia('(pointer: fine)').matches) return;
  root.querySelectorAll('.cards.row:not([data-hs])').forEach((row) => {
    row.dataset.hs = '1';
    const wrap = document.createElement('div');
    wrap.className = 'hs-wrap';
    row.parentNode.insertBefore(wrap, row);
    wrap.appendChild(row);
    const mk = (dir) => {
      const b = document.createElement('button');
      b.className = `hs-arrow ${dir < 0 ? 'left' : 'right'}`;
      b.type = 'button';
      b.setAttribute('aria-label', dir < 0 ? 'Précédent' : 'Suivant');
      b.innerHTML = String(icon(dir < 0 ? 'back' : 'forward', 22));
      b.onclick = () => row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: 'smooth' });
      wrap.appendChild(b);
      return b;
    };
    const left = mk(-1);
    const right = mk(1);
    const update = () => {
      left.classList.toggle('show', row.scrollLeft > 4);
      right.classList.toggle('show', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    };
    row.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(row);
    update();
    // Glisser à la souris (un vrai glisser ne déclenche pas le clic sur la carte)
    let x0 = null;
    let s0 = 0;
    let moved = false;
    row.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      x0 = e.clientX;
      s0 = row.scrollLeft;
      moved = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 6) {
        moved = true;
        row.classList.add('hs-dragging');
      }
      if (moved) row.scrollLeft = s0 - dx;
    });
    window.addEventListener('pointerup', () => {
      x0 = null;
      row.classList.remove('hs-dragging');
    });
    row.addEventListener('click', (e) => moved && (e.stopPropagation(), e.preventDefault(), (moved = false)), true);
  });
}
new MutationObserver(() => enhanceRows($('#view'))).observe(document.getElementById('view'), { childList: true, subtree: true });

// Premier lancement après une mise à jour : récapitulatif des nouveautés (rien à la toute première installation)
async function showWhatsNew() {
  try {
    const cur = (await fetch('version.json', { cache: 'no-store' }).then((r) => r.json()))?.version;
    if (!cur) return;
    const seen = ls.get('boombox.seenVersion', null);
    ls.set('boombox.seenVersion', cur);
    if (!seen || seen === cur) return;
    const newer = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }) > 0;
    const notes = await fetch('changelog.json', { cache: 'no-store' }).then((r) => r.json());
    const fresh = notes.filter((n) => n.version !== 'next' && newer(n.version, seen) && !newer(n.version, cur));
    if (!fresh.length) return;
    await modal({
      title: '✨ Quoi de neuf dans Boombox',
      body: String(html`${fresh.map((n) => html`<div class="wn-block">${fresh.length > 1 ? html`<h4>${n.title || 'Mise à jour'} <span class="muted">· ${n.date || ''}</span></h4>` : ''}<ul class="wn-list">${n.items.map((i) => html`<li>${i}</li>`)}</ul></div>`)}`),
      actions: [{ label: 'Super !', primary: true, value: () => 'ok' }],
    });
  } catch {}
}

async function handleLaunchLink() {
  try {
    const l = await window.Capacitor.Plugins.App?.getLaunchUrl?.();
    if (l?.url && parseInvite(l.url)) history.replaceState(null, '', '#/join?' + l.url.split('?')[1]);
  } catch {}
}

// SideStore : l'appli doit être renouvelée tous les 7 jours. Alerte 2 jours avant l'expiration.
async function checkExpiry() {
  const info = await nativeInfo();
  if (!info?.expiration) return;
  const days = Math.floor((Date.parse(info.expiration) - Date.now()) / 86400e3);
  if (days > 2) return;
  const b = document.createElement('div');
  b.className = 'expiry-banner';
  b.innerHTML = `<span>${days <= 0 ? 'Boombox expire aujourd’hui' : `Boombox expire dans ${days} jour${days > 1 ? 's' : ''}`}</span><button>Renouveler</button><button aria-label="Fermer" style="background:none;color:#000;padding:0 4px">✕</button>`;
  b.querySelector('button').onclick = () => (location.href = 'sidestore://');
  b.querySelectorAll('button')[1].onclick = () => b.remove();
  document.body.appendChild(b);
}

// ======================= ESPACE (lien entre appareils) =======================
// Un « espace » regroupe tous tes appareils : ils partagent profils, playlists et likes.
async function ensureSpace() {
  const invite = parseInvite(location.hash);
  if (invite) {
    history.replaceState(null, '', '#/');
    if (invite.sid !== cloud.spaceId) {
      if (cloud.spaceId && (await cloud.checkSpace())) {
        const ok = await modal({ title: 'Lier cet appareil ?', body: '<p class="muted">Cet appareil utilise déjà une autre bibliothèque. Le lier affichera celle de l’appareil qui t’a invité.</p>', actions: [{ label: 'Annuler' }, { label: 'Lier', primary: true, value: () => 'ok' }] });
        if (ok !== 'ok') return;
      }
      await cloud.joinSpace(invite.sid, invite.secret, state.device.name);
      toast('Appareil lié : ta bibliothèque est synchronisée');
      return;
    }
  }
  if (await cloud.checkSpace()) return;
  cloud.leaveSpace();
  await onboarding();
}

function hideSplash() {
  const s = $('#splash');
  if (!s) return;
  s.classList.add('out');
  setTimeout(() => s.remove(), 400);
}

function onboarding() {
  hideSplash();
  // Lien de Jam scanné sur un appareil pas encore lié : on propose de la rejoindre directement (sans bibliothèque)
  const jamCode = (location.hash.match(/jam\?code=([A-Z0-9]{4,8})/i) || [])[1]?.toUpperCase() || '';
  return new Promise((resolve) => {
    const box = $('#profile-picker');
    box.innerHTML = String(html`<div style="max-width:520px">
      <img src="/assets/onboarding.png" alt="" class="onboarding-art">
      <h1 style="margin-bottom:12px">Bienvenue sur Boombox</h1>
      <p class="muted" style="margin-bottom:32px">Ta bibliothèque est synchronisée entre tous tes appareils, même quand ce PC est éteint.</p>
      ${jamCode ? html`<div class="np-card" style="text-align:left;margin-bottom:20px"><b>Tu as scanné le QR code d'une Jam</b><p class="muted" style="margin:6px 0 12px">Rejoins-la directement pour ajouter des sons à la file, sans créer de bibliothèque.</p><a class="btn primary" style="width:100%" href="/party.html?code=${jamCode}">Rejoindre la party ${jamCode}</a></div>` : ''}
      <div class="row-flex" id="ob-choice" style="justify-content:center;flex-direction:column;gap:12px">
        <button class="btn ${jamCode ? 'ghost' : 'primary'}" id="ob-new" style="width:100%">C'est mon premier appareil</button>
        <button class="btn ghost" id="ob-join" style="width:100%">J'ai déjà Boombox sur un autre appareil</button>
      </div>
      <form id="ob-name-box" class="hidden" style="text-align:left">
        <p class="muted" style="margin:0 0 10px">Comment tu t'appelles ? Ce sera le nom de ton profil.</p>
        <input class="input" id="ob-name" placeholder="Prénom" maxlength="40" autocomplete="given-name" style="width:100%">
        <div class="row-flex" style="gap:10px;margin-top:14px"><button type="button" class="btn ghost" id="ob-back" style="flex:1">${icon('back', 16)} Retour</button><button class="btn primary" id="ob-create" style="flex:2">Créer mon profil</button></div>
        <p class="muted" style="font-size:12px;margin-top:12px">Tu as déjà Boombox ailleurs ? Fais Retour et choisis « J'ai déjà Boombox sur un autre appareil » pour retrouver ta bibliothèque.</p>
      </form>
      <div id="ob-join-box" class="hidden" style="margin-top:24px;text-align:left">
        <p class="muted">Sur ton autre appareil : <b>Paramètres → Lier mes appareils</b>. Scanne le QR code avec l'appareil photo, ou colle le lien ici :</p>
        <div class="row-flex"><input class="input" id="ob-link" placeholder="http://…/#/join?s=…&k=…" style="flex:1"><button class="btn white" id="ob-go">Lier</button></div>
      </div>
      <p class="muted" id="ob-err" style="color:var(--danger);margin-top:16px"></p>
    </div>`);
    box.classList.remove('hidden');
    const err = (e) =>
      ($('#ob-err').textContent = /permission/i.test(e.code || e.message || '')
        ? `Firebase a refusé la connexion (${e.code || 'refus'}). Ferme cet onglet et rouvre le lien ; si ça continue, vérifie la date et l'heure du téléphone.`
        : e.message || String(e));
    // Premier appareil : on demande d'abord le prénom (avec Retour) ; la bibliothèque n'est créée qu'à la validation
    const showChoice = (choice) => {
      $('#ob-choice').classList.toggle('hidden', !choice);
      $('#ob-name-box').classList.toggle('hidden', choice);
      $('#ob-join-box').classList.add('hidden');
      $('#ob-err').textContent = '';
      if (!choice) $('#ob-name').focus();
    };
    $('#ob-new').onclick = () => showChoice(false);
    $('#ob-back').onclick = () => showChoice(true);
    $('#ob-name-box').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#ob-name').value.trim();
      if (!name) return $('#ob-name').focus();
      try {
        $('#ob-create').disabled = true;
        await cloud.createSpace(state.device.name);
        firstProfileName = name;
        box.classList.add('hidden');
        resolve();
      } catch (er) {
        $('#ob-create').disabled = false;
        err(er);
      }
    };
    $('#ob-join').onclick = () => $('#ob-join-box').classList.remove('hidden');
    $('#ob-go').onclick = async () => {
      const inv = parseInvite($('#ob-link').value);
      if (!inv) return err('Lien invalide');
      try {
        await cloud.joinSpace(inv.sid, inv.secret, state.device.name);
        box.classList.add('hidden');
        resolve();
      } catch (e) {
        err(/permission/i.test(e.code || e.message) ? 'Lien invalide ou expiré' : e);
      }
    };
  });
}

boot().catch((e) => {
  console.error(e);
  const msg = /permission/i.test(e.code || e.message || '')
    ? 'Accès refusé par Firebase : les règles de sécurité (firestore.rules) ne sont pas encore installées.'
    : e.message;
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#fff">Impossible de démarrer Boombox : ${esc(msg)}<br><br>Le serveur local est-il lancé ? (<code>npm start</code>)</div>`;
});
