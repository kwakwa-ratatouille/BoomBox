// Écrans « Amis » : activité d'écoute des amis, conversations (messages, sons, playlists), envoi à un ami.
import { PIXEL_STICKERS, renderPixelSticker } from './stickers-pixel.js';
import { html, raw, icon, toast, modal, contextMenu, confirmBox, plural, esc, promptText } from './ui.js';
import { state, bus, createPlaylist, isLiked, toggleLike, api, updateProfile } from './state.js';

// Abonnement qu'on peut retirer (quand on quitte la page ou ferme le panneau)
const listen = (type, fn) => {
  const h = () => fn();
  bus.addEventListener(type, h);
  return () => bus.removeEventListener(type, h);
};
import { player, ctl } from './player.js';
import { cover, playlistCover, openPlaylistPicker } from './components.js';
import { social, ago, listeningNow, preview } from './social.js';

export const avatar = (p, cls = '') =>
  p?.photo ? html`<span class="avatar-img ${cls}" style="background-image:url('${p.photo}')"></span>` : html`<span class="avatar-img ${cls}" style="background:${p?.color || '#b07cf7'}">${(p?.name || '?')[0].toUpperCase()}</span>`;
const artists = (t) => (t?.artists || []).map((a) => a.name).join(', ');

// Ligne d'activité d'un ami : « En écoute » ou « il y a 8 h », le son et ce qu'il écoutait
export function activityLine(f) {
  const a = f.activity;
  if (!f.share) return html`<span class="muted fa-off">Activité non partagée</span>`;
  if (!a?.track) return html`<span class="muted fa-off">Rien écouté récemment</span>`;
  const now = listeningNow(a);
  return html`<button class="fa-track" data-play-act="${f.code}" title="Écouter ce son">${a.track.thumb ? html`<img class="fa-cover" src="${a.track.thumb}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="fa-txt">
      <span class="t-title ellipsis">${a.track.title}</span><span class="muted ellipsis">${artists(a.track)} · <span class="fa-when ${now ? 'live' : ''}">${now ? html`<i class="eq"><b></b><b></b><b></b></i> En écoute` : ago(a.at)}</span></span>
    </span></button>`;
}

// Carte d'un ami dans le panneau « Activité des amis » (façon Spotify)
function friendCard(f) {
  const a = f.share ? f.activity : null;
  const now = listeningNow(a);
  return html`<div class="fc ${now ? 'live' : ''}" data-friend="${f.code}">
    <div class="fa-av" data-profile="${f.code}" title="Voir son profil">${avatar(f)}${now ? html`<i class="fa-dot"></i>` : ''}</div>
    <div class="fc-main">
      <div class="fc-top"><b class="ellipsis fc-name" data-profile="${f.code}" title="Voir son profil">${f.name}</b>${a?.track ? html`<span class="fc-when">${now ? html`<i class="eq"><b></b><b></b><b></b></i>` : ago(a.at)}</span>` : ''}</div>
      ${a?.track
        ? html`<span class="fc-title ellipsis" data-play-act="${f.code}" title="Écouter">${a.track.title}</span><span class="fc-sub ellipsis">${artists(a.track)}</span>
          ${a.context?.name ? html`<span class="fc-ctx ellipsis">${icon(a.context.type === 'playlist' ? 'library' : 'music', 12)} ${a.context.name}</span>` : ''}`
        : html`<span class="fc-sub">${f.share ? 'Rien écouté récemment' : 'Activité non partagée'}</span>`}
    </div>
    ${a?.track ? html`<button class="fc-cover" data-play-act="${f.code}" title="Écouter « ${a.track.title} »">${a.track.thumb ? html`<img src="${a.track.thumb}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span>${icon('play', 18)}</span></button>` : ''}
  </div>`;
}

// Ordre : en écoute d'abord, puis activité la plus récente
export const sortedFriends = () =>
  [...social.friends].sort((a, b) => (listeningNow(b.activity) - listeningNow(a.activity)) || ((b.activity?.at || 0) - (a.activity?.at || 0)) || a.name.localeCompare(b.name));

export function bindActivity(root) {
  root.querySelectorAll('[data-play-act]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const t = social.friend(b.dataset.playAct)?.activity?.track;
    if (t) ctl.playTrack(t);
  }));
}

// ---------- Panneau de droite : activité des amis (comme Spotify) ----------
export function friendsPanel(rp, closeBtn, onClose) {
  const draw = () => {
    const list = sortedFriends();
    rp.innerHTML = String(html`<div class="rp-head"><h3>Activité des amis</h3><div class="rp-tabs"><button class="icon-btn" id="fp-add" title="Ajouter un ami">${icon('plus')}</button>${closeBtn}</div></div>
      <div class="rp-body">
        ${!social.sharing ? html`<div class="fa-note muted">Ton activité n'est pas partagée. <a href="#/settings">Activer dans les paramètres</a></div>` : ''}
        ${list.length ? html`<div class="fc-list">${list.map(friendCard)}</div>`
        : html`<div class="empty-mini"><p class="muted">Ajoute tes amis avec leur code ami pour voir ce qu'ils écoutent.</p>
            <p class="muted" style="font-size:12px">Ton code : <b class="code">${social.code || '…'}</b></p></div>`}
        <div class="fc-foot"><a class="btn white" href="#/friends">${icon('chat', 16)} Messages${social.unread ? html` <span class="badge">${social.unread}</span>` : ''}</a>${social.requests().length ? html`<a class="btn ghost" href="#/friends">${plural(social.requests().length, 'demande')}</a>` : ''}</div>
      </div>`);
    bindActivity(rp);
    // Photo ou nom → profil ; son → lecture (bindActivity) ; le reste de la carte → conversation
    rp.querySelectorAll('[data-profile]').forEach((b) => (b.onclick = (e) => (e.stopPropagation(), (location.hash = `#/user/${b.dataset.profile}`))));
    rp.querySelectorAll('[data-friend]').forEach((r) => (r.onclick = () => (location.hash = `#/friends?c=${r.dataset.friend}`)));
    rp.querySelectorAll('[data-msg]').forEach((b) => (b.onclick = (e) => (e.stopPropagation(), (location.hash = `#/friends?c=${b.dataset.msg}`))));
    rp.querySelector('#fp-add').onclick = addFriendDialog;
    rp.querySelector('[data-close-panel]')?.addEventListener('click', onClose);
  };
  draw();
  // Les « il y a … » avancent tout seuls
  const tick = setInterval(draw, 60e3);
  const off = listen('social', draw);
  return () => (clearInterval(tick), off());
}

