// Pages principales : accueil, recherche, titres likés, playlists, albums, artistes, nouveautés, bibliothèque.
import { html, raw, esc, icon, fmtTotal, fmtAgo, plural, toast, promptText, confirmBox, contextMenu, dominantColor, artistLinks, debounce, modal } from './ui.js';
import { state, api, ls, emit, setting, saveSettings, toggleFollow, isFollowing, createPlaylist, addToPlaylist, getHistory, updatePlaylist, deletePlaylist, restorePlaylist, purgePlaylist, TRASH_DAYS, sharePlaylist, movePlaylist, moveRoot, rootEntries, folderOf, followMany, setKnownReleases, setFollowThumbs, likeAllPlaylistTracks, createFolder, renameFolder, deleteFolder, movePlaylistToFolder, removeItems, isLiked, toggleLike } from './state.js';
import { player, ctl, TRANSITION_NAMES } from './player.js';
import { sync } from './sync.js';
import { cover, playlistCover, likedCover, trackList, card, rememberTracks, playlistSubmenu, playKey, openPlaylistPicker } from './components.js';
import { sendToFriend } from './views-social.js';
import { playlistShareItems } from './views-share.js';
import { dailyMixes, lastMixes } from './dailymix.js';
import { isNative } from './native.js';
import { offline } from './offline.js';
import { canSync, setPlaylistSync, syncPlaylistNow, linkSource } from './playlist-sync.js';
import { concertCard } from './views-concerts.js';
import { openSyncPanel } from './views-reports.js';
import { automix } from './automix.js';
import { spotifyUserCards } from './views-spotify.js';

// Bouton « Télécharger » (appli mobile) : état + nombre de titres déjà sur le téléphone
function dlButton(on, tracks) {
  if (!isNative) return '';
  const n = offline.count(tracks);
  return html`<button class="act-btn dl-btn ${on ? 'on' : ''}" id="dl-toggle" title="${on ? 'Téléchargée' : 'Télécharger pour écouter hors ligne'}">${icon('import')}</button>${on ? html`<span class="muted dl-count">${n}/${tracks.length} sur le téléphone</span>` : ''}`;
}

// Squelette affiché pendant le chargement (plus agréable qu'un simple rond qui tourne)
const loading = raw(`<div class="sk-page"><div class="sk sk-title"></div><div class="sk-cards">${'<div class="sk sk-card"></div>'.repeat(6)}</div><div style="height:28px"></div>${'<div class="sk sk-row"></div>'.repeat(5)}</div>`);
const shuffleBtn = () => html`<button class="act-btn ${player.shuffle ? 'on' : ''}" data-shuffle title="Lecture aléatoire">${icon('shuffle')}</button>`;
const mixBtn = (pl = null) => html`<button class="act-btn ${setting('automix', false) || pl?.mixed ? 'on' : ''}" id="pl-mix" title="Mix : transitions façon DJ">${icon('mixer')}</button>`;

// Bouton « Mix » d'une playlist : deux façons de mixer
// - Transitions : la playlist est jouée dans son ordre (ou en aléatoire), chaque passage est mixé, même entre deux sons différents
// - Mix intelligent : des sons au hasard de la playlist, en choisissant à chaque fois le plus compatible avec celui en cours
function mixMenu(e, getTracks, pctx, rerender, pl = null) {
  const r = e.currentTarget.getBoundingClientRect();
  const on = setting('automix', false);
  const smart = on && setting('mixSmart', false);
  const start = async (smartMode) => {
    if (player.engine?.name !== 'audio') return toast('Le mix nécessite la lecture audio directe (yt-dlp)');
    await saveSettings({ automix: true, mixSmart: smartMode });
    player.setAutomix(true);
    if (smartMode && !player.shuffle) ctl.toggleShuffle();
    const tracks = getTracks();
    if (player.context?.id !== pctx.id && tracks.length) ctl.playList(tracks, smartMode ? Math.floor(Math.random() * tracks.length) : 0, pctx);
    toast(smartMode ? 'Mix intelligent : les sons les plus compatibles s’enchaînent (analyse en cours…)' : 'Mix activé : chaque transition est mixée');
    rerender();
  };
  contextMenu(r.left, r.bottom + 6, [
    pl && { label: pl.mixed ? 'Playlist mixée : afficher les transitions ✓' : 'Faire une playlist mixée (transitions entre les titres)', icon: pl.mixed ? 'check' : 'mixer', action: async () => {
      await updatePlaylist(pl.id, { mixed: !pl.mixed });
      toast(pl.mixed ? 'Playlist normale' : 'Playlist mixée : les transitions s’affichent entre les titres et se jouent automatiquement');
    } },
    pl && { sep: true },
    { label: 'Mixer les transitions', icon: on && !smart ? 'check' : 'mixer', action: () => start(false) },
    { label: 'Mix intelligent (sons les plus compatibles)', icon: smart ? 'check' : 'automix', action: () => start(true) },
    { label: `Transition : ${TRANSITION_NAMES[setting('mixStyle', 'auto')] || 'Auto'}`, icon: 'mixer', submenu: () => Object.entries(TRANSITION_NAMES).map(([k, label]) => ({ label, icon: setting('mixStyle', 'auto') === k ? 'check' : null, action: async () => {
      await saveSettings({ mixStyle: k });
      player._planNext?.();
      toast(k === 'auto' ? 'Transitions : Boombox choisit la meilleure à chaque fois' : k === 'none' ? 'Aucune transition : chaque son va jusqu’au bout' : `Transitions : ${label}`);
    } })) },
    on && { sep: true },
    on && { label: 'Arrêter le mix', icon: 'close', action: async () => (await saveSettings({ automix: false, mixSmart: false }), player.setAutomix(false), rerender()) },
  ]);
}

// Détecteur de doublons : même vidéo, ou même titre du même artiste (version clip, audio, remaster…).
// Dans chaque groupe, le premier titre de la playlist est gardé ; on peut décocher ceux à conserver.
const dupKey = (t) => `${String(t.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').replace(/[^\p{L}\p{N}]+/gu, '')}|${String(t.artists?.[0]?.name || '').toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]+/gu, '')}`;
function findDuplicates(p) {
  const groups = new Map();
  p.tracks.forEach((t, i) => {
    const k = dupKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ t, i });
  });
  const dups = [...groups.values()].filter((g) => g.length > 1);
  if (!dups.length) return toast(`Aucun doublon dans « ${p.name} »`);
  const extra = dups.reduce((n, g) => n + g.length - 1, 0);
  modal({
    title: `${plural(extra, 'doublon')} dans « ${p.name} »`,
    body: String(html`<p class="muted" style="margin-top:0">Les titres cochés seront retirés (le premier de chaque groupe est gardé).</p><div class="dup-list">${dups.map((g) => html`<div class="dup-group">${g.map(({ t, i }, k) => html`<label class="dup-row">${k ? html`<input type="checkbox" checked data-item="${t._item || ''}">` : html`<span class="dup-keep">Gardé</span>`}${cover(t, '', 96)}<div class="t-text"><span class="t-title">${t.title}</span><span class="t-artists muted">${(t.artists || []).map((a) => a.name).join(', ')} · n°${i + 1}</span></div></label>`)}</div>`)}</div>`),
    actions: [{ label: 'Annuler' }, { label: 'Retirer les doublons', primary: true, value: (w) => [...w.querySelectorAll('[data-item]:checked')].map((c) => c.dataset.item).filter(Boolean) }],
  }).then(async (ids) => {
    if (!Array.isArray(ids) || !ids.length) return;
    await removeItems(ids);
    toast(`${plural(ids.length, 'doublon')} retiré${ids.length > 1 ? 's' : ''}`);
  });
}

// Playlist mixée (comme les playlists mixées de Spotify) : entre chaque titre, la transition qui sera jouée.
// « Auto » = Boombox choisit la meilleure (son nom s'affiche dès que les deux titres sont analysés) ; un clic pour la changer.
function drawTransitions(list, tr, p) {
  const rows = [...list.querySelectorAll('.track')];
  rows.slice(0, -1).forEach((row, i) => {
    const a = tr[i];
    const b = tr[i + 1];
    if (!a || !b) return;
    const key = `${a.id}_${b.id}`;
    const chosen = p.transitions?.[key] || 'auto';
    const auto = chosen === 'auto' ? automix.plan(a.id, b.id, 'auto') : null;
    const label = chosen === 'auto' ? (auto ? `${TRANSITION_NAMES[auto.style]} · auto` : 'Auto') : TRANSITION_NAMES[chosen];
    const sep = document.createElement('div');
    sep.className = `mix-sep ${chosen === 'auto' ? '' : 'set'} ${chosen === 'none' ? 'off' : ''}`;
    if (chosen === 'auto') Object.assign(sep.dataset, { a: a.id, b: b.id });
    sep.innerHTML = `<button title="Transition entre « ${esc(a.title)} » et « ${esc(b.title)} »">${icon('mixer', 14)}<span>${esc(label)}</span>${icon('down', 14)}</button>`;
    sep.querySelector('button').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.left, r.bottom + 4, Object.entries(TRANSITION_NAMES).map(([k, name]) => ({
        label: k === 'auto' && auto ? `Auto (${TRANSITION_NAMES[auto.style]})` : name,
        icon: chosen === k ? 'check' : null,
        action: () => updatePlaylist(p.id, { [`transitions.${key}`]: k === 'auto' ? null : k }).then(() => player._planNext?.()),
      })));
    };
    row.after(sep);
  });
  // Analyse en arrière-plan des premiers titres : les noms « auto » se précisent au fur et à mesure
  automix.ensure(tr.slice(0, 12).map((t) => t.id));
  mixLabelsWatch ??= automix.onAnalyzed(() => document.querySelectorAll('.mix-sep[data-a]').forEach((s) => {
    const plan = automix.plan(s.dataset.a, s.dataset.b, 'auto');
    if (plan) s.querySelector('span').textContent = `# · auto`.replace('#', TRANSITION_NAMES[plan.style]);
  }));
}
let mixLabelsWatch = null;

