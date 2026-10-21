// Assistant IA : crée des playlists sur mesure, complète une playlist existante, recommande des artistes.
import { pixelBackdrop, accentPalette } from './pixel-bg.js';
import { html, raw, icon, plural, toast, esc } from './ui.js';
import { state, api, createPlaylist, addToPlaylist, getHistory, getImported, toggleFollow, isFollowing, likeAllPlaylistTracks, isLiked } from './state.js';
import { ctl, startAt } from './player.js';
import { trackList, cover } from './components.js';

// La conversation reste en mémoire tant que l'appli est ouverte (on peut changer de page et revenir).
const convo = { messages: [], results: [], target: 'new' };

const SUGGESTIONS_NEW = [
  'Mets tous les sons de mes playlists dans mes titres likés',
  'Une playlist de 25 titres pour courir',
  'Du rap français chill pour réviser',
  'Les tubes des années 2000 qu’on connaît tous',
  'Une playlist pour une soirée entre potes',
  'Fais-moi découvrir des artistes proches de mes préférés',
];
const SUGGESTIONS_PL = ['Ajoute 10 titres dans le même style', 'Ajoute des sons plus énergiques', 'Ajoute des titres plus récents', 'Ajoute des pépites peu connues dans cette ambiance'];

async function topArtists() {
  const count = new Map();
  const add = (t, w) => {
    const n = t.artists?.[0]?.name;
    if (n) count.set(n, (count.get(n) || 0) + w);
  };
  state.library.liked.forEach((t) => add(t, 2));
  (await getHistory(300).catch(() => [])).forEach((t) => add(t, 1));
  // Historique Spotify importé (écoutes des 12 derniers mois)
  (await getImported().catch(() => [])).forEach((e) => {
    const n = Object.entries(e.b || {}).filter(([k]) => Date.parse(k.length === 7 ? k + '-01' : k) > Date.now() - 365 * 86400e3).reduce((s, [, c]) => s + c, 0);
    if (n) add(e, n / 3);
  });
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n]) => n);
}