// ---------- Ajouter un ami ----------
export async function addFriendDialog() {
  const v = await modal({
    title: 'Ajouter un ami',
    body: String(html`<p class="muted" style="margin-top:0">Demande à ton ami son <b>code ami</b> (Paramètres → Amis), et donne-lui le tien :</p>
      <div class="friend-code-box"><span class="code big">${social.code || '…'}</span><button class="btn ghost" id="fc-copy" type="button">${icon('copy', 16)} Copier</button></div>
      <input class="input" placeholder="Code de ton ami (8 caractères)" maxlength="60" style="text-transform:uppercase;letter-spacing:.08em;margin-top:14px">`),
    actions: [{ label: 'Annuler' }, { label: 'Ajouter', primary: true, value: (w) => w.querySelector('input').value.trim() || false }],
    onMount: (w) => (w.querySelector('#fc-copy').onclick = () => navigator.clipboard?.writeText(social.code).then(() => toast('Code copié'))),
  });
  if (!v || v === 'Annuler') return;
  try {
    const name = await social.addFriend(v);
    toast(`Demande d’ami envoyée à ${name}`);
  } catch (e) {
    toast(/permission/i.test(e.code || e.message) ? 'Mets à jour les règles Firebase pour activer les amis' : e.message);
  }
}

// ---------- Envoyer des sons / une playlist à un ami ----------
export function sendToFriend(payload, at = null) {
  const friends = sortedFriends();
  if (!friends.length) {
    toast("Ajoute d'abord un ami (code ami)", { action: 'Ajouter', onAction: addFriendDialog });
    return;
  }
  const what = payload.playlist ? `la playlist « ${payload.playlist.name} »` : payload.tracks.length > 1 ? plural(payload.tracks.length, 'son') : `« ${payload.tracks[0].title} »`;
  const x = at?.x ?? innerWidth / 2 - 120;
  const y = at?.y ?? innerHeight / 3;
  contextMenu(x, y, [
    { label: `Envoyer ${what} à…`, disabled: true },
    ...friends.map((f) => ({
      label: f.name,
      icon: 'send',
      action: async () => {
        try {
          await social.send(f.code, payload);
          toast(`Envoyé à ${f.name}`, { action: 'Ouvrir', onAction: () => (location.hash = `#/friends?c=${f.code}`) });
        } catch (e) {
          toast(/permission/i.test(e.code || e.message) ? 'Mets à jour les règles Firebase pour activer les messages' : e.message);
        }
      },
    })),
  ]);
}

// ---------- Page Amis / conversation ----------
// Téléphone : la conversation prend exactement la place entre son haut et le lecteur / la barre du bas,
// pour que la zone « Écris un message… » ne passe jamais derrière le lecteur
function fitChat(root) {
  const page = root.querySelector('.friends-page.has-chat');
  if (!page || !matchMedia('(max-width: 768px)').matches) return page && (page.style.height = '');
  const r = document.getElementById('playerbar')?.getBoundingClientRect();
  const main = document.getElementById('main')?.getBoundingClientRect();
  const bottom = Math.min(window.visualViewport?.height || innerHeight, main?.bottom || Infinity, r?.height ? r.top : Infinity);
  page.style.height = `${Math.max(240, bottom - page.getBoundingClientRect().top - 10)}px`;
}
addEventListener('resize', () => fitChat(document));
window.visualViewport?.addEventListener('resize', () => fitChat(document));
let chatScroll = 'bottom';
export async function friendsPage(el, params) {
  if (params.add) social.addFriend(params.add).then((n) => toast(`Demande d’ami envoyée à ${n}`)).catch((e) => toast(e.message));
  const code = params.c || null;

  let lastCount = -1;
  const draw = () => {
    // Position du fil avant de redessiner : une réaction ou un « vu » ne doit pas renvoyer tout en bas
    const prev = el.querySelector('#chat-msgs');
    const keep = prev && { top: prev.scrollTop, atBottom: prev.scrollHeight - prev.scrollTop - prev.clientHeight < 40 };
    const count = code ? social.thread(code).length : 0;
    chatScroll = !keep || keep.atBottom || count > lastCount ? 'bottom' : keep.top;
    lastCount = count;
    const list = sortedFriends();
    const f = code && social.friend(code);
    const lastMsg = (c) => social.inbox.find((m) => m.peer === c);
    const unreadOf = (c) => social.inbox.filter((m) => m.peer === c && !m.out && !m.read).length;
    // Personnes qui m'ont écrit sans être dans mes amis : la conversation apparaît quand même
    const strangers = [...new Set(social.inbox.filter((m) => !m.out && !social.friend(m.peer)).map((m) => m.peer))].filter((c) => !social.requests().some((r) => r.peer === c));
    el.innerHTML = String(html`<div class="page friends-page ${code ? 'has-chat' : ''}">
      <aside class="fr-list">
        <div class="row-flex" style="justify-content:space-between;margin-bottom:10px"><h1 style="font-size:28px;margin:0">Amis</h1><button class="btn ghost" id="fr-add">${icon('plus', 18)} Ajouter</button></div>
        ${social.requests().length ? html`<div class="fr-reqs"><div class="muted" style="font-size:12px;font-weight:700;margin:4px 0 6px">DEMANDES D'AMI</div>${social.requests().map((r) => html`<div class="fr-item fr-req"><div class="fa-av">${avatar({ name: r.fromName, photo: r.fromPhoto, color: r.fromColor })}</div>
          <div class="fa-main"><b class="ellipsis">${r.fromName}</b><span class="muted">veut t'ajouter en ami</span></div>
          <button class="btn primary sm" data-acc="${r.peer}">Accepter</button><button class="icon-btn" data-dec="${r.peer}" title="Refuser">${icon('close', 18)}</button></div>`)}</div>` : ''}
        ${list.map((x) => {
          const m = lastMsg(x.code);
          const n = unreadOf(x.code);
          return html`<a class="fr-item ${x.code === code ? 'active' : ''}" href="#/friends?c=${x.code}">
            <div class="fa-av">${avatar(x)}${listeningNow(x.activity) ? html`<i class="fa-dot"></i>` : ''}</div>
            <div class="fa-main"><b class="ellipsis">${x.name}${x.sameSpace ? html` <span class="tag">profil</span>` : ''}${social.isPending(x.code) ? html` <span class="tag">demande envoyée</span>` : ''}</b>
              <span class="muted ellipsis">${m ? `${m.out ? 'Toi : ' : ''}${preview(m)}` : x.activity?.track && x.share ? `${listeningNow(x.activity) ? '▶ ' : ''}${x.activity.track.title} · ${artists(x.activity.track)}` : 'Aucun message'}</span></div>
            ${n ? html`<span class="badge">${n}</span>` : ''}</a>`;
        })}
        ${strangers.map((c) => {
          const m = lastMsg(c);
          return html`<a class="fr-item ${c === code ? 'active' : ''}" href="#/friends?c=${c}"><div class="fa-av">${avatar({ name: m.fromName, photo: m.fromPhoto, color: m.fromColor })}</div>
            <div class="fa-main"><b class="ellipsis">${m.fromName}</b><span class="muted ellipsis">${preview(m)}</span></div>${unreadOf(c) ? html`<span class="badge">${unreadOf(c)}</span>` : ''}</a>`;
        })}
        ${!list.length && !strangers.length ? html`<p class="muted">Pas encore d'amis. Ajoute-les avec leur code ami.</p>` : ''}
        <div class="fr-me muted">Ton code ami : <b class="code">${social.code || '…'}</b> · ${social.sharing ? 'activité partagée' : html`activité non partagée (<a href="#/settings">changer</a>)`}</div>
      </aside>
      <section class="fr-chat">${code ? chatView(code, f) : html`<div class="empty"><h2>${icon('chat', 40)}</h2><p class="muted">Choisis un ami pour voir son activité et lui écrire.</p></div>`}</section>
    </div>`);
    el.querySelector('#fr-add').onclick = addFriendDialog;
    el.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => social.acceptRequest(b.dataset.acc).catch((e) => toast(e.message))));
    el.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = () => social.declineRequest(b.dataset.dec)));
    if (code) bindChat(el, code, f);
  };

  function chatView(c, f) {
    const msgs = social.thread(c);
    const incoming = msgs.find((m) => !m.out);
    const who = f || (incoming && { code: c, name: incoming.fromName, photo: incoming.fromPhoto, color: incoming.fromColor, share: false });
    if (!who) return html`<div class="empty"><p class="muted">Conversation introuvable.</p></div>`;
    let lastDay = '';
    const seen = social.seenAt(c);
    const lastOut = [...msgs].reverse().find((m) => m.out);
    return html`<header class="chat-head">
        <a class="icon-btn chat-back" href="#/friends" aria-label="Retour">${icon('back')}</a>
        <a class="fa-av" href="#/user/${c}" title="Voir son profil">${avatar(who)}${listeningNow(who.activity) ? html`<i class="fa-dot"></i>` : ''}</a>
        <div class="fa-main"><a href="#/user/${c}" class="chat-name" title="Voir son profil"><b>${who.name}</b></a>${f ? activityLine(f) : html`<span class="muted">Pas dans tes amis</span>`}</div>
        <button class="icon-btn" id="chat-more" aria-label="Plus">${icon('more')}</button>
      </header>
      <div class="chat-msgs" id="chat-msgs">
        ${msgs.length ? msgs.map((m) => {
          const day = new Date(m.at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
          const sep = day !== lastDay ? ((lastDay = day), html`<div class="chat-day">${day}</div>`) : '';
          return html`${sep}<div class="msg ${m.out ? 'out' : 'in'}" data-mid="${m.mid}" data-at="${m.at}">
            ${m.reply ? html`<button type="button" class="msg-reply" data-goto="${m.reply.at}"><b>${m.reply.name}</b><span class="ellipsis">${m.reply.text}</span></button>` : ''}
            ${m.collab ? html`<a class="btn primary sm" style="margin-bottom:6px" href="#/shared/${m.out ? social.code : m.peer}/${m.collab.id}">${icon('library', 16)} Ouvrir « ${m.collab.name} »</a>` : ''}${m.playlist ? playlistCard(m) : ''}${m.tracks?.length ? tracksCard(m) : ''}${m.image || m.gif ? html`<img class="msg-img" src="${m.image || m.gif}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${m.sticker ? html`<img class="msg-sticker" src="${m.sticker}" alt="">` : ''}${m.text ? html`<p class="msg-text">${m.text}</p>` : ''}
            ${m === lastOut ? html`<span class="msg-state">${seen >= m.at ? 'Vu' : 'Remis'}</span>` : ''}<time>${new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</time>${reactBadge(c, m.at)}</div>`;
        }) : html`<p class="muted chat-empty">Envoie un message, un son ou une playlist à ${who.name}.</p>`}
      </div>
      <div class="chat-replying" id="chat-replying" hidden><div><b></b><span class="ellipsis"></span></div><button type="button" class="icon-btn" aria-label="Annuler la réponse">${icon('close', 18)}</button></div>
      <form class="chat-form" id="chat-form">
        <button type="button" class="icon-btn" id="chat-attach" title="Envoyer un son ou une playlist">${icon('addCircle')}</button>
        <input class="input" id="chat-input" placeholder="Écris un message…" maxlength="2000" autocomplete="off">
        <button class="icon-btn primary-ic" title="Envoyer">${icon('send')}</button>
      </form>`;
  }

  const tracksCard = (m) => html`<div class="msg-tracks">${m.tracks.slice(0, 8).map((t, i) => html`<div class="msg-track" data-mt="${m.mid}" data-i="${i}">
      ${cover(t, '', 96)}<div class="t-text"><span class="t-title ellipsis">${t.title}</span><span class="t-artists muted ellipsis">${artists(t)}</span></div>
      <button class="icon-btn" data-mt-play="${i}" title="Écouter">${icon('play', 18)}</button><button class="icon-btn" data-mt-more="${i}" title="Plus">${icon('more', 18)}</button></div>`)}
    ${m.tracks.length > 8 ? html`<button class="more muted" data-mt-all>+ ${m.tracks.length - 8} autres · tout écouter</button>` : m.tracks.length > 1 ? html`<button class="more muted" data-mt-all>Tout écouter</button>` : ''}</div>`;

  const playlistCard = (m) => html`<div class="msg-pl">${playlistCover({ cover: m.playlist.cover, tracks: m.playlist.tracks }, '', 160)}
      <div class="t-text"><span class="muted" style="font-size:11px">PLAYLIST</span><b class="ellipsis">${m.playlist.name}</b><span class="muted">${plural(m.playlist.tracks.length, 'titre')}</span>
      <div class="row-flex" style="gap:8px;margin-top:6px"><button class="btn primary sm" data-pl-play>${icon('play', 16)} Écouter</button><button class="btn ghost sm" data-pl-save>Ajouter à ma bibliothèque</button></div></div></div>`;

  function bindChat(root, c, f) {
    bindActivity(root);
    // Réactions : double-clic / appui long sur un message → barre d'emojis
    root.querySelectorAll('.msg[data-at]').forEach((el) => {
      let t = null;
      const open = () => reactBar(el, c, Number(el.dataset.at), () => startReply(Number(el.dataset.at)));
      el.addEventListener('dblclick', open);
      // Glisser le message vers la droite → répondre (comme WhatsApp) ; appui long → réactions
      let x0 = 0, y0 = 0, dx = 0, swiping = false;
      el.addEventListener('touchstart', (e) => {
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
        dx = 0;
        swiping = false;
        t = setTimeout(open, 450);
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        const mx = e.touches[0].clientX - x0;
        const my = e.touches[0].clientY - y0;
        if (Math.abs(mx) > 8 || Math.abs(my) > 8) clearTimeout(t);
        if (!swiping && mx > 12 && Math.abs(mx) > Math.abs(my) * 1.5) swiping = true;
        if (!swiping) return;
        dx = Math.max(0, Math.min(80, mx));
        el.style.transform = `translateX(${dx}px)`;
        el.classList.toggle('swipe-ready', dx > 55);
      }, { passive: true });
      const end = () => {
        clearTimeout(t);
        if (!swiping) return;
        el.style.transition = 'transform .2s';
        el.style.transform = '';
        setTimeout(() => (el.style.transition = ''), 220);
        el.classList.remove('swipe-ready');
        if (dx > 55) navigator.vibrate?.(10), startReply(Number(el.dataset.at));
        swiping = false;
      };
      el.addEventListener('touchend', end, { passive: true });
      el.addEventListener('touchcancel', end, { passive: true });
      el.addEventListener('contextmenu', (e) => (e.preventDefault(), open()));
    });
    const box = root.querySelector('#chat-msgs');
    fitChat(root);
    if (box) box.scrollTop = chatScroll === 'bottom' ? box.scrollHeight : chatScroll;
    // Pochettes et GIF qui finissent de charger : le fil reste collé en bas (sinon il « saute » après un envoi)
    if (box && chatScroll === 'bottom') box.querySelectorAll('img').forEach((im) => im.complete || im.addEventListener('load', () => box.scrollHeight - box.scrollTop - box.clientHeight < 400 && (box.scrollTop = box.scrollHeight), { once: true }));
    social.markRead(c);
    const input = root.querySelector('#chat-input');
    if (!input) return;
    const keep = sessionStorage.getItem(`boombox.draft.${c}`);
    if (keep) input.value = keep;
    input.oninput = () => sessionStorage.setItem(`boombox.draft.${c}`, input.value);
    if (matchMedia('(pointer: fine)').matches) input.focus();
    // Répondre : le message visé est gardé jusqu'au prochain envoi (ou ✕)
    let replyTo = null;
    const strip = root.querySelector('#chat-replying');
    const startReply = (at) => {
      const m = social.thread(c).find((x) => x.at === at);
      if (!m || !strip) return;
      replyTo = { at, name: m.out ? 'Toi' : m.fromName || '', text: preview(m) };
      strip.querySelector('b').textContent = `Réponse à ${replyTo.name}`;
      strip.querySelector('span').textContent = replyTo.text;
      strip.hidden = false;
      input.focus();
    };
    strip?.querySelector('button').addEventListener('click', () => ((replyTo = null), (strip.hidden = true)));
    root.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => {
      const t = root.querySelector(`.msg[data-at="${b.dataset.goto}"]`);
      if (!t) return toast('Message trop ancien');
      t.scrollIntoView({ block: 'center', behavior: 'smooth' });
      t.classList.add('flash');
      setTimeout(() => t.classList.remove('flash'), 1200);
    }));
    const send = async (payload) => {
      if (replyTo) (payload.reply = replyTo), (replyTo = null), strip && (strip.hidden = true);
      try {
        await social.send(c, payload);
      } catch (e) {
        toast(/permission/i.test(e.code || e.message) ? 'Mets à jour les règles Firebase pour activer les messages' : e.message);
      }
    };
    root.querySelector('#chat-form').onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sessionStorage.removeItem(`boombox.draft.${c}`);
      send({ text });
    };
    root.querySelector('#chat-attach').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.left, r.top - 200, [
        player.track && { label: `Le son en cours : ${player.track.title}`, icon: 'music', action: () => send({ tracks: [player.track] }) },
        { label: 'Chercher un son…', icon: 'search', action: () => searchAndSend(send) },
        { label: 'Image ou GIF de ma galerie', icon: 'plus', action: () => pickImage().then((img) => img && send({ image: img })) },
        { label: 'Chercher un GIF', icon: 'search', action: () => gifPicker(send) },
        { label: 'Sticker', icon: 'heart', action: () => stickerPicker(send) },
        {
          label: 'Une de mes playlists',
          icon: 'library',
          submenu: () => [
            { label: 'Titres likés (50 derniers)', icon: 'heart', action: () => send({ tracks: state.library.liked.slice(0, 50) }) },
            ...state.library.playlists.filter((p) => p.tracks.length).slice(0, 60).map((p) => ({ label: p.name, action: () => send({ playlist: p }) })),
          ],
        },
      ]);
    };
    root.querySelector('#chat-more').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.right - 220, r.bottom + 6, [
        { label: 'Voir son profil et ses playlists', icon: 'person', action: () => (location.hash = `#/user/${c}`) },
        f?.activity?.track && { label: 'Écouter son dernier son', icon: 'play', action: () => ctl.playTrack(f.activity.track) },
        !social.isAdded(c) && !f?.sameSpace && { label: 'Ajouter à mes amis', icon: 'plus', action: () => social.addFriend(c).then((n) => toast(`Demande d’ami envoyée à ${n}`)).catch((er) => toast(er.message)) },
        social.isAdded(c) && { label: 'Retirer de mes amis', icon: 'trash', danger: true, action: async () => (await confirmBox('Retirer cet ami ?', `${f?.name || 'Cette personne'} ne sera plus dans ta liste. Tu ne verras plus son activité.`, 'Retirer')) && social.removeFriend(c) },
      ]);
    };
    // Cartes reçues : sons et playlists
    const msgOf = (elx) => social.inbox.find((m) => m.mid === elx.closest('[data-mid]')?.dataset.mid);
    root.querySelectorAll('[data-mt-play]').forEach((b) => (b.onclick = () => {
      const m = msgOf(b);
      ctl.playList(m.tracks, Number(b.dataset.mtPlay), { type: 'message', name: `Envoyé par ${m.out ? 'toi' : m.fromName}` });
    }));
    root.querySelectorAll('[data-mt-all]').forEach((b) => (b.onclick = () => {
      const m = msgOf(b);
      ctl.playList(m.tracks, 0, { type: 'message', name: `Envoyé par ${m.out ? 'toi' : m.fromName}` });
    }));
    root.querySelectorAll('[data-mt-more]').forEach((b) => (b.onclick = (e) => {
      const t = msgOf(b).tracks[Number(b.dataset.mtMore)];
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.right - 220, r.bottom, [
        { label: "Ajouter à la file d'attente", icon: 'addQueue', action: () => ctl.addToQueue(t) },
        { label: 'Ajouter à une playlist…', icon: 'plus', action: () => openPlaylistPicker(t, { x: r.left, y: r.top }) },
        { label: isLiked(t.id) ? 'Retirer des Titres likés' : 'Ajouter aux Titres likés', icon: isLiked(t.id) ? 'heartFill' : 'heart', action: () => toggleLike(t) },
        { label: 'Radio basée sur ce titre', icon: 'radio', action: () => ctl.playRadio(t) },
      ]);
    }));
    root.querySelectorAll('[data-pl-play]').forEach((b) => (b.onclick = () => {
      const m = msgOf(b);
      ctl.playList(m.playlist.tracks, 0, { type: 'message', name: m.playlist.name });
    }));
    root.querySelectorAll('[data-pl-save]').forEach((b) => (b.onclick = async () => {
      const m = msgOf(b);
      b.disabled = true;
      const p = await createPlaylist(m.playlist.name, m.playlist.tracks, m.playlist.description || `Envoyée par ${m.out ? 'toi' : m.fromName}`, m.playlist.cover ? { cover: m.playlist.cover } : {});
      toast(`« ${p.name} » ajoutée à ta bibliothèque`, { action: 'Ouvrir', onAction: () => (location.hash = `#/playlist/${p.id}`) });
    }));
  }

  draw();
  // Redessine à chaque nouveau message / activité, sans perdre ce qui est en cours de frappe (brouillon gardé)
  const off = listen('social', () => {
    const typing = document.activeElement?.id === 'chat-input';
    draw();
    if (typing) el.querySelector('#chat-input')?.focus();
  });
  const tick = setInterval(() => document.activeElement?.id !== 'chat-input' && draw(), 60e3);
  return { cleanup: () => (off(), clearInterval(tick)) };
}

// Recherche rapide d'un son à envoyer
export async function searchAndSend(send, title = 'Envoyer un son') {
  const q = await modal({
    title,
    body: '<input class="input" placeholder="Titre ou artiste" maxlength="100"><div id="ss-res" style="margin-top:10px"></div>',
    actions: [{ label: 'Fermer' }],
    onMount: (w) => {
      const input = w.querySelector('input');
      const res = w.querySelector('#ss-res');
      let seq = 0;
      let timer = null;
      input.focus();
      input.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const v = input.value.trim();
          if (!v) return (res.innerHTML = '');
          const my = ++seq;
          const r = await api(`/api/search?q=${encodeURIComponent(v)}&type=song`).catch(() => ({ items: [] }));
          if (my !== seq) return;
          const items = (r.items || []).slice(0, 6);
          res.innerHTML = String(html`${items.map((t, i) => html`<button class="ss-item" data-i="${i}">${cover(t, '', 96)}<span class="t-text"><span class="t-title ellipsis">${t.title}</span><span class="t-artists muted ellipsis">${artists(t)}</span></span>${icon('send', 18)}</button>`)}`);
          res.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => {
            send({ tracks: [items[Number(b.dataset.i)]] });
            b.classList.add('sent');
            b.disabled = true;
            toast('Envoyé');
          }));
        }, 300);
      };
    },
  });
  return q;
}