// « + Ajouter » d'une playlist : recherche et ajout direct, sans quitter la page (comme sur Spotify)
function addTracksDialog(playlistId) {
  let results = [];
  modal({
    title: 'Ajouter à cette playlist',
    body: String(html`<div class="add-dialog"><div class="search-box"><input id="ad-q" placeholder="Cherche un titre ou un artiste" autocomplete="off"></div><div id="ad-res" class="ad-res"><p class="muted">Tape quelque chose pour chercher.</p></div></div>`),
    actions: [{ label: 'Terminé', primary: true }],
    onMount: (w) => {
      const q = w.querySelector('#ad-q');
      const box = w.querySelector('#ad-res');
      const draw = () => {
        const inPl = new Set((state.library.playlists.find((x) => x.id === playlistId)?.tracks || []).map((t) => t.id));
        box.innerHTML = results.length ? results.map((t, i) => String(html`<div class="ad-row">${cover(t, '', 96)}<div class="t-text"><span class="t-title">${t.title}</span><span class="t-artists">${(t.artists || []).map((a) => a.name).join(', ')}</span></div>${inPl.has(t.id) ? html`<span class="muted ad-done">${icon('check', 18)}Ajouté</span>` : html`<button class="outline-btn" data-add="${i}">Ajouter</button>`}</div>`)).join('') : '<p class="muted">Aucun résultat.</p>';
      };
      q.addEventListener('input', debounce(async () => {
        if (!q.value.trim()) return;
        const res = await api(`/api/search?q=${encodeURIComponent(q.value.trim())}`).catch(() => null);
        results = (res?.songs || res?.items || []).filter((t) => t.type === 'song' || t.type === 'video' || !t.type).slice(0, 12);
        draw();
      }, 300));
      box.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-add]');
        if (!b) return;
        b.disabled = true;
        await addToPlaylist(playlistId, [results[+b.dataset.add]]);
        draw();
      });
      setTimeout(() => q.focus(), 50);
    },
  });
}

function errorBox(e) {
  return html`<div class="page"><div class="empty"><h2>Oups</h2><p>${e.message}</p><button class="btn white" onclick="location.reload()">Réessayer</button></div></div>`;
}

async function heroColor(el, url) {
  const c = await dominantColor(url);
  if (c) {
    el.style.setProperty('--hero', c);
    document.documentElement.style.setProperty('--topbar-bg', c);
  }
}

// Boutons d'action communs aux pages de liste (lecture / aléatoire)
function wireListActions(root, getTracks, context) {
  root.querySelector('[data-playall]')?.addEventListener('click', () => {
    const tracks = getTracks();
    if (!tracks.length) return toast('Rien à lire');
    const same = player.context && context && player.context.type === context.type && player.context.id === context.id;
    if (same && player.track) return ctl.toggle();
    ctl.playList(tracks, 0, context);
  });
  root.querySelector('[data-shuffle]')?.addEventListener('click', (e) => {
    const tracks = getTracks();
    if (!tracks.length) return;
    if (!player.shuffle) ctl.toggleShuffle();
    const same = player.context && context && player.context.type === context.type && player.context.id === context.id;
    if (!same) ctl.playList(tracks, Math.floor(Math.random() * tracks.length), context);
    e.currentTarget.classList.add('on');
  });
}

function playAllIcon(context) {
  const same = player.context && context && player.context.type === context.type && player.context.id === context.id && !player.paused;
  return icon(same ? 'pause' : 'play');
}

// ======================= ACCUEIL =======================
export async function home(el, _p, ctx) {
  const h = new Date().getHours();
  const greet = h < 5 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir';
  const lib = state.library;
  el.innerHTML = String(html`<div class="home-bg"></div><div class="page" style="position:relative">
    <h1 class="greeting">${greet}, ${state.profile.name}</h1>
    <div class="quick" id="quick"></div>
    <div id="home-sections">${loading}</div>
  </div>`);

  // Tuiles rapides : Titres likés + playlists récentes
  const quick = [
    { name: 'Titres likés', href: '#/liked', coverHtml: likedCover(), play: 'liked' },
    ...lib.playlists
      .slice()
      .slice(0, 7)
      .map((p) => ({ name: p.name, href: `#/playlist/${p.id}`, coverHtml: playlistCover(p), play: `local:${p.id}` })),
  ];
  el.querySelector('#quick').innerHTML = quick
    .map((q) => String(html`<div class="quick-item" data-href="${q.href}">${q.coverHtml}<b class="ellipsis">${q.name}</b><button class="card-play" data-play="${q.play}">${icon('play')}</button></div>`))
    .join('');

  const history = await getHistory(400).catch(() => []);
  if (!ctx.alive()) return;
  const sections = [];
  const homeSections = el.querySelector('#home-sections');
  const name = state.profile.name;
  // Section chargée en arrière-plan : une place réservée (squelette), remplacée quand les données arrivent
  const slot = (id, title) => `<section class="section" id="${id}"><div class="section-head"><h2>${esc(title)}</h2></div><div class="sk-cards">${'<div class="sk sk-card"></div>'.repeat(5)}</div></section>`;
  const fill = (id, html) => {
    const box = el.querySelector(`#${id}`);
    if (box && ctx.alive()) html ? (box.outerHTML = html) : box.remove();
  };

  // Récemment écoutés (titres uniques)
  const seen = new Set();
  const recent = history.filter((t) => !seen.has(t.id) && seen.add(t.id)).slice(0, 12);
  rememberTracks(recent);

  // Réécoute tes anciens favoris : likés il y a plus de 3 mois, pas écoutés depuis 2 mois
  const recentIds = new Set(history.filter((h) => Date.now() - h.playedAt < 60 * 86400e3).map((h) => h.id));
  const day = Math.floor(Date.now() / 86400e3);
  const oldFavs = lib.liked.filter((t) => t.addedAt && Date.now() - t.addedAt > 90 * 86400e3 && !recentIds.has(t.id))
    .map((t, i) => [((i + 1) * 2654435761 + day * 40503) % 1000, t]).sort((x, y) => x[0] - y[0]).map((x) => x[1]).slice(0, 12);
  rememberTracks(oldFavs);

  // Artistes les plus présents (écoutes + likes) : pour les mix et « Pour les fans de… »
  const pool = [...history, ...lib.liked];
  const byArtist = new Map();
  for (const t of pool) {
    const a = t.artists?.[0];
    if (!a?.name) continue;
    const e = byArtist.get(a.name) || { a, t, n: 0 };
    e.n++;
    byArtist.set(a.name, e);
  }
  const mixes = [...byArtist.values()].sort((x, y) => y.n - x.n).slice(0, 8);
  rememberTracks(mixes.map((m) => m.t));
  const mixColors = ['#7c4dff', '#1e3264', '#8d67ab', '#148a08', '#bc5900', '#e8115b', '#509bf5', '#477d95'];

  const hasMusic = recent.length || lib.liked.length || lib.playlists.length;
  if (hasMusic) {
    sections.push(slot('daily', `Conçu pour ${name}`));
    if (recent.length) sections.push(section('Écoutés récemment', recent.map((t) => card(t)), '#/history', 'Historique'));
    sections.push('<section class="section" id="reco-day"></section>');
    if (lib.follows.length) sections.push(slot('rel-for-you', 'Dernières sorties rien que pour toi'));
    sections.push(slot('new-music', 'Top des nouveautés musicales'));
    sections.push(slot('trending', 'Tendances en France'));
    if (oldFavs.length) sections.push(section('Réécoute tes anciens favoris', oldFavs.map((t) => card(t, { sub: (t.artists || []).map((a) => a.name).join(', ') }))));
    if (mixes.length) {
      sections.push(section('Tes mix', mixes.map((m, i) => card(
        { name: `Mix ${m.a.name}`, type: 'mix', coverHtml: html`<div class="cover" style="background:${mixColors[i % 8]}">${m.t.thumb ? html`<img src="${m.t.thumb}" style="opacity:.85;mix-blend-mode:luminosity" alt="">` : icon('radio')}</div>` },
        { sub: `${m.a.name} et d'autres artistes similaires`, href: '', play: `mix:${m.t.id}` },
      ))));
    }
    sections.push(slot('pl-moment', [5, 6, 0].includes(new Date().getDay()) ? 'Les playlists du week-end' : 'Playlists du moment'));
    if (mixes[0]) sections.push(slot('pl-fans', `Pour les fans de ${mixes[0].a.name}`));
    sections.push(slot('pl-genre', 'Rap français alternatif'));
  }
  if (lib.playlists.length) sections.push(section('Tes playlists', lib.playlists.map((p) => card({ ...p, type: 'local', coverHtml: playlistCover(p) }, { sub: plural(p.tracks.length, 'titre') })), '#/library', 'Tout afficher'));
  if (lib.follows.length) sections.push(section('Artistes suivis', lib.follows.map((f) => card({ ...f, type: 'artist' })), '#/releases', 'Nouveautés'));

  if (!sections.length) {
    homeSections.innerHTML = String(html`<div class="empty"><img class="empty-art" src="/assets/empty-library.png" alt=""><h2>Bienvenue sur Boombox</h2><p>Cherche un titre ou un artiste pour commencer, ou importe tes playlists Spotify / Deezer.</p>
      <div class="row-flex" style="justify-content:center;margin-top:20px"><a class="btn white" href="#/search">Rechercher</a><a class="btn ghost" href="#/import">Importer une playlist</a></div></div>`);
    return;
  }
  homeSections.innerHTML = sections.join('');
  if (!hasMusic) return;

  // Conçu pour toi : les Mix du jour
  dailyMixes().then((ms) => fill('daily', ms.length ? section(`Conçu pour ${name}`, ms.map((m) => card({ name: m.name, type: 'mix', coverHtml: mixCover(m) }, { sub: m.desc, href: `#/mix/${m.id}`, play: `daily:${m.id}` }))) : '')).catch(() => fill('daily', ''));

  // Dernières sorties de tes artistes (les nouvelles d'abord)
  if (lib.follows.length) {
    (releasesCache ? Promise.resolve(releasesCache) : fetchReleases()).then((r) => {
      const items = (r.releases || []).slice(0, 14);
      fill('rel-for-you', items.length ? section('Dernières sorties rien que pour toi', items.map((x) => card(x, { sub: `${x.isNew ? 'Nouveau · ' : ''}${x.kind || 'Sortie'} · ${x.artist?.name || ''}` })), '#/releases', 'Tout afficher') : '');
    }).catch(() => fill('rel-for-you', ''));
  }

  // Nouveautés et tendances (YouTube Music France), playlists thématiques
  const q = {
    moment: [5, 6, 0].includes(new Date().getDay()) ? 'playlist soirée week-end' : 'hits du moment playlist',
    fans: mixes[0] ? `${mixes[0].a.name} mix` : null,
    genre: 'rap français alternatif',
  };
  api('/api/home', { method: 'POST', body: { playlists: [q.moment, q.fans, q.genre].filter(Boolean) } }).then((h) => {
    rememberTracks(h.trending || []);
    fill('new-music', h.newReleases?.length ? section('Top des nouveautés musicales', h.newReleases.map((x) => card(x))) : '');
    fill('trending', h.trending?.length ? section('Tendances en France', h.trending.slice(0, 16).map((t) => card(t, { sub: (t.artists || []).map((a) => a.name).join(', ') }))) : '');
    const pl = (key, title) => fill(key, h.playlists?.[q[key.slice(3)]]?.length ? section(title, h.playlists[q[key.slice(3)]].map((x) => card(x))) : '');
    pl('pl-moment', [5, 6, 0].includes(new Date().getDay()) ? 'Les playlists du week-end' : 'Playlists du moment');
    if (q.fans) pl('pl-fans', `Pour les fans de ${mixes[0].a.name}`);
    pl('pl-genre', 'Rap français alternatif');
  }).catch(() => ['new-music', 'trending', 'pl-moment', 'pl-fans', 'pl-genre'].forEach((k) => fill(k, '')));

  // Recommandation du jour : un titre que tu ne connais pas encore, choisi d'après tes goûts (le même toute la journée)
  recoOfTheDay(history).then((t) => {
    const box = el.querySelector('#reco-day');
    if (!box || !ctx.alive()) return;
    if (!t) return box.remove();
    rememberTracks([t]);
    box.outerHTML = String(html`<section class="section reco-day"><div class="section-head"><h2>Recommandation du jour</h2></div>
      <div class="reco-card" data-play-track="${t.id}">${cover(t, '', 544)}<div class="reco-info"><span class="hero-type">Pour toi aujourd'hui</span><h3>${t.title}</h3><p class="muted">${(t.artists || []).map((a) => a.name).join(', ')}</p><div class="row-flex"><button class="big-play" id="reco-play">${icon('play')}</button><button class="like-btn ${isLiked(t.id) ? 'on' : ''}" id="reco-like">${icon(isLiked(t.id) ? 'heartFill' : 'heart')}</button></div></div></div></section>`);
    el.querySelector('#reco-play').onclick = () => ctl.playRadio(t);
    el.querySelector('#reco-like').onclick = (e) => (toggleLike(t), e.currentTarget.classList.toggle('on'));
  }).catch(() => el.querySelector('#reco-day')?.remove());

  const firstThumb = recent[0]?.thumb || lib.liked[0]?.thumb;
  if (firstThumb) dominantColor(firstThumb).then((c) => c && el.querySelector('.home-bg')?.style.setProperty('--home-color', c));
}

// Recommandation du jour : radio d'un de tes titres favoris → premier titre ni liké ni déjà écouté. Gardée pour la journée.
async function recoOfTheDay(history) {
  const today = new Date().toDateString();
  const saved = ls.get(`boombox.reco.${state.profile.id}`, null);
  if (saved?.day === today && saved.track) return saved.track;
  const seeds = [...history.slice(0, 50), ...state.library.liked.slice(0, 50)];
  if (!seeds.length) return null;
  const seed = seeds[Math.floor(Math.random() * seeds.length)];
  const heard = new Set(history.map((h) => h.id));
  const radio = await api(`/api/radio/${seed.id}`);
  const t = radio.find((x) => x.id !== seed.id && !isLiked(x.id) && !heard.has(x.id)) || null;
  if (t) ls.set(`boombox.reco.${state.profile.id}`, { day: today, track: t });
  return t;
}
export const mixCover = (m) => html`<div class="cover mix-cover" style="--mix:${m.color}">${m.thumb ? html`<img src="${m.thumb}" alt="" referrerpolicy="no-referrer">` : ''}<span>${m.name.replace('Mix du jour ', '')}</span><b>Mix du jour</b></div>`;

// Page d'un Mix du jour
export async function mixPage(el, { id }) {
  const m = lastMixes.find((x) => x.id === id) || (await dailyMixes()).find((x) => x.id === id);
  if (!m) return (el.innerHTML = '<div class="page"><div class="empty"><h2>Mix introuvable</h2><a class="btn white" href="#/">Accueil</a></div></div>');
  const mctx = { type: 'daily', id: m.id, name: m.name };
  el.innerHTML = String(html`<div class="hero" style="--hero:${m.color}">${mixCover(m)}<div class="hero-info"><span class="hero-type">Playlist générée pour toi</span><h1>${m.name}</h1><div class="hero-desc">${m.desc}</div><div class="hero-meta"><span>${plural(m.tracks.length, 'titre')}</span><span class="sep"></span><span>Renouvelé chaque jour</span></div></div></div>
    <div class="page-body" style="--hero:${m.color}"><div class="actions"><button class="big-play" data-playall>${playAllIcon(mctx)}</button>${shuffleBtn()}<button class="outline-btn" id="mx-save">Enregistrer dans ma bibliothèque</button></div>${trackList(m.tracks, { context: mctx })}</div>`);
  wireListActions(el, () => m.tracks, mctx);
  el.querySelector('#mx-save').onclick = async () => {
    const p = await createPlaylist(`${m.name} (${new Date().toLocaleDateString('fr-FR')})`, m.tracks, m.desc);
    toast('Mix enregistré', { action: 'Voir', onAction: () => (location.hash = `#/playlist/${p.id}`) });
  };
}

function section(title, cards, href, linkLabel) {
  return String(html`<section class="section"><div class="section-head"><h2>${title}</h2>${href ? html`<a href="${href}">${linkLabel || 'Tout afficher'}</a>` : ''}</div><div class="cards row">${cards}</div></section>`);
}

// ======================= RECHERCHE =======================
const GENRES = [
  ['Rap français', '#e13300'], ['Pop', '#8d67ab'], ['Hits du moment', '#1e3264'], ['R&B', '#dc148c'], ['Afro', '#148a08'], ['Électro', '#509bf5'],
  ['Rock', '#e91429'], ['Chill', '#477d95'], ['Années 2000', '#bc5900'], ['Jazz', '#8c1932'], ['Lo-fi', '#7d4b32'], ['Reggaeton', '#e8115b'],
  ['Classique', '#7358ff'], ['Variété française', '#ba5d07'], ['K-pop', '#e1118c'], ['Musique de film', '#2d46b9'],
];

export async function search(el, params, ctx) {
  const q = params.q || '';
  const type = params.type || 'all';
  const recents = ls.get('boombox.recentSearches', []);
  if (!q) {
    el.innerHTML = String(html`<div class="page">
      ${recents.length ? html`<div class="section-head"><h2>Recherches récentes</h2><button class="more" id="clear-recents">Effacer</button></div>
      <div class="history-chips">${recents.map((r) => html`<a class="chip" href="#/search?q=${encodeURIComponent(r)}">${r}</a>`)}</div>` : ''}
      <div class="section-head"><h2>Parcourir tout</h2></div>
      <div class="genres">${GENRES.map(([g, c]) => html`<a class="genre" style="background:${c}" href="#/search?q=${encodeURIComponent(g + ' playlist')}">${g}</a>`)}</div>
    </div>`);
    el.querySelector('#clear-recents')?.addEventListener('click', () => {
      ls.set('boombox.recentSearches', []);
      search(el, params, ctx);
    });
    return;
  }
  // Lien (ou identifiant) d'un profil Spotify collé dans la recherche : on ouvre directement le profil
  const spUser = q.match(/(?:open\.spotify\.com\/(?:intl-\w+\/)?user\/|spotify:user:)([\w.-]+)/i);
  if (spUser) return void (location.hash = );
  ls.set('boombox.recentSearches', [q, ...recents.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 10));

  const tabs = [['all', 'Tout'], ['song', 'Titres'], ['artist', 'Artistes'], ['album', 'Albums'], ['playlist', 'Playlists'], ['video', 'Vidéos'], ['people', 'Profils Spotify'], ['lyrics', 'Paroles']];
  el.innerHTML = String(html`<div class="page">
    <div class="search-tabs">${tabs.map(([k, l]) => html`<a class="chip ${k === type ? 'active' : ''}" href="#/search?q=${encodeURIComponent(q)}&type=${k}">${l}</a>`)}</div>
    <div id="results">${loading}</div>
  </div>`);
  // Recherche par paroles : « je me souviens juste d'une phrase »
  const lyricsHits = (list) => html`<section class="section lyr-hits"><div class="section-head"><h2>Trouvé dans les paroles</h2></div>${list.map((h, i) => html`<div class="lyr-hit" data-lh="${i}">${cover(h.track, '', 96)}<div class="t-text"><span class="t-title">${h.track.title}</span><span class="t-artists muted">${(h.track.artists || []).map((a) => a.name).join(', ')}</span><q>${h.line}</q></div><button class="play-btn" aria-label="Écouter">${icon('play')}</button></div>`)}</section>`;
  const wireHits = (box, list) => box.querySelectorAll('[data-lh]').forEach((r) => (r.onclick = () => ctl.playList(list.map((h) => h.track), +r.dataset.lh, { type: 'search', name: `Paroles : ${q}` })));
  // Profils Spotify (recherche par nom) : voir ses playlists et les ajouter à sa bibliothèque
  if (type === 'people') {
    const box = el.querySelector('#results');
    const users = await api(`/api/spotify/users?q=${encodeURIComponent(q)}`).catch(() => []);
    if (!ctx.alive()) return;
    box.innerHTML = users.length ? String(spotifyUserCards(users)) : String(html`<div class="empty"><h2>Aucun profil Spotify « ${q} »</h2><p>La recherche de Spotify ne trouve pas tous les profils (surtout les petits). Colle plutôt <b>le lien de son profil</b> ici : sur Spotify, ouvre le profil → <b>⋯</b> → <b>Partager</b> → <b>Copier le lien du profil</b>.</p></div>`);
    return;
  }
  if (type === 'lyrics') {
    const box = el.querySelector('#results');
    box.innerHTML = String(html`<p class="muted">Recherche de « ${q} » dans les paroles…</p>${loading}`);
    const hits = await api(`/api/lyrics-search?q=${encodeURIComponent(q)}`).catch(() => []);
    if (!ctx.alive()) return;
    box.innerHTML = hits.length ? String(lyricsHits(hits)) : String(html`<div class="empty"><h2>Aucune chanson trouvée avec ces paroles</h2><p>Tape au moins 4 ou 5 mots d'affilée de la chanson, sans faute si possible.</p></div>`);
    wireHits(box, hits);
    return;
  }
  // Recherche classique de plusieurs mots : on vérifie aussi les paroles en arrière-plan
  if (type === 'all' && q.trim().split(/\s+/).length >= 4) {
    api(`/api/lyrics-search?q=${encodeURIComponent(q)}`).then((hits) => {
      const out = el.querySelector('#results');
      if (!ctx.alive() || !hits.length || !out) return;
      out.insertAdjacentHTML('afterbegin', String(lyricsHits(hits.slice(0, 3))));
      wireHits(out.querySelector('.lyr-hits'), hits.slice(0, 3));
    }).catch(() => {});
  }
  let res;
  try {
    res = await api(`/api/search?q=${encodeURIComponent(q)}&type=${type}`);
  } catch (e) {
    el.querySelector('#results').innerHTML = String(html`<div class="empty"><p>${e.message}</p></div>`);
    return;
  }
  if (!ctx.alive()) return;
  const out = el.querySelector('#results');

  if (type !== 'all') {
    const items = res.items || [];
    if (!items.length) return (out.innerHTML = String(html`<div class="empty"><img class="empty-art" src="/assets/empty-search.png" alt=""><h2>Aucun résultat pour « ${q} »</h2><p>Vérifie l'orthographe ou essaie d'autres mots-clés.</p></div>`));
    if (type === 'song' || type === 'video') {
      const tracks = items.map(({ type: _t, ...t }) => t);
      out.innerHTML = String(trackList(tracks, { context: { type: 'search', name: `Recherche « ${q} »` }, album: type === 'song' }));
    } else {
      rememberTracks(items);
      out.innerHTML = String(html`<div class="cards">${items.map((i) => card(i))}</div>`);
    }
    return;
  }

  const songs = res.songs.map(({ type: _t, ...t }) => t);
  const top = res.top;
  if (!top && !songs.length) return (out.innerHTML = String(html`<div class="empty"><img class="empty-art" src="/assets/empty-search.png" alt=""><h2>Aucun résultat pour « ${q} »</h2></div>`));
  rememberTracks([...songs, ...res.videos]);
  if (top && (top.type === 'song' || top.type === 'video')) rememberTracks([top]);
  const topHtml = top
    ? html`<div><div class="section-head"><h2>Meilleur résultat</h2></div>
      <div class="top-result" data-href="${top.type === 'artist' ? `#/artist/${top.id}` : top.type === 'album' ? `#/album/${top.id}` : ''}">
        ${cover(top, top.type === 'artist' ? 'round' : '')}
        <h3>${top.name || top.title}</h3>
        <div class="muted">${top.type === 'artist' ? html`<span class="chip" style="background:#121212">Artiste</span>` : top.type === 'album' ? 'Album' : artistLinks(top)}</div>
        <button class="card-play" data-play="${top.type === 'artist' ? `artist:${top.id}` : top.type === 'album' ? `album:${top.id}` : `track:${top.id}`}">${icon('play')}</button>
      </div></div>`
    : '';
  out.innerHTML = String(html`
    <div class="search-grid">
      ${topHtml}
      <div><div class="section-head"><h2>Titres</h2><a href="#/search?q=${encodeURIComponent(q)}&type=song">Tout afficher</a></div>
      ${trackList(songs.slice(0, 4), { context: { type: 'search', name: `Recherche « ${q} »` }, album: false, numbered: false })}</div>
    </div>
    ${res.artists.length ? raw(section('Artistes', res.artists.map((a) => card(a)), `#/search?q=${encodeURIComponent(q)}&type=artist`)) : ''}
    ${res.albums.length ? raw(section('Albums', res.albums.map((a) => card(a)), `#/search?q=${encodeURIComponent(q)}&type=album`)) : ''}
    ${res.playlists.length ? raw(section('Playlists', res.playlists.map((a) => card(a)), `#/search?q=${encodeURIComponent(q)}&type=playlist`)) : ''}
    ${res.videos.length ? raw(section('Vidéos', res.videos.map((v) => card({ ...v, type: 'video' })), `#/search?q=${encodeURIComponent(q)}&type=video`)) : ''}
    <div id="sp-users"></div>
  `);
  api(`/api/spotify/users?q=${encodeURIComponent(q)}`).then((users) => {
    const box = el.querySelector('#sp-users');
    if (!box || !users.length) return;
    box.innerHTML = String(html`<section class="section"><div class="section-head"><h2>Profils Spotify</h2><a href="#/search?q=${encodeURIComponent(q)}&type=people">Tout afficher</a></div>${spotifyUserCards(users.slice(0, 6))}</section>`);
  }).catch(() => {});
}

// ======================= TITRES LIKÉS =======================
export async function liked(el) {
  const render = () => {
    const tracks = state.library.liked;
    const ctx = { type: 'liked', id: 'liked', name: 'Titres likés' };
    const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    el.innerHTML = String(html`
      <div class="hero" style="--hero:#c2456b">${likedCover()}
        <div class="hero-info"><span class="hero-type">Playlist</span><h1>Titres likés</h1>
        <div class="hero-meta"><b>${state.profile.name}</b><span class="sep"></span><span>${plural(tracks.length, 'titre')}</span>${total ? html`<span>, ${fmtTotal(total)}</span>` : ''}</div></div>
      </div>
      <div class="page-body" style="--hero:#c2456b">
        <div class="actions">
          <button class="big-play" data-playall>${playAllIcon(ctx)}</button>${shuffleBtn()}
          ${dlButton(setting('offlineLiked', true), tracks)}
          <button class="act-btn" id="lk-more" title="Plus d'options">${icon('more')}</button>
          <span class="spacer"></span>
          ${toolsHtml('Récemment ajoutés')}
        </div>
        <div id="list">${tracks.length ? '' : html`<div class="empty"><img class="empty-art" src="/assets/empty-library.png" alt=""><h2>Les titres que tu aimes apparaîtront ici</h2><p>Clique sur le cœur à côté d'un titre pour l'enregistrer.</p><a class="btn white" href="#/search">Rechercher des titres</a></div>`}</div>
      </div>`);
    document.documentElement.style.setProperty('--topbar-bg', '#8a3150');
    wireListActions(el, () => el._shown || state.library.liked, ctx);
    el.querySelector('#dl-toggle')?.addEventListener('click', async () => {
      const on = !setting('offlineLiked', true);
      await saveSettings({ offlineLiked: on });
      toast(on ? 'Tes titres likés se téléchargent (et les prochains aussi)' : 'Titres likés retirés des téléchargements');
      offline.sync();
      render();
    });
    el.querySelector('#lk-more').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.left, r.bottom, [
        { label: 'Liker tous les titres de mes playlists', icon: 'heart', action: async () => { const n = await likeAllPlaylistTracks(); toast(n ? ` ajouté${n > 1 ? 's' : ''}` : 'Tout est déjà liké'); } },
        { label: `Ajouter à la file d'attente`, icon: 'addQueue', action: () => ctl.addToQueue(state.library.liked) },
        { label: 'Copier dans une playlist…', icon: 'plus', action: () => openPlaylistPicker(state.library.liked, { x: r.left + 150, y: r.bottom + 300 }) },
      ]);
    };
    if (tracks.length) wireTools(el, 'liked', () => state.library.liked, (tr) => ((el._shown = tr), trackList(tr, { context: ctx, added: true })));
  };
  render();
  return { onLibrary: render };
}

// Outils de liste façon Spotify : recherche dans la playlist + tri (mémorisé par playlist).
const SORTS = {
  custom: null,
  title: (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }),
  artist: (a, b) => (a.artists?.[0]?.name || '').localeCompare(b.artists?.[0]?.name || '', 'fr', { sensitivity: 'base' }),
  album: (a, b) => (a.album?.name || '').localeCompare(b.album?.name || '', 'fr', { sensitivity: 'base' }),
  // Plus récents en haut. À date égale (titres importés d'un coup), le dernier de la liste passe en premier.
  added: (a, b, ia, ib) => (b.addedAt || 0) - (a.addedAt || 0) || ib - ia,
  duration: (a, b) => (a.duration || 0) - (b.duration || 0),
};

const SORT_LABELS = { added: 'Ajoutés récemment', title: 'Titre', artist: 'Artiste', album: 'Album', duration: 'Durée' };

// Comme sur Spotify : une loupe qui s'ouvre en champ de recherche, et le tri en texte + icône (menu au clic)
function toolsHtml(customLabel = 'Ordre personnalisé') {
  return html`<div class="list-tools" data-custom-label="${customLabel}">
    <div class="lt-search"><button class="icon-btn" id="filter-btn" type="button" title="Rechercher dans la playlist" aria-label="Rechercher dans la playlist">${icon('search')}</button><input placeholder="Rechercher dans la playlist" id="filter" aria-label="Filtrer"></div>
    <button class="lt-sort" id="sort" type="button" title="Trier"><span></span>${icon('sortList')}</button></div>`;
}

// renderList(tracks, isCustomOrder) : le glisser-déposer n'est permis qu'en ordre personnalisé sans filtre.
function wireTools(el, key, getTracks, renderList, afterRender = null) {
  const tools = el.querySelector('.list-tools');
  const input = el.querySelector('#filter');
  const sortBtn = el.querySelector('#sort');
  const customLabel = tools.dataset.customLabel;
  let mode = ls.get(`boombox.sort.${key}`, 'custom');
  if (!(mode in SORTS)) mode = 'custom';
  let rev = ls.get(`boombox.sortRev.${key}`, false);
  const apply = () => {
    const q = input.value.toLowerCase().trim();
    let tr = getTracks();
    const sort = SORTS[mode];
    if (sort) {
      const idx = new Map(tr.map((t, i) => [t, i]));
      tr = tr.slice().sort((a, b) => sort(a, b, idx.get(a), idx.get(b)));
    }
    if (q) tr = tr.filter((t) => `${t.title} ${(t.artists || []).map((a) => a.name).join(' ')} ${t.album?.name || ''}`.toLowerCase().includes(q));
    if (rev) tr = tr.slice().reverse();
    sortBtn.querySelector('span').textContent = (SORT_LABELS[mode] || customLabel) + (rev ? ' (inversé)' : '');
    // La lecture suit l'ordre affiché ; le glisser-déposer reste réservé à l'ordre perso, non inversé
    el.querySelector('#list').innerHTML = String(renderList(tr, mode === 'custom' && !q && !rev));
    afterRender?.(el.querySelector('#list'), tr);
  };
  const openSearch = (open) => {
    tools.classList.toggle('searching', open);
    if (open) input.focus();
  };
  el.querySelector('#filter-btn').onclick = () => openSearch(!tools.classList.contains('searching') || !!input.value);
  input.addEventListener('blur', () => !input.value && openSearch(false));
  input.addEventListener('keydown', (e) => e.key === 'Escape' && ((input.value = ''), apply(), input.blur()));
  input.addEventListener('input', debounce(apply, 150));
  sortBtn.onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const pick = (m) => () => {
      mode = m;
      ls.set(`boombox.sort.${key}`, mode);
      apply();
    };
    contextMenu(r.right - 220, r.bottom + 6, [
      { label: customLabel, icon: mode === 'custom' ? 'check' : null, action: pick('custom') },
      ...Object.entries(SORT_LABELS).filter(([m]) => m !== 'added' || customLabel !== 'Récemment ajoutés').map(([m, label]) => ({ label, icon: mode === m ? 'check' : null, action: pick(m) })),
      { sep: true },
      { label: 'Ordre inversé', icon: rev ? 'check' : null, action: () => ((rev = !rev), ls.set(`boombox.sortRev.${key}`, rev), apply()) },
    ]);
  };
  apply();
}