export async function aiPage(el, params) {
  if (params.playlist) convo.target = params.playlist;
  if (convo.target !== 'new' && !state.library.playlists.some((p) => p.id === convo.target)) convo.target = 'new';
  const targetPl = () => state.library.playlists.find((p) => p.id === convo.target);

  const render = () => {
    const pl = targetPl();
    el.innerHTML = String(html`<div class="page ai-page">
      <div class="ai-head ai-hero"><img class="ai-badge" src="/assets/cover-ai-mix.png" alt=""><div><h1>Assistant IA</h1><p class="muted">Décris ce que tu veux écouter, l'IA s'occupe du reste.</p></div></div>
      <div class="row-flex ai-target"><span class="muted">Pour :</span>
        <select class="input" id="ai-target" style="width:auto">
          <option value="new">Une nouvelle playlist</option>
          ${state.library.playlists.map((p) => html`<option value="${p.id}" ${p.id === convo.target ? raw('selected') : ''}>Compléter « ${p.name} »</option>`)}
        </select>
        ${convo.messages.length ? html`<button class="more muted" id="ai-reset" style="margin-left:auto">Nouvelle conversation</button>` : ''}
      </div>
      <div id="ai-chat" class="ai-chat">
        ${!convo.messages.length ? html`<div class="ai-suggest">${(pl ? SUGGESTIONS_PL : SUGGESTIONS_NEW).map((s) => html`<button class="chip" data-suggest="${s}">${s}</button>`)}</div>` : ''}
        ${convo.messages.map((m, i) => (m.role === 'user' ? html`<div class="bubble me">${m.text}</div>` : aiBubble(m, convo.results[i], pl)))}
      </div>
      <form class="ai-input" id="ai-form">
        <textarea class="input" id="ai-text" rows="1" placeholder="${pl ? `Ex. : ajoute 15 titres plus dansants à « ${pl.name} »` : 'Ex. : une playlist rap/R&B pour la voiture, 30 titres'}"></textarea>
        <button class="big-play" type="submit" aria-label="Envoyer" style="width:46px;height:46px">${icon('forward')}</button>
      </form>
    </div>`);

    pixelBackdrop(el.querySelector('.ai-hero'), accentPalette(), { style: 'plasma', speed: 0.4, cell: 10, fps: 8 });
    const text = el.querySelector('#ai-text');
    text.addEventListener('input', () => {
      text.style.height = 'auto';
      text.style.height = Math.min(text.scrollHeight, 160) + 'px';
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.querySelector('#ai-form').requestSubmit();
      }
    });
    el.querySelector('#ai-form').onsubmit = (e) => {
      e.preventDefault();
      send(text.value.trim());
    };
    el.querySelector('#ai-target').onchange = (e) => {
      convo.target = e.target.value;
      render();
    };
    el.querySelector('#ai-reset')?.addEventListener('click', () => {
      convo.messages = [];
      convo.results = [];
      render();
    });
    el.querySelectorAll('[data-suggest]').forEach((b) => (b.onclick = () => send(b.dataset.suggest)));
    wireResults();
    const chat = el.querySelector('#ai-chat');
    chat.lastElementChild?.scrollIntoView({ block: 'end' });
  };

  function aiBubble(m, res, pl) {
    if (m.error) return html`<div class="bubble ai error">${m.text}</div>`;
    if (!res) return html`<div class="bubble ai">${m.text}</div>`;
    const i = convo.results.indexOf(res);
    const toLike = res.action === 'like_all_playlists' ? [...new Set(state.library.playlists.flatMap((p) => p.tracks.map((t) => t.id)))].filter((id) => !isLiked(id)).length : 0;
    return html`<div class="bubble ai">
      <p>${res.reply}</p>
      ${res.action === 'like_all_playlists' ? html`<div class="row-flex" style="margin:8px 0">${res.liked != null ? html`<b>✓ ${plural(res.liked, 'titre')} ajouté${res.liked > 1 ? 's' : ''} à tes Titres likés</b>` : toLike ? html`<button class="btn primary" data-ai-likeall="${i}">Liker les ${plural(toLike, 'titre')} de mes playlists</button>` : html`<b>Tous les titres de tes playlists sont déjà likés.</b>`}</div>` : ''}
      ${res.tracks.length ? html`<div class="ai-result">
        <div class="row-flex" style="gap:16px;margin-bottom:12px;flex-wrap:nowrap">
          <div class="cover mosaic" style="width:96px;height:96px">${res.tracks.slice(0, 4).map((t) => html`<img src="${t.thumb}" alt="" referrerpolicy="no-referrer">`)}</div>
          <div style="min-width:0"><b style="font-size:20px" class="ellipsis">${pl ? `Pour « ${pl.name} »` : res.playlistName || 'Playlist IA'}</b>
            <div class="muted" style="font-size:13px">${res.description || ''}</div>
            <div class="muted" style="font-size:13px">${plural(res.tracks.length, 'titre')}${res.missing.length ? ` · ${res.missing.length} introuvable${res.missing.length > 1 ? 's' : ''} sur YouTube` : ''}</div></div>
        </div>
        <div class="row-flex" style="margin-bottom:8px">
          ${pl ? html`<button class="btn primary" data-ai-add="${i}" ${res.added ? raw('disabled') : ''}>${res.added ? 'Ajouté ✓' : `Ajouter à « ${pl.name} »`}</button>` : res.created ? html`<a class="btn primary" href="#/playlist/${res.created}">Voir la playlist</a>` : html`<button class="btn primary" data-ai-create="${i}">Créer la playlist</button>`}
          <button class="btn ghost" data-ai-play="${i}">Écouter</button>
          <button class="btn ghost" data-ai-queue="${i}">Ajouter à la file</button>
        </div>
        ${trackList(res.tracks, { context: { type: 'ai', name: res.playlistName || 'Proposition IA' }, numbered: true })}
      </div>` : ''}
      ${res.artists.length ? html`<div class="cards row" style="margin-top:12px">${res.artists.map((a) => html`<div class="card" data-href="#/artist/${a.id}">${cover(a, 'round')}<div class="card-title">${a.name}</div><button class="outline-btn" style="margin-top:8px" data-ai-follow="${i}:${a.id}">${isFollowing(a.id) ? 'Abonné' : "S'abonner"}</button></div>`)}</div>` : ''}
    </div>`;
  }

  function wireResults() {
    const res = (b, attr) => convo.results[Number(b.dataset[attr])];
    el.querySelectorAll('[data-ai-create]').forEach((b) => {
      b.onclick = async () => {
        const r = res(b, 'aiCreate');
        b.disabled = true;
        const p = await createPlaylist(r.playlistName || 'Playlist IA', r.tracks, r.description || 'Créée avec l’assistant IA', { cover: '/assets/cover-ai-mix.png', source: { platform: 'Assistant IA', url: null, owner: null } });
        r.created = p.id;
        toast('Playlist créée', { action: 'Voir', onAction: () => (location.hash = `#/playlist/${p.id}`) });
        render();
      };
    });
    el.querySelectorAll('[data-ai-add]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const r = res(b, 'aiAdd');
        await addToPlaylist(convo.target, r.tracks);
        r.added = true;
        render();
      };
    });
    el.querySelectorAll('[data-ai-likeall]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        const r = res(b, 'aiLikeall');
        r.liked = await likeAllPlaylistTracks();
        render();
      };
    });
    el.querySelectorAll('[data-ai-play]').forEach((b) => {
      b.onclick = () => {
        const r = res(b, 'aiPlay');
        ctl.playList(r.tracks, startAt(r.tracks), { type: 'ai', name: r.playlistName || 'Proposition IA' });
      };
    });
    el.querySelectorAll('[data-ai-queue]').forEach((b) => (b.onclick = () => ctl.addToQueue(res(b, 'aiQueue').tracks)));
    el.querySelectorAll('[data-ai-follow]').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const [i, id] = b.dataset.aiFollow.split(':');
        const a = convo.results[Number(i)].artists.find((x) => x.id === id);
        await toggleFollow(a);
        b.textContent = isFollowing(a.id) ? 'Abonné' : "S'abonner";
      };
    });
  }

  async function send(text) {
    if (!text) return;
    convo.messages.push({ role: 'user', text });
    convo.results.push(null);
    render();
    const chat = el.querySelector('#ai-chat');
    chat.insertAdjacentHTML('beforeend', '<div class="bubble ai loading-bubble"><div class="spinner" style="width:20px;height:20px"></div><span>L’IA prépare ta sélection et cherche les titres…</span></div>');
    chat.lastElementChild.scrollIntoView({ block: 'end' });
    el.querySelector('#ai-text').disabled = true;
    try {
      const pl = targetPl();
      const context = { topArtists: await topArtists() };
      if (pl) context.playlist = { name: pl.name, tracks: pl.tracks.map((t) => `${t.artists?.[0]?.name || ''} - ${t.title}`) };
      // Jeton de connexion : l'IA passe par le mini-serveur Boombox (aucune clé à mettre)
      const idToken = await window.__bbIdToken?.().catch(() => null);
      const r = await api('/api/ai', { method: 'POST', body: { messages: convo.messages.map(({ role, text }) => ({ role, text })), context, idToken } });
      if (pl) {
        const have = new Set(pl.tracks.map((t) => t.id));
        r.tracks = r.tracks.filter((t) => !have.has(t.id));
      }
      // Ce que l'IA a proposé est gardé dans l'historique pour les demandes suivantes (« enlève le rap US »…)
      const summary = r.tracks.length ? `\nTitres proposés : ${r.tracks.map((t) => `${t.artists?.[0]?.name} - ${t.title}`).join(' ; ')}` : '';
      convo.messages.push({ role: 'model', text: r.reply + summary });
      convo.results.push(r);
    } catch (e) {
      convo.messages.push({ role: 'model', text: e.message, error: true });
      convo.results.push(null);
    }
    render();
  }

  render();
  return { onLibrary: () => !document.activeElement?.closest?.('#ai-form') && render() };
}