// ---------- Images, GIF et stickers dans les messages ----------
// Image de la galerie : réduite (côté max 900 px) ; un GIF animé est gardé tel quel s'il est assez léger
function pickImage(max = 900) {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    inp.onchange = () => {
      const file = inp.files[0];
      if (!file) return resolve(null);
      if (file.type === 'image/gif' && file.size < 600000) {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.readAsDataURL(file);
        return;
      }
      if (file.type === 'image/gif') toast('GIF trop lourd : envoyé en image fixe');
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * r);
        cv.height = Math.round(img.height * r);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => (toast('Image illisible'), resolve(null));
      img.src = URL.createObjectURL(file);
    };
    inp.click();
  });
}
// Lien de page Giphy → lien direct de l'image
function gifUrl(u) {
  const g = u.match(/giphy\.com\/gifs\/(?:.*-)?([A-Za-z0-9]+)$/);
  return g ? `https://media.giphy.com/media/${g[1]}/giphy.gif` : u;
}
const STICKERS = ['😂', '🔥', '❤️', '😭', '🥳', '😎', '👀', '💀', '🙏', '🎶', '🎧', '💯', '🤯', '😍', '🫶', '👍'];
const emojiSticker = (e) => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 160;
  const x = cv.getContext('2d');
  x.font = '130px serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(e, 80, 90);
  return cv.toDataURL('image/png');
};
// Stickers : emojis géants + mes stickers perso (images ajoutées, gardées sur ce profil)
async function stickerPicker(send) {
  const mine = () => state.profile.stickers || [];
  let close = null;
  const draw = (w) => {
    w.querySelector('.stk-grid').innerHTML = [
      ...PIXEL_STICKERS.map((p) => `<button class="stk stk-px" data-px="${p.id}" title="${p.label}"><img src="${renderPixelSticker(p.id, 96)}" alt="${p.label}"></button>`),
      ...mine().map((src, i) => `<button class="stk" data-mine="${i}"><img src="${src}" alt=""></button>`),
      ...STICKERS.map((e) => `<button class="stk" data-emo="${e}">${e}</button>`),
    ].join('');
  };
  await modal({
    title: 'Stickers',
    body: '<div class="stk-grid"></div><label class="btn ghost" style="margin-top:12px;display:inline-block;cursor:pointer">+ Ajouter mon sticker (image)<input type="file" accept="image/*" id="stk-add" hidden></label><p class="muted" style="font-size:12px">Clic droit / appui long sur un de tes stickers pour le supprimer.</p>',
    actions: [{ label: 'Fermer' }],
    onMount: (w) => {
      close = () => [...(w.closest('.modal') || w.parentElement).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fermer')?.click();
      draw(w);
      w.addEventListener('click', (e) => {
        const b = e.target.closest('.stk');
        if (!b) return;
        send({ sticker: b.dataset.px ? renderPixelSticker(b.dataset.px) : b.dataset.mine != null ? mine()[b.dataset.mine] : emojiSticker(b.dataset.emo) });
        close?.();
      });
      w.addEventListener('contextmenu', async (e) => {
        const b = e.target.closest('[data-mine]');
        if (!b) return;
        e.preventDefault();
        const list = mine().filter((_, i) => i !== Number(b.dataset.mine));
        state.profile.stickers = list;
        await updateProfile(state.profile.id, { stickers: list });
        draw(w);
      });
      w.querySelector('#stk-add').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = async () => {
          const r = Math.min(1, 256 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * r);
          cv.height = Math.round(img.height * r);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          const list = [cv.toDataURL('image/png'), ...mine()].slice(0, 24);
          state.profile.stickers = list;
          await updateProfile(state.profile.id, { stickers: list });
          draw(w);
        };
        img.src = URL.createObjectURL(file);
      };
    },
  });
}