// ======================= PLAYLIST LOCALE =======================
export async function playlist(el, { id }, ctx) {
  let recos = null;
  const render = () => {
    const p = state.library.playlists.find((x) => x.id === id);
    if (!p) {
      el.innerHTML = String(html`<div class="page"><div class="empty"><h2>Playlist introuvable</h2><a class="btn white" href="#/">Accueil</a></div></div>`);
      return;
    }
    const total = p.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const pctx = { type: 'playlist', id: p.id, name: p.name };
    el.innerHTML = String(html`
      <div class="hero ${p.banner ? 'has-banner year-banner' : ''}" style="${p.banner ? `background-image:url('${p.banner}')` : ''}"><button class="cover-edit" id="pl-cover" title="Changer l'image">${playlistCover(p, '', 544)}<span>${icon('edit')}Choisir une photo</span></button>
        <div class="hero-info"><span class="hero-type">Playlist</span>
          <h1 class="editable" id="pl-name" title="Renommer">${p.name}</h1>
          ${p.description ? html`<div class="hero-desc">${p.description}</div>` : ''}
          <div class="hero-meta"><b>${p.source?.owner || state.profile.name}</b>${p.source ? html`<span class="sep"></span><span>importée de ${p.source.url ? html`<a class="link" href="${p.source.url}" target="_blank" rel="noopener">${p.source.platform}</a>` : p.source.platform}</span>` : ''}<span class="sep"></span><span>${plural(p.tracks.length, 'titre')}</span>${total ? html`<span>, ${fmtTotal(total)}</span>` : ''}${p.source ? html`<span class="sep"></span><button class="sync-pill ${p.sync ? 'on' : ''}" id="pl-sync" title="${p.sync ? `Dernière vérification : ${p.syncedAt ? new Date(p.syncedAt).toLocaleString('fr-FR') : 'jamais'}${p.syncSourceCount ? ` · ${p.syncSourceCount} titres sur ${p.source.platform}, ${p.tracks.length} ici` : ''}${p.syncMissing?.length ? ` · introuvables sur YouTube : ${p.syncMissing.slice(0, 5).join(', ')}` : ''} — clique pour voir le détail` : 'Relier à la playlist Spotify pour récupérer les nouveaux titres'}">${icon('sync', 14)}${p.sync ? `Synchronisée${p.syncedAt ? ' · ' + fmtAgo(p.syncedAt) : ''}` : 'Mettre à jour depuis Spotify'}</button>` : ''}</div>
        </div>
      </div>
      <div class="page-body">
        <div class="actions">
          <button class="big-play" data-playall>${playAllIcon(pctx)}</button>${shuffleBtn()}${mixBtn(p)}
          ${dlButton(offline.isPlaylistOffline(p.id), p.tracks)}
          <button class="act-btn" id="pl-more" title="Plus d'options">${icon('more')}</button>
          <button class="vis-btn ${p.visibility === 'public' ? 'pub' : ''}" id="pl-vis" title="Qui peut voir cette playlist">${icon(p.visibility === 'public' ? 'users' : 'pin', 16)}${p.visibility === 'public' ? 'Publique' : 'Privée'}</button>
          <span class="spacer"></span>
          ${toolsHtml()}
        </div>
        <button class="pill-add" id="pl-add" type="button">${icon('plus', 18)}Ajouter</button>
        <div id="list">${p.tracks.length ? '' : html`<div class="empty" style="padding:32px"><h2 style="font-size:22px">Ajoutons quelque chose à ta playlist</h2><p>Cherche des titres et utilise « ⋯ → Ajouter à une playlist », ou glisse-les sur la playlist à gauche.</p></div>`}</div>
        <section class="section" style="margin-top:40px"><div class="section-head"><div><h2>Recommandés</h2><div class="muted">Basés sur le contenu de cette playlist</div></div><button class="more" id="reco-refresh">Actualiser</button></div><div id="recos">${recos ? '' : loading}</div></section>
      </div>`);
    heroColor(el, p.cover || p.tracks[0]?.thumb);
    wireListActions(el, () => el._shown || p.tracks, pctx);
    if (p.tracks.length) wireTools(el, `pl.${p.id}`, () => p.tracks, (tr, custom) => ((el._shown = tr), trackList(tr, { context: pctx, added: true, playlistId: p.id, reorder: custom, counts: p.playCounts })), (list, tr) => p.mixed && drawTransitions(list, tr, p));
    el.querySelector('#pl-name').onclick = () => editPlaylist(p);
    el.querySelector('#pl-cover').onclick = () => editPlaylist(p);
    el.querySelector('#dl-toggle')?.addEventListener('click', async () => (await offline.togglePlaylist(p.id), render()));
    el.querySelector('#pl-more').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      playlistMenu(p, r.left, r.bottom);
    };
    // Publique : visible sur mon profil, par mes amis et sur mon profil partagé ; privée : seulement moi
    el.querySelector('#pl-vis').onclick = () => import('./social.js').then(({ social }) => social.setVisibility(p, p.visibility === 'public' ? 'private' : 'public'));
    el.querySelector('#pl-mix').onclick = (e) => mixMenu(e, () => state.library.playlists.find((x) => x.id === id)?.tracks || [], pctx, render, state.library.playlists.find((x) => x.id === id));
    el.querySelector('#pl-add').onclick = () => addTracksDialog(p.id);
    el.querySelector('#pl-sync')?.addEventListener('click', () => openSyncPanel(p));
    el.querySelector('#reco-refresh').onclick = () => loadRecos(true);
    if (recos) renderRecos();
    else loadRecos();
  };

  async function loadRecos(shuffle = false) {
    const p = state.library.playlists.find((x) => x.id === id);
    if (!p) return;
    const box = el.querySelector('#recos');
    if (!p.tracks.length) {
      if (box) box.innerHTML = '<p class="muted">Ajoute quelques titres pour obtenir des recommandations.</p>';
      return;
    }
    const seed = shuffle ? p.tracks[Math.floor(Math.random() * p.tracks.length)] : p.tracks[p.tracks.length - 1];
    try {
      const radio = await api(`/api/radio/${seed.id}`);
      const ids = new Set(p.tracks.map((t) => t.id));
      recos = radio.filter((t) => !ids.has(t.id)).slice(0, 10);
      if (ctx.alive()) renderRecos();
    } catch {
      if (box) box.innerHTML = '';
    }
  }
  function renderRecos() {
    const box = el.querySelector('#recos');
    if (!box || !recos) return;
    box.innerHTML = String(trackList(recos, { context: { type: 'radio', name: 'Recommandés' }, numbered: false }));
    box.querySelectorAll('.t-end').forEach((end, i) => {
      const b = document.createElement('button');
      b.className = 'outline-btn';
      b.textContent = 'Ajouter';
      b.onclick = async (e) => {
        e.stopPropagation();
        await addToPlaylist(id, [recos[i]]);
        recos.splice(i, 1);
      };
      end.prepend(b);
    });
  }

  render();
  return { onLibrary: render };
}

export async function editPlaylist(p) {
  const v = await modal({
    title: 'Modifier les informations',
    body: String(html`<label class="field"><span>Nom</span><input class="input" id="e-name" value="${p.name}" maxlength="100"></label>
      <label class="field"><span>Description</span><textarea class="input" id="e-desc" rows="3" maxlength="300" placeholder="Ajoute une description (facultatif)">${p.description || ''}</textarea></label>
      <label class="field"><span>Image de couverture (facultatif)</span><input type="file" accept="image/*" id="e-cover" class="input"></label>
      ${p.cover ? html`<label class="row-flex"><input type="checkbox" id="e-rmcover"> Retirer l'image personnalisée</label>` : ''}`),
    actions: [
      { label: 'Annuler' },
      {
        label: 'Enregistrer',
        primary: true,
        value: async (w) => {
          const body = { name: w.querySelector('#e-name').value.trim(), description: w.querySelector('#e-desc').value.trim() };
          const f = w.querySelector('#e-cover').files[0];
          if (f) body.cover = await resizeImage(f);
          if (w.querySelector('#e-rmcover')?.checked) body.cover = null;
          return body;
        },
      },
    ],
  });
  if (!v || v === 'Annuler') return;
  await updatePlaylist(p.id, v);
}

function resizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 400;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 400, 400);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.src = URL.createObjectURL(file);
  });
}

// Monter / descendre une playlist d'une position (au sein des épinglées ou des autres)
// Monte / descend d'un cran : parmi la racine (dossiers compris) ou parmi les playlists de son dossier
function stepPlaylist(id, dir) {
  const p = state.library.playlists.find((x) => x.id === id);
  const fid = folderOf(p);
  if (!fid) return moveRoot({ kind: 'playlist', id }, { step: dir });
  const sib = state.library.playlists.filter((x) => folderOf(x) === fid);
  const j = sib.indexOf(p) + dir;
  if (j < 0 || j >= sib.length) return;
  movePlaylist(id, dir < 0 ? { before: sib[j].id } : j + 1 < sib.length ? { before: sib[j + 1].id } : { edge: 'bottom' });
}

export function playlistMenu(p, x, y) {
  contextMenu(x, y, [
    { label: "Ajouter à la file d'attente", icon: 'addQueue', action: () => p.tracks.length && ctl.addToQueue(p.tracks) },
    { label: 'Compléter avec l’IA', icon: 'sparkle', action: () => (location.hash = `#/ai?playlist=${p.id}`) },
    { label: 'Modifier les informations', icon: 'edit', action: () => editPlaylist(p) },
    { label: p.pinned ? 'Désépingler' : 'Épingler en haut de la bibliothèque', icon: 'pin', action: () => updatePlaylist(p.id, { pinned: !p.pinned }).then(() => toast(p.pinned ? 'Playlist désépinglée' : 'Playlist épinglée')) },
    { label: 'Déplacer', icon: 'library', submenu: [
      { label: 'Tout en haut', action: () => movePlaylist(p.id, { edge: 'top' }) },
      { label: 'Monter d’un cran', action: () => stepPlaylist(p.id, -1) },
      { label: 'Descendre d’un cran', action: () => stepPlaylist(p.id, 1) },
      { label: 'Tout en bas', action: () => movePlaylist(p.id, { edge: 'bottom' }) },
    ] },
    { label: 'Déplacer vers un dossier', icon: 'folder', submenu: () => [
      { label: 'Nouveau dossier', icon: 'plus', action: () => newFolder(p.id) },
      ...(state.library.folders || []).map((f) => ({ label: f.name, icon: p.folderId === f.id ? 'check' : null, action: () => movePlaylistToFolder(p.id, f.id).then(() => toast(`Déplacée dans « ${f.name} »`)) })),
      p.folderId && { sep: true },
      p.folderId && { label: 'Retirer du dossier', icon: 'close', action: () => movePlaylistToFolder(p.id, null) },
    ] },
    !canSync(p) && { label: 'Mettre à jour depuis Spotify…', icon: 'sync', action: () => linkSource(p) },
    canSync(p) && { label: p.sync ? `Synchronisée avec ${p.source.platform || 'la source'}` : `Synchroniser avec ${p.source.platform || 'la source'}`, icon: p.sync ? 'check' : 'sync', submenu: () => [
      { label: p.sync ? 'Désactiver la synchronisation' : 'Activer : ajouter tout seul les nouveaux titres', icon: p.sync ? 'close' : 'check', action: () => setPlaylistSync(p, !p.sync) },
      p.sync && { label: 'Mettre à jour maintenant', icon: 'sync', action: () => syncPlaylistNow(p).catch((e) => toast('Synchronisation impossible : ' + e.message)) },
      { label: 'Changer le lien de la playlist', icon: 'edit', action: () => linkSource(p) },
    ] },
    { label: 'Chercher les doublons', icon: 'copy', action: () => findDuplicates(p) },
    { label: 'Dupliquer', icon: 'plus', action: async () => (await createPlaylist(`${p.name} (copie)`, p.tracks, p.description), toast('Playlist dupliquée')) },
    { label: 'Ajouter à une autre playlist…', icon: 'library', action: () => openPlaylistPicker(p.tracks, { x, y: y + 300 }) },
    ...playlistShareItems(p),
    p.tracks.length && { label: 'Envoyer à un ami Boombox…', icon: 'send', action: () => sendToFriend({ playlist: p }, { x, y }) },
    { label: 'Partager avec un code', icon: 'users', action: () => shareDialog(p) },
    { label: 'Exporter (texte)', icon: 'import', action: () => exportText(p) },
    { sep: true },
    {
      label: 'Supprimer',
      icon: 'trash',
      danger: true,
      action: async () => {
        await deletePlaylist(p.id);
        if (location.hash.includes(p.id)) location.hash = '#/';
        toast(`« ${p.name} » est dans la corbeille (30 jours)`, { action: 'Annuler', onAction: () => restorePlaylist(p.id), timeout: 6000 });
      },
    },
  ]);
}

