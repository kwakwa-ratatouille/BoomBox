// Paroles (synchronisées si possible) : le serveur interroge plusieurs sources, voir server/lyrics.js.
import { api, on } from './state.js';
import { player, ctl } from './player.js';
import { esc, artistNames, icon, fmtTime } from './ui.js';

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
  const scroller = el.closest('.kara-lyrics, .view, #rightpanel, .fp-lyrics, #fullplayer') || el;
  const onScroll = () => (userScroll = Date.now());
  scroller.addEventListener('wheel', onScroll, { passive: true });
  scroller.addEventListener('touchmove', onScroll, { passive: true });

  getLyrics(track).then((l) => {
    if (!alive) return;
    lyr = l;
    if (!l) {
      el.innerHTML = '<p class="muted" style="padding:24px 0">Pas de paroles disponibles pour ce titre.</p>';
      return;
    }
    el.innerHTML = (l.source ? `<div class="lyrics-source">Paroles : ${esc(l.source)}${l.synced ? '' : ' · non synchronisées'}</div>` : '')
      + `<div class="lyrics ${l.synced ? '' : 'plain'}">${l.lines.map((x, i) => `<p data-i="${i}">${esc(x.text)}</p>`).join('')}</div>`;
    if (l.synced) {
      el.querySelector('.lyrics').onclick = (e) => {
        const p = e.target.closest('p');
        if (p) ctl.seek(l.lines[p.dataset.i].t);
      };
    }
    tick();
  });

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
      if (cur && Date.now() - userScroll > 3000) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  const iv = setInterval(tick, 200);
  return () => {
    alive = false;
    clearInterval(iv);
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