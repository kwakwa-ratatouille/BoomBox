// Paroles (synchronisées si possible) : le serveur interroge plusieurs sources, voir server/lyrics.js.
import { api, on } from './state.js';
import { player, ctl } from './player.js';
import { esc, artistNames, icon, fmtTime } from './ui.js';
import { keepAwake } from './awake.js';

const cache = new Map();

export function getLyrics(track) {
  if (!track) return Promise.resolve(null);
  if (!cache.has(track.id)) {
    const title = track.title.replace(/\s*[\(\[](official|clip|lyrics?|audio|video|visuali[sz]er|paroles)[^\)\]]*[\)\]]/gi, '').trim();
    const qs = new URLSearchParams({ videoId: track.id, title, artist: track.artists?.[0]?.name || artistNames(track) });
    if (track.album?.name) qs.set('album', track.album.name);
    if (track.duration) qs.set('duration', String(Math.round(track.duration)));
    cache.set(track.id, api(`/api/lyrics?${qs}`).then(parse).catch(() => null));
  }
  return cache.get(track.id);
}

function parse(data) {
  if (!data) return null;
  if (data.synced) {
    const lines = [];
    for (const l of data.synced.split('\n')) {
      const m = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() || '♪' });
    }
    if (lines.length) return { synced: true, lines, source: data.source };
  }
  if (data.plain) return { synced: false, lines: data.plain.split('\n').map((text) => ({ text: text || ' ' })), source: data.source };
  if (data.instrumental) return { synced: false, lines: [{ text: '♪ Instrumental ♪' }], source: data.source };
  return null;
}

// Rend les paroles dans `el` et les synchronise avec la lecture. Retourne une fonction de nettoyage.
export function mountLyrics(el, track) {
  let alive = true;
  let lyr = null;
  let lastIdx = -1;
  let userScroll = 0;
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const scroller = el.closest('.kara-lyrics, .fp-lyrics, .np-lyrics, .rp-body, .view, #rightpanel, #fullplayer') || el;
  const onScroll = () => {
    userScroll = Date.now();
    el.querySelector('.lyr-resync')?.classList.remove('hidden');
  };
  scroller.addEventListener('wheel', onScroll, { passive: true });
  scroller.addEventListener('touchmove', onScroll, { passive: true });

  getLyrics(track).then((l) => {
    if (!alive) return;
    lyr = l;
    if (!l) {
      el.innerHTML = '<p class="muted" style="padding:24px 0">Pas de paroles disponibles pour ce titre.</p>';
      return;
    }
    el.innerHTML = `<div class="lyrics-source">${l.source ? `Paroles : ${esc(l.source)}${l.synced ? '' : ' · non synchronisées'}` : ''}<button class="lyr-share" type="button">Partager des paroles</button></div>`
      + `<div class="lyrics ${l.synced ? '' : 'plain'}">${l.lines.map((x, i) => `<p data-i="${i}">${esc(x.text)}</p>`).join('')}</div>`
      + (l.synced ? '<button class="lyr-resync hidden" type="button">↻ Revenir au son</button>' : '');
    el.querySelector('.lyr-share').onclick = (e) => (e.stopPropagation(), pickLyricLines(track, l));
    if (l.synced) {
      // Paroles déplacées à la main : un bouton les recale sur le passage en cours du son
      el.querySelector('.lyr-resync').onclick = (e) => {
        e.stopPropagation();
        userScroll = 0;
        e.currentTarget.classList.add('hidden');
        const cur = el.querySelector('.lyrics p.now') || el.querySelector('.lyrics p');
        cur && center(cur, true);
      };
      el.querySelector('.lyrics').onclick = (e) => {
        const p = e.target.closest('p');
        if (p) ctl.seek(l.lines[p.dataset.i].t);
      };
    }
    tick();
  });

  // Recentre la ligne en cours en faisant défiler SEULEMENT le cadre des paroles (avant : toute la page bougeait
  // avec, ce qui faisait sauter le lecteur plein écran sur téléphone). Doux, et seulement si la ligne sort du milieu.
  function center(line, force = false) {
    const box = scroller;
    if (!box || box === document.scrollingElement) return;
    const b = box.getBoundingClientRect();
    const r = line.getBoundingClientRect();
    const mid = b.top + b.height / 2;
    if (!force && Math.abs(r.top + r.height / 2 - mid) < b.height * 0.18) return;
    box.scrollTo({ top: box.scrollTop + (r.top + r.height / 2 - mid), behavior: 'smooth' });
  }
  function tick() {
    if (!alive || !lyr?.synced || player.track?.id !== track.id) return;
    const t = player.time() + 0.25;
    let idx = -1;
    for (let i = 0; i < lyr.lines.length; i++) if (lyr.lines[i].t <= t) idx = i;
    if (idx !== lastIdx) {
      lastIdx = idx;
      el.querySelectorAll('.lyrics p').forEach((p, i) => {
        p.classList.toggle('past', i < idx);
        p.classList.toggle('now', i === idx);
      });
      const cur = el.querySelector('.lyrics p.now');
      if (cur && Date.now() - userScroll > 3000) {
        center(cur);
        el.querySelector('.lyr-resync')?.classList.add('hidden');
      }
    }
  }
  // Paroles à l'écran pendant que le son joue : l'appareil ne se met pas en veille
  const awakeKey = {};
  const iv = setInterval(() => {
    tick();
    keepAwake(awakeKey, alive && !player.paused && player.track?.id === track.id && el.isConnected && el.getClientRects().length > 0);
  }, 200);
  return () => {
    alive = false;
    clearInterval(iv);
    keepAwake(awakeKey, false);
    scroller.removeEventListener('wheel', onScroll);
    scroller.removeEventListener('touchmove', onScroll);
  };
}