async function shareDialog(p) {
  if (!p.tracks.length) return toast('Playlist vide');
  let code;
  try {
    code = await sharePlaylist(p);
  } catch (e) {
    return toast(/permission/i.test(e.code || e.message) ? 'Mets à jour les règles Firebase (firestore.rules) pour activer le partage' : e.message);
  }
  const text = `Écoute ma playlist « ${p.name} » sur Boombox : code ${code} (Importer une playlist → coller le code)`;
  modal({
    title: 'Partager la playlist',
    body: String(html`<p class="muted">Envoie ce code à ton ami : dans Boombox, il va dans <b>Importer une playlist</b> et colle le code. Il aura sa propre copie (${plural(p.tracks.length, 'titre')}, image et description comprises).</p>
      <div class="share-code">${code}</div>`),
    actions: [{ label: 'Fermer' }, { label: 'Copier le message', primary: true, value: () => navigator.clipboard.writeText(text).then(() => toast('Message copié')) }],
  });
}

function exportText(p) {
  const text = p.tracks.map((t) => `${(t.artists || []).map((a) => a.name).join(', ')} - ${t.title}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${p.name}.txt` });
  a.click();
}

// ======================= DOSSIERS =======================
export async function newFolder(playlistId = null) {
  const name = await promptText('Nouveau dossier', { placeholder: 'Ex. : Rap, Soirées, Sport…', label: 'Créer' });
  if (!name) return;
  const id = await createFolder(name);
  if (playlistId) await movePlaylistToFolder(playlistId, id);
  ls.set('boombox.openFolders', [...ls.get('boombox.openFolders', []), id]);
  toast(`Dossier « ${name} » créé`);
}

export function folderMenu(id, x, y) {
  const f = (state.library.folders || []).find((x) => x.id === id);
  if (!f) return;
  contextMenu(x, y, [
    { label: 'Ouvrir', icon: 'folder', action: () => (location.hash = `#/folder/${id}`) },
    { label: 'Renommer', icon: 'edit', action: async () => { const n = await promptText('Renommer le dossier', { value: f.name }); if (n) renameFolder(id, n); } },
    { label: 'Déplacer', icon: 'library', submenu: [
      { label: 'Tout en haut', action: () => moveRoot({ kind: 'folder', id }, { edge: 'top' }) },
      { label: 'Monter d’un cran', action: () => moveRoot({ kind: 'folder', id }, { step: -1 }) },
      { label: 'Descendre d’un cran', action: () => moveRoot({ kind: 'folder', id }, { step: 1 }) },
      { label: 'Tout en bas', action: () => moveRoot({ kind: 'folder', id }, { edge: 'bottom' }) },
    ] },
    { sep: true },
    { label: 'Supprimer le dossier', icon: 'trash', danger: true, action: async () => {
      if (await confirmBox('Supprimer le dossier ?', `Les playlists de « ${f.name} » ne sont pas supprimées : elles reviennent dans ta bibliothèque.`)) deleteFolder(id);
    } },
  ]);
}

export async function folderPage(el, { id }) {
  const render = () => {
    const f = (state.library.folders || []).find((x) => x.id === id);
    if (!f) return (el.innerHTML = '<div class="page"><div class="empty"><h2>Dossier introuvable</h2></div></div>');
    const pls = state.library.playlists.filter((p) => p.folderId === id);
    el.innerHTML = String(html`<div class="page">
      <div class="row-flex" style="margin-bottom:20px"><div class="cover folder-cover" style="width:72px;height:72px">${icon('folder')}</div>
        <div><div class="muted" style="font-size:13px">Dossier</div><h1 style="font-size:36px">${f.name}</h1><div class="muted">${plural(pls.length, 'playlist')}</div></div>
        <button class="act-btn" id="fd-more" style="margin-left:auto">${icon('more')}</button></div>
      ${pls.length ? html`<div class="cards">${pls.map((p) => card({ ...p, type: 'local', coverHtml: playlistCover(p) }, { sub: plural(p.tracks.length, 'titre') }))}</div>` : html`<p class="muted">Dossier vide. Dans le menu ⋯ d'une playlist : « Déplacer vers un dossier ».</p>`}
    </div>`);
    el.querySelector('#fd-more').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); folderMenu(id, r.left - 160, r.bottom); };
  };
  render();
  return { onLibrary: render };
}

// ======================= ALBUM =======================
export async function album(el, { id }, ctx) {
  el.innerHTML = String(loading);
  let a;
  try {
    a = await api(`/api/album/${id}`);
  } catch (e) {
    el.innerHTML = String(errorBox(e));
    return;
  }
  if (!ctx.alive()) return;
  const actx = { type: 'album', id, name: a.title };
  const total = a.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  el.innerHTML = String(html`
    <div class="hero">${cover(a, '', 544)}
      <div class="hero-info"><span class="hero-type">${a.kind}</span><h1>${a.title}</h1>
      <div class="hero-meta"><b>${artistLinks(a)}</b>${a.year ? html`<span class="sep"></span><span>${a.year}</span>` : ''}<span class="sep"></span><span>${plural(a.tracks.length, 'titre')}</span>${total ? html`<span>, ${fmtTotal(total)}</span>` : ''}</div></div>
    </div>
    <div class="page-body">
      <div class="actions">
        <button class="big-play" data-playall>${playAllIcon(actx)}</button>${shuffleBtn()}
        <button class="act-btn" id="al-save" title="Enregistrer comme playlist">${icon('plus')}</button>
        <button class="act-btn" id="al-more">${icon('more')}</button>
      </div>
      ${trackList(a.tracks, { context: actx, album: false, coverArt: false })}
    </div>`);
  heroColor(el, a.thumb);
  wireListActions(el, () => a.tracks, actx);
  const save = async () => {
    const p = await createPlaylist(a.title, a.tracks, `${a.kind} de ${(a.artists || []).map((x) => x.name).join(', ')}${a.year ? ' (' + a.year + ')' : ''}`);
    toast(`Enregistré dans ta bibliothèque`, { action: 'Voir', onAction: () => (location.hash = `#/playlist/${p.id}`) });
  };
  el.querySelector('#al-save').onclick = save;
  el.querySelector('#al-more').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.bottom, [
      { label: "Ajouter à la file d'attente", icon: 'addQueue', action: () => ctl.addToQueue(a.tracks) },
      { label: 'Ajouter à une playlist…', icon: 'plus', action: () => openPlaylistPicker(a.tracks, { x: r.left + 150, y: r.bottom + 300 }) },
      { label: 'Enregistrer comme playlist', icon: 'library', action: save },
      ...(a.artists || []).filter((x) => x.id).map((x) => ({ label: `Aller à ${x.name}`, icon: 'person', action: () => (location.hash = `#/artist/${x.id}`) })),
    ]);
  };
}

// ======================= PLAYLIST YOUTUBE =======================
export async function ytplaylist(el, { id }, ctx) {
  el.innerHTML = String(loading);
  let p;
  try {
    p = await api(`/api/ytplaylist/${id}`);
  } catch (e) {
    el.innerHTML = String(errorBox(e));
    return;
  }
  if (!ctx.alive()) return;
  const pctx = { type: 'ytplaylist', id, name: p.title };
  el.innerHTML = String(html`
    <div class="hero">${cover(p, '', 544)}
      <div class="hero-info"><span class="hero-type">Playlist publique</span><h1>${p.title}</h1>
      <div class="hero-meta"><b>${p.author || 'YouTube'}</b><span class="sep"></span><span>${plural(p.tracks.length, 'titre')}</span></div></div>
    </div>
    <div class="page-body">
      <div class="actions">
        <button class="big-play" data-playall>${playAllIcon(pctx)}</button>${shuffleBtn()}
        <button class="outline-btn" id="pl-save">Enregistrer dans ma bibliothèque</button>
      </div>
      ${trackList(p.tracks, { context: pctx })}
    </div>`);
  heroColor(el, p.thumb);
  wireListActions(el, () => p.tracks, pctx);
  el.querySelector('#pl-save').onclick = async () => {
    const np = await createPlaylist(p.title, p.tracks);
    toast('Playlist enregistrée', { action: 'Voir', onAction: () => (location.hash = `#/playlist/${np.id}`) });
  };
}