// Recherche de GIF (GIPHY, via le mini-serveur Boombox qui garde la clé secrète)
const GIF_API = 'https://boombox-ai.boombox-matis.workers.dev/gifs';
async function gifPicker(send) {
  let timer = null;
  let closeIt = null;
  const load = async (w, q) => {
    const grid = w.querySelector('.gif-grid');
    grid.innerHTML = '<p class="muted">Chargement…</p>';
    try {
      const token = await window.__bbIdToken?.().catch(() => null);
      const r = await fetch(`${GIF_API}?q=${encodeURIComponent(q)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      const list = await r.json();
      if (!Array.isArray(list)) throw new Error(list.error || 'Recherche indisponible');
      grid.innerHTML = list.length ? list.map((g) => `<button class="gif-it" data-url="${esc(g.url)}"><img src="${esc(g.preview)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('') : '<p class="muted">Aucun GIF trouvé.</p>';
    } catch (e) {
      grid.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  };
  await modal({
    title: 'GIF',
    body: '<input class="input gif-q" placeholder="Rechercher un GIF (GIPHY)" autocomplete="off"><div class="gif-grid"></div><p class="muted" style="font-size:11px;margin:8px 0 0">Propulsé par GIPHY</p>',
    actions: [{ label: 'Fermer' }],
    onMount: (w) => {
      closeIt = () => [...(w.closest('.modal') || w.parentElement).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fermer')?.click();
      load(w, '');
      w.querySelector('.gif-q').oninput = (e) => (clearTimeout(timer), (timer = setTimeout(() => load(w, e.target.value.trim()), 350)));
      w.addEventListener('click', (e) => {
        const b = e.target.closest('.gif-it');
        if (!b) return;
        send({ gif: b.dataset.url });
        closeIt?.();
      });
    },
  });
}

// ---------- Réactions emoji ----------
const REACTS = ['❤️', '😂', '😮', '😢', '🔥', '👍'];
function reactBadge(code, at) {
  const r = social.reactions(code, at);
  const list = [r.theirs, r.mine].filter(Boolean);
  return list.length ? html`<span class="msg-react">${list.join('')}</span>` : '';
}
function reactBar(el, code, at, onReply) {
  document.querySelector('.react-bar')?.remove();
  const mine = social.reactions(code, at).mine;
  const bar = document.createElement('div');
  bar.className = 'react-bar';
  bar.innerHTML = REACTS.map((e) => `<button class="${e === mine ? 'on' : ''}" data-e="${e}">${e}</button>`).join('') + (onReply ? '<button class="react-reply" data-reply title="Répondre">↩︎</button>' : '');
  document.body.appendChild(bar);
  const r = el.getBoundingClientRect();
  bar.style.top = Math.max(8, r.top - bar.offsetHeight - 6) + 'px';
  bar.style.left = Math.max(8, Math.min(innerWidth - bar.offsetWidth - 8, r.left + r.width / 2 - bar.offsetWidth / 2)) + 'px';
  navigator.vibrate?.(10);
  const close = () => (bar.remove(), document.removeEventListener('pointerdown', away, true));
  const away = (e) => !bar.contains(e.target) && close();
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  bar.onclick = (e) => {
    if (e.target.closest('[data-reply]')) return void (close(), onReply());
    const b = e.target.closest('[data-e]');
    if (!b) return;
    social.react(code, at, b.dataset.e === mine ? '' : b.dataset.e).catch((er) => toast(er.message));
    close();
  };
}

// ---------- Accueil : « En direct », qui écoute quoi en ce moment ----------
// Amis en écoute d'abord (avec l'égaliseur animé), puis ceux qui ont écouté dans la dernière heure.
// Toucher la photo ouvre son profil ; toucher le son le lance chez soi. Se met à jour en direct.
export function mountLiveStrip(box) {
  const draw = () => {
    if (!box.isConnected) return off();
    const recent = sortedFriends().filter((f) => f.share && f.activity?.track && (listeningNow(f.activity) || Date.now() - (f.activity.at || 0) < 3600e3));
    const live = recent.filter((f) => listeningNow(f.activity)).length;
    if (!recent.length) return void (box.innerHTML = '');
    box.innerHTML = String(html`<section class="section live-strip"><div class="section-head"><h2>${live ? html`<i class="live-dot"></i>En direct` : 'Écouté à l’instant'}</h2><a href="#/friends">${live ? plural(live, 'ami') + ' en écoute' : 'Tous les amis'}</a></div>
      <div class="ls-row">${recent.slice(0, 20).map((f) => {
        const a = f.activity;
        const now = listeningNow(a);
        return html`<div class="ls-item ${now ? 'on' : ''}">
          <a class="ls-av" href="#/user/${f.code}" title="Profil de ${f.name}">${avatar(f)}${now ? html`<i class="eq"><b></b><b></b><b></b></i>` : ''}</a>
          <b class="ellipsis">${f.name}</b>
          <button class="ls-track" data-play-act="${f.code}" title="Écouter « ${a.track.title} »"><span class="ellipsis">${a.track.title}</span><small class="ellipsis muted">${now ? artists(a.track) : ago(a.at)}</small></button>
        </div>`;
      })}</div></section>`);
    bindActivity(box);
  };
  const off = listen('social', draw);
  const timer = setInterval(() => (box.isConnected ? draw() : (clearInterval(timer), off())), 60e3);
  draw();
}