// ---------- Paroles en plein écran (façon karaoké) ----------
// Ouvertes par la touche F, le bouton « plein écran » du panneau Paroles ou le menu ⋯ de la barre de lecture.
// Pochette floutée en fond, ligne en cours en grand ; suit les changements de titre ; Échap ou ✕ pour fermer.
let kara = null;
export function openKaraoke() {
  if (kara) return closeKaraoke();
  const ov = document.createElement('div');
  ov.id = 'karaoke';
  ov.innerHTML = `<div class="kara-bg"></div>
    <header class="kara-head"><div class="kara-cover"></div><div class="kara-info"><b></b><span></span></div>
      <button class="icon-btn" data-k="fs" title="Plein écran (écran entier)">${icon('fullscreen', 22)}</button><button class="icon-btn" data-k="close" title="Fermer (Échap)">${icon('close', 24)}</button></header>
    <div class="kara-lyrics"><div class="kara-inner"></div></div>
    <footer class="kara-foot"><span class="kara-cur">0:00</span><div class="kara-bar"><div></div></div><span class="kara-dur">0:00</span>
      <div class="kara-ctrl"><button class="ctrl" data-k="prev">${icon('prev')}</button><button class="play-btn" data-k="toggle">${icon('play')}</button><button class="ctrl" data-k="next">${icon('next')}</button></div></footer>`;
  document.body.appendChild(ov);
  let unmount = null;
  let shownId = null;
  const show = () => {
    const t = player.track;
    if (!ov.isConnected || !t || t.id === shownId) return;
    shownId = t.id;
    const img = (t.thumb || '').replace(/=w\d+-h\d+[^&?/]*/, '=w800-h800-l90-rj');
    // Vraies images (sans « referrer ») : les pochettes YouTube refusent les fonds CSS
    ov.querySelector('.kara-bg').innerHTML = img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : '';
    ov.querySelector('.kara-cover').innerHTML = img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : '';
    ov.querySelector('.kara-info b').textContent = t.title;
    ov.querySelector('.kara-info span').textContent = artistNames(t);
    unmount?.();
    unmount = mountLyrics(ov.querySelector('.kara-inner'), t);
  };
  const tick = () => {
    const d = player.shownDuration?.() || player.duration();
    const c = player.time();
    ov.querySelector('.kara-cur').textContent = fmtTime(c);
    ov.querySelector('.kara-dur').textContent = fmtTime(d);
    ov.querySelector('.kara-bar div').style.width = (d ? Math.min(100, (c / d) * 100) : 0) + '%';
    ov.querySelector('[data-k=toggle]').innerHTML = icon(player.paused ? 'play' : 'pause');
    show();
  };
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'close') return closeKaraoke();
    if (k === 'fs') return document.fullscreenElement ? document.exitFullscreen() : ov.requestFullscreen?.().catch(() => {});
    ctl[k]();
  });
  ov.querySelector('.kara-bar').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    ctl.seek(((e.clientX - r.left) / r.width) * (player.shownDuration?.() || player.duration()));
  });
  const onKey = (e) => e.key === 'Escape' && !document.fullscreenElement && closeKaraoke();
  document.addEventListener('keydown', onKey);
  const iv = setInterval(tick, 250);
  on('player:track', show); // (sans effet une fois l'écran fermé)
  tick();
  kara = () => {
    clearInterval(iv);
    unmount?.();
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement === ov) document.exitFullscreen().catch(() => {});
    ov.classList.add('closing');
    setTimeout(() => ov.remove(), 200);
  };
}
export function closeKaraoke() {
  kara?.();
  kara = null;
}
// Choix de 1 à 7 lignes de paroles, puis image ou vidéo Story (même DA que le récap, avec le passage du son)
function pickLyricLines(track, l) {
  const lines = l.lines.map((x, i) => ({ ...x, i })).filter((x) => x.text.trim() && x.text.trim() !== '♪');
  const picked = new Set();
  const ov = document.createElement('div');
  ov.className = 'story-save lyr-pick';
  ov.innerHTML = `<div class="ss-box"><h3 style="margin:0 0 4px">Choisis 1 à 7 lignes</h3><p class="muted" style="margin:0 0 10px;font-size:13px">Touche les lignes à mettre dans ta Story</p>
    <div class="lp-list">${lines.map((x) => `<button class="lp-line" data-i="${x.i}">${esc(x.text)}</button>`).join('')}</div>
    <div class="se-btns"><button class="btn primary" data-x="go" disabled>Créer la Story</button><button class="btn ghost" data-x="close">Annuler</button></div></div>`;
  document.body.appendChild(ov);
  const go = ov.querySelector('[data-x=go]');
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-x=close]')) return ov.remove();
    const b = e.target.closest('.lp-line');
    if (b) {
      const i = Number(b.dataset.i);
      if (picked.has(i)) picked.delete(i);
      else if (picked.size < 7) picked.add(i);
      b.classList.toggle('on', picked.has(i));
      go.disabled = !picked.size;
      return;
    }
    if (e.target.closest('[data-x=go]') && picked.size) {
      const idx = [...picked].sort((a, b2) => a - b2);
      const chosen = idx.map((i) => l.lines[i]);
      // Lignes autour (2 avant, 2 après) : elles défilent dans la vidéo, plus pâles
      const from = Math.max(0, idx[0] - 2);
      const to = Math.min(l.lines.length - 1, idx[idx.length - 1] + 2);
      const around = l.lines.slice(from, to + 1).map((x, k) => ({ text: x.text, t: x.t, chosen: idx.includes(from + k) })).filter((x) => x.text.trim());
      ov.remove();
      import('./views-wrapped.js').then((m) => m.shareLyricsStory(track, chosen.map((x) => x.text), l.synced ? chosen[0].t : null, { lines: around, synced: !!l.synced }));
    }
  });
}