// ======================= ARTISTE =======================
export async function artist(el, { id }, ctx) {
  el.innerHTML = String(loading);
  let a;
  try {
    a = await api(`/api/artist/${id}`);
  } catch (e) {
    el.innerHTML = String(errorBox(e));
    return;
  }
  if (!ctx.alive()) return;
  const actx = { type: 'artist', id, name: a.name };
  let showAll = false;
  const render = () => {
    const following = isFollowing(id);
    rememberTracks(a.topTracks);
    el.innerHTML = String(html`
      <div class="hero artist ${a.banner ? 'has-banner' : ''}" style="${a.banner || a.thumb ? `background-image:url('${esc(a.banner || a.thumb)}')` : ''}">
        ${cover(a, 'round', 544)}
        <div class="hero-info"><span class="hero-type">Artiste</span><h1>${a.name}</h1>
        ${a.monthlyListeners ? html`<div class="hero-meta" title="Auditeurs sur Spotify ces 28 derniers jours">${a.monthlyListeners.toLocaleString('fr-FR')} auditeurs mensuels</div>` : a.subscribers ? html`<div class="hero-meta">${a.subscribers}</div>` : ''}</div>
      </div>
      <div class="page-body">
        <div class="actions">
          <button class="big-play" data-playall>${playAllIcon(actx)}</button>${shuffleBtn()}
          <button class="outline-btn" id="follow">${following ? 'Abonné' : "S'abonner"}</button>
          <button class="act-btn" id="ar-more">${icon('more')}</button>
          <a class="outline-btn" href="#/discography/${id}">Voir la discographie</a>
        </div>
        ${a.topTracks.length ? html`<section class="section"><div class="section-head"><h2>Populaires</h2></div>
          ${trackList(showAll ? a.topTracks : a.topTracks.slice(0, 5), { context: actx, plays: true })}
          ${a.topTracks.length > 5 ? html`<button class="more muted" id="toggle-all" style="padding:12px 16px;font-weight:700">${showAll ? 'Moins' : 'Plus'}</button>` : ''}</section>` : ''}
        ${a.concerts?.length ? html`<section class="section"><div class="section-head"><h2>Concerts</h2><a href="#/concerts">Près de chez toi</a></div><div class="concert-list">${a.concerts.slice(0, 6).map((c) => concertCard({ ...c, artist: a.name }, ls.get('boombox.geo', null)))}</div></section>` : ''}
        ${a.sections.map((s) => raw(section(s.title, s.items.map((i) => card(i)))))}
        ${a.description ? html`<section class="section"><div class="section-head"><h2>À propos</h2></div><div class="np-card" style="max-width:800px;white-space:pre-line">${a.description}</div></section>` : ''}
      </div>`);
    for (const s of a.sections) rememberTracks(s.items.filter((i) => i.type === 'song' || i.type === 'video'));
    heroColor(el, a.thumb);
    wireListActions(el, () => a.topTracks, actx);
    el.querySelector('#follow').onclick = () => toggleFollow(a);
    el.querySelector('#toggle-all')?.addEventListener('click', () => ((showAll = !showAll), render()));
    el.querySelector('#ar-more').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.left, r.bottom, [
        { label: following ? 'Se désabonner' : "S'abonner", icon: 'bell', action: () => toggleFollow(a) },
        a.topTracks[0] && { label: "Radio de l'artiste", icon: 'radio', action: () => ctl.playRadio(a.topTracks[0]) },
        { label: "Ajouter les titres populaires à la file", icon: 'addQueue', action: () => ctl.addToQueue(a.topTracks) },
      ]);
    };
  };
  render();
  // Chiffres exacts de Spotify récupérés en arrière-plan par le serveur : on rafraîchit jusqu'à les avoir
  let tries = 0;
  const refresh = () => {
    if (!a.statsPending || tries++ >= 5) return;
    setTimeout(async () => {
      const b = await api(`/api/artist/${id}`).catch(() => null);
      if (!b || !ctx.alive()) return;
      a = { ...a, topTracks: b.topTracks.length ? b.topTracks : a.topTracks, subscribers: b.subscribers || a.subscribers, monthlyListeners: b.monthlyListeners, statsPending: b.statsPending, thumb: b.thumb || a.thumb, banner: b.banner || a.banner, description: b.description || a.description, concerts: b.concerts || a.concerts };
      render();
      refresh();
    }, 4000);
  };
  refresh();
  return { onLibrary: render };
}

// ======================= DISCOGRAPHIE =======================
// Tous les albums, singles et EP de l'artiste depuis ses débuts, et ses apparitions, du plus récent au plus ancien.
export async function discography(el, { id }, ctx) {
  el.innerHTML = String(loading);
  let d;
  try {
    d = await api(`/api/discography/${id}`);
  } catch (e) {
    el.innerHTML = String(errorBox(e));
    return;
  }
  if (!ctx.alive()) return;
  let group = 'all';
  const groups = [['all', 'Tout'], ['album', 'Albums'], ['single', 'Singles et EP'], ['feat', 'Apparitions']].filter(([g]) => g === 'all' || d.items.some((x) => x.group === g));
  const shown = () => d.items.filter((x) => group === 'all' || x.group === group);
  const render = () => {
    el.innerHTML = String(html`<div class="page">
      <div class="section-head"><h1>Discographie${d.name ? html` de ${d.name}` : ''}</h1><a class="outline-btn" href="#/artist/${id}">Retour à l'artiste</a></div>
      <div class="actions" style="padding:0 0 12px">
        <button class="btn white" data-all="new">${icon('play')} Tout écouter, du plus récent</button>
        <button class="btn ghost" data-all="old">${icon('play')} Tout écouter, du plus ancien</button>
      </div>
      <div class="row-flex" style="flex-wrap:wrap;gap:8px;margin-bottom:16px">${groups.map(([g, l]) => html`<button class="chip ${g === group ? 'active' : ''}" data-g="${g}">${l}</button>`)}</div>
      ${shown().length ? html`<div class="cards">${shown().map((i) => card(i, { sub: [i.year, i.group === 'feat' ? 'Apparition' : i.kind].filter(Boolean).join(' · ') }))}</div>` : html`<div class="empty"><h2>Rien à afficher</h2></div>`}
    </div>`);
    el.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => ((group = b.dataset.g), render())));
    el.querySelectorAll('[data-all]').forEach((b) => (b.onclick = () => playAll(b.dataset.all === 'old')));
  };
  // Lance le premier album tout de suite, puis ajoute les suivants à la file au fur et à mesure
  const playAll = async (oldFirst) => {
    const list = shown().slice();
    if (oldFirst) list.reverse();
    if (!list.length) return;
    toast('Chargement de la discographie…');
    const pctx = { type: 'discography', id, name: `Discographie de ${d.name || "l'artiste"}` };
    let started = false;
    for (const alb of list) {
      const a = await api(`/api/album/${alb.id}`).catch(() => null);
      const tracks = a?.tracks || [];
      if (!tracks.length) continue;
      rememberTracks(tracks);
      if (!started) ctl.playList(tracks, 0, pctx), (started = true);
      else ctl.addToQueue(tracks);
    }
  };
  render();
}

// ======================= CORBEILLE =======================
// Playlists supprimées depuis moins de 30 jours : on peut les restaurer ou les supprimer définitivement.
export async function trash(el) {
  const render = () => {
    const items = state.library.trash || [];
    const left = (p) => Math.max(1, Math.ceil((p.deletedAt + TRASH_DAYS * 86400e3 - Date.now()) / 86400e3));
    el.innerHTML = String(html`<div class="page" style="max-width:900px">
      <div class="row-flex" style="justify-content:space-between"><h1>Corbeille</h1>${items.length ? html`<button class="btn ghost" id="tr-empty">Vider la corbeille</button>` : ''}</div>
      <p class="muted">Les playlists supprimées restent ici ${TRASH_DAYS} jours, puis disparaissent pour de bon.</p>
      ${items.length ? html`<div class="trash-list">${items.map((p) => html`<div class="trash-row">${playlistCover(p, '', 96)}<div class="t-text"><b class="ellipsis">${p.name}</b><span class="muted">${plural(p.tracks.length, 'titre')} · supprimée ${fmtAgoShort(p.deletedAt)} · encore ${plural(left(p), 'jour')}</span></div>
        <button class="btn white" data-restore="${p.id}">Restaurer</button><button class="icon-btn" data-purge="${p.id}" title="Supprimer définitivement">${icon('trash')}</button></div>`)}</div>` : html`<div class="empty">${icon('trash')}<h2>La corbeille est vide</h2></div>`}
    </div>`);
    el.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => (await restorePlaylist(b.dataset.restore), toast('Playlist restaurée'))));
    el.querySelectorAll('[data-purge]').forEach((b) => (b.onclick = async () => {
      if (await confirmBox('Supprimer définitivement ?', 'Cette playlist ne pourra plus être récupérée.')) purgePlaylist(b.dataset.purge);
    }));
    el.querySelector('#tr-empty')?.addEventListener('click', async () => {
      if (await confirmBox('Vider la corbeille ?', `${plural(items.length, 'playlist')} seront supprimées définitivement.`)) items.forEach((p) => purgePlaylist(p.id));
    });
  };
  render();
  return { onLibrary: render };
}
const fmtAgoShort = (ts) => {
  const d = Math.floor((Date.now() - ts) / 86400e3);
  return d < 1 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d} jours`;
};

// ======================= NOUVEAUTÉS =======================
export async function releases(el, _p, ctx) {
  const follows = state.library.follows;
  if (!follows.length) {
    el.innerHTML = String(html`<div class="page"><div class="empty">${icon('bell')}<h2>Suis tes artistes préférés</h2>
      <p>Abonne-toi à des artistes (bouton « S'abonner » sur leur page) pour voir ici leurs dernières sorties.</p>
      <div class="search-box" style="margin:24px auto;max-width:420px"><input id="artist-q" placeholder="Rechercher un artiste…"></div><div id="artist-res"></div>
      <button class="btn white" id="bulk-follow">S'abonner à une liste d'artistes</button></div></div>`);
    el.querySelector('#bulk-follow').onclick = () => bulkFollow(() => releases(el, _p, ctx));
    artistQuickSearch(el, ctx);
    return;
  }
  el.innerHTML = String(html`<div class="page"><div class="section-head"><h2>Nouveautés de tes artistes</h2><div class="row-flex"><a class="outline-btn" href="#/concerts">Concerts près de chez toi</a><button class="outline-btn" id="bulk-follow">+ Liste d'artistes</button><button class="outline-btn" id="mark-seen">Tout marquer comme vu</button></div></div><div id="rel">${loading}</div>
    <section class="section" style="margin-top:32px"><div class="section-head"><h2>Artistes suivis (${follows.length})</h2></div>
      <div class="search-box" style="margin:0 0 16px;max-width:420px"><input id="artist-q" placeholder="Ajouter un artiste…"></div><div id="artist-res"></div>
      <div class="cards">${follows.map((f) => card({ ...f, type: 'artist' }, { sub: 'Suivi' }))}</div></section></div>`);
  artistQuickSearch(el, ctx);
  el.querySelector('#bulk-follow').onclick = () => bulkFollow(() => releases(el, _p, ctx));
  let data;
  try {
    data = await fetchReleases();
  } catch (e) {
    el.querySelector('#rel').innerHTML = String(html`<p class="muted">${e.message}</p>`);
    return;
  }
  if (!ctx.alive()) return;
  state.newReleases = data.newCount;
  emit('releases', data.newCount);
  // Date exacte (données Spotify) : « aujourd'hui », « il y a 3 j », sinon le jour ; à défaut l'année
  const releaseWhen = (r) => {
    if (!r.date) return r.year ? ` • ${r.year}` : '';
    const days = Math.floor((Date.now() - Date.parse(r.date)) / 86400e3);
    if (days <= 0) return " • aujourd'hui";
    if (days === 1) return ' • hier';
    if (days < 7) return ` • il y a ${days} j`;
    return ` • ${new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })}`;
  };
  // Seulement les 2 derniers mois, de la plus récente à la plus ancienne, rangées par période
  const DAY = 86400e3;
  const ageOf = (r) => (r.date ? (Date.now() - Date.parse(r.date)) / DAY : null);
  const recentList = data.releases
    .filter((r) => {
      const a = ageOf(r);
      return a != null ? a <= 62 : r.isNew && Number(r.year) === new Date().getFullYear();
    })
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0));
  const groups = [
    ['Cette semaine', (a) => a < 7],
    ['Ce mois-ci', (a) => a >= 7 && a < 31],
    ['Le mois dernier', (a) => a >= 31],
  ];
  const block = (title, list) =>
    list.length ? html`<h3 style="margin:8px 0 12px;font-size:18px">${title} <span class="muted" style="font-size:14px;font-weight:500">· ${plural(list.length, 'sortie')}</span></h3><div class="cards" style="margin-bottom:24px">${list.map((r) => card(r, { sub: `${r.artist.name} • ${r.kind}${releaseWhen(r)}`, isNew: r.isNew }))}</div>` : '';
  const fresh = recentList.filter((r) => r.isNew).length;
  el.querySelector('#rel').innerHTML = String(html`
    <p class="muted" style="margin:0 0 16px">${fresh ? html`🔔 <b>${plural(fresh, 'nouvelle sortie')}</b> depuis ta dernière visite (marquées « nouveau »). ` : ''}Sorties des 2 derniers mois, de la plus récente à la plus ancienne.</p>
    ${recentList.length ? groups.map(([t, test]) => block(t, recentList.filter((r) => test(ageOf(r) ?? 0)))) : html`<p class="muted">Aucune sortie de tes artistes ces 2 derniers mois.</p>`}
    <section class="section" style="margin-top:24px"><div class="section-head"><h2>Nouvelles sorties à découvrir</h2><span class="muted">Artistes que tu ne suis pas</span></div><div id="rel-discover">${loading}</div></section>`);
  api('/api/new-releases').then((list) => {
    const box = el.querySelector('#rel-discover');
    if (!box) return;
    const followed = new Set(state.library.follows.map((f) => f.id));
    const items = list.filter((r) => !(r.artists || []).some((a) => followed.has(a.id))).slice(0, 30);
    box.innerHTML = items.length ? String(html`<div class="cards">${items.map((r) => card(r))}</div>`) : '<p class="muted">Rien à proposer pour l’instant.</p>';
  }).catch(() => el.querySelector('#rel-discover') && (el.querySelector('#rel-discover').innerHTML = '<p class="muted">Indisponible pour le moment.</p>'));
  el.querySelector('#mark-seen').onclick = async () => {
    await setKnownReleases(data.current);
    toast('Marqué comme vu');
    releases(el, _p, ctx);
  };
}

// Dernières sorties des artistes suivis (calculées par le serveur local à partir de YouTube Music).
// Les sorties absentes lors du dernier passage sont marquées « nouveau ».
let releasesCache = null;
export async function fetchReleases() {
  const follows = state.library.follows.map((f) => ({ id: f.id, name: f.name, known: f.known || null }));
  const data = await api('/api/releases', { method: 'POST', body: { follows } });
  const firstSeen = Object.fromEntries(Object.entries(data.current).filter(([id]) => !follows.find((f) => f.id === id)?.known));
  if (Object.keys(firstSeen).length) setKnownReleases(firstSeen).catch(() => {});
  if (data.thumbs) setFollowThumbs(data.thumbs).catch(() => {});
  releasesCache = data;
  return data;
}

// S'abonner d'un coup à une liste d'artistes collée (un par ligne, ou séparés par des virgules)
export async function bulkFollow(done, preset = null) {
  const text = preset ?? await promptText(`S'abonner à une liste d'artistes`, { multiline: true, label: 'Rechercher et s’abonner', placeholder: 'Un artiste par ligne :\nAngèle\nStromae\nDamso…' });
  if (!text) return;
  // Accepte aussi un copier-coller brut de la page « Abonnements » de Spotify : on ignore ses libellés
  const LABELS = /^(artiste|artist|profil|profile|abonnements?|following|suivi|s'abonner|follow|playlist|tout afficher|show all|\d+\s*(abonn|follow).*)$/i;
  const names = [...new Set(text.split(/[\n,;]+/).map((s) => s.replace(/^[\s\-•*\d.)]+/, '').trim()).filter((s) => s && !LABELS.test(s)))].slice(0, 500);
  toast(`Recherche de ${plural(names.length, 'artiste')}…`, { timeout: 6000 });
  const job = await api('/api/match', { method: 'POST', body: { items: names.map((name) => ({ name })), kind: 'artist' } });
  let j;
  do {
    await new Promise((r) => setTimeout(r, 1000));
    j = await api(`/api/import/${job.id}`);
  } while (j.status !== 'done');
  const found = j.results.filter(Boolean);
  const missing = names.filter((_, i) => !j.results[i]);
  const n = await followMany(found);
  await modal({
    title: 'Abonnements ajoutés',
    body: String(html`<p><b>${plural(n, 'nouvel abonnement')}</b>${found.length - n ? ` (${found.length - n} déjà suivi${found.length - n > 1 ? 's' : ''})` : ''}.</p>${missing.length ? html`<p class="muted">Introuvables sur YouTube Music : ${missing.join(', ')}</p>` : ''}`),
    actions: [{ label: 'OK', primary: true }],
  });
  done?.();
}

function artistQuickSearch(el, ctx) {
  const input = el.querySelector('#artist-q');
  const out = el.querySelector('#artist-res');
  input?.addEventListener(
    'input',
    debounce(async () => {
      const q = input.value.trim();
      if (!q) return (out.innerHTML = '');
      const { items } = await api(`/api/search?q=${encodeURIComponent(q)}&type=artist`);
      if (!ctx.alive()) return;
      out.innerHTML = String(html`<div class="cards" style="margin-bottom:24px">${items.slice(0, 6).map((a) => html`<div class="card" data-href="#/artist/${a.id}">${cover(a, 'round')}<div class="card-title">${a.name}</div><button class="outline-btn" style="margin-top:8px" data-follow="${a.id}">${isFollowing(a.id) ? 'Abonné' : "S'abonner"}</button></div>`)}</div>`);
      out.querySelectorAll('[data-follow]').forEach((b) => {
        b.onclick = async (e) => {
          e.stopPropagation();
          const a = items.find((x) => x.id === b.dataset.follow);
          await toggleFollow(a);
          b.textContent = isFollowing(a.id) ? 'Abonné' : "S'abonner";
        };
      });
    }, 300),
  );
}

// ======================= BIBLIOTHÈQUE (vue pleine page, surtout mobile) =======================
export async function library(el) {
  let reorder = false;
  const render = () => {
    const lib = state.library;
    // Dossiers et playlists dans l'ordre perso (le même que la bibliothèque du PC)
    const entries = rootEntries().map((e) => (e.kind === 'folder' ? { e, f: lib.folders.find((x) => x.id === e.id) } : { e, p: lib.playlists.find((x) => x.id === e.id) })).filter((x) => x.f || x.p);
    el.innerHTML = String(html`<div class="page">
      <div class="section-head"><h2>Ta bibliothèque</h2>
        <div class="row-flex"><button class="chip ${reorder ? 'active' : ''}" id="lib-reorder">${reorder ? 'Terminé' : 'Réorganiser'}</button><a class="icon-btn" href="#/import" title="Importer">${icon('import')}</a><button class="icon-btn" id="lib-new" title="Créer une playlist">${icon('plus')}</button></div></div>
      ${reorder
        ? html`<p class="muted" style="margin-top:-4px;font-size:13px">Fais glisser la poignée ⋮⋮ pour changer l'ordre.</p><ul class="reorder-list" id="reorder-list">${entries.map(({ e, f, p }) => html`<li class="ro-item" data-kind="${e.kind}" data-id="${e.id}">${f ? html`<div class="cover folder-cover">${icon('folder')}</div>` : playlistCover(p, '', 96)}<div class="t-text"><span class="t-title ellipsis">${f ? f.name : p.name}</span><span class="t-artists muted">${f ? 'Dossier' : `Playlist • ${plural(p.tracks.length, 'titre')}`}${e.pinned ? ' • épinglée' : ''}</span></div><span class="ro-grip" aria-label="Déplacer">⋮⋮</span></li>`)}</ul>`
        : html`<div class="cards">
        ${card({ name: 'Titres likés', type: 'local-liked', coverHtml: likedCover() }, { sub: plural(lib.liked.length, 'titre'), href: '#/liked', play: 'liked' })}
        ${entries.map(({ f, p }) => (f
          ? card({ name: f.name, type: 'folder', coverHtml: html`<div class="cover folder-cover">${icon('folder')}</div>` }, { sub: `Dossier • ${plural(lib.playlists.filter((x) => x.folderId === f.id).length, 'playlist')}`, href: `#/folder/${f.id}`, play: '' })
          : card({ ...p, type: 'local', coverHtml: playlistCover(p) }, { sub: `Playlist • ${plural(p.tracks.length, 'titre')}` })))}
        ${lib.follows.map((f) => card({ ...f, type: 'artist' }))}
      </div>`}
      <div class="row-flex" style="margin-top:32px;gap:8px"><a class="chip" href="#/history">Historique</a><a class="chip" href="#/stats">Ton récap</a><a class="chip" href="#/jam">Jam</a><a class="chip" href="#/settings">Paramètres</a></div>
    </div>`);
    el.querySelector('#lib-new').onclick = async () => {
      const name = await promptText('Nouvelle playlist', { label: 'Créer', placeholder: 'Ma playlist' });
      if (name) location.hash = `#/playlist/${(await createPlaylist(name)).id}`;
    };
    el.querySelector('#lib-reorder').onclick = () => ((reorder = !reorder), render());
    if (reorder) wireReorder(el.querySelector('#reorder-list'));
  };
  // Glisser-déposer au doigt (ou à la souris) par la poignée : l'élément suit le doigt, les autres s'écartent
  function wireReorder(list) {
    list.querySelectorAll('.ro-grip').forEach((grip) => {
      grip.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const li = grip.closest('.ro-item');
        const items = [...list.children];
        const h = li.getBoundingClientRect().height + 6;
        const start = ev.clientY;
        let to = items.indexOf(li);
        const from = to;
        li.classList.add('ro-drag');
        grip.setPointerCapture(ev.pointerId);
        const move = (e) => {
          const dy = e.clientY - start;
          li.style.transform = `translateY(${dy}px)`;
          to = Math.max(0, Math.min(items.length - 1, from + Math.round(dy / h)));
          items.forEach((x, i) => {
            if (x === li) return;
            x.style.transform = from < to && i > from && i <= to ? `translateY(${-h}px)` : from > to && i < from && i >= to ? `translateY(${h}px)` : '';
          });
        };
        const up = async () => {
          grip.removeEventListener('pointermove', move);
          grip.removeEventListener('pointerup', up);
          grip.removeEventListener('pointercancel', up);
          items.forEach((x) => (x.style.transform = ''));
          li.classList.remove('ro-drag');
          if (to === from) return;
          const me = { kind: li.dataset.kind, id: li.dataset.id };
          const rest = items.filter((x) => x !== li);
          const target = rest[to];
          if (!target) await moveRoot(me, { edge: 'bottom' });
          else if (me.kind === 'playlist' && target.dataset.kind === 'playlist') await movePlaylist(me.id, { before: target.dataset.id });
          else await moveRoot(me, { before: { kind: target.dataset.kind, id: target.dataset.id } });
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
      });
    });
  }
  render();
  return { onLibrary: () => !document.querySelector('.ro-drag') && render() };
}
