// Mode voiture : écran simplifié, très gros boutons faciles à viser sans regarder (téléphone sur un support).
// Pochette, titre, précédent / lecture / suivant géants, like, et balayage gauche / droite pour changer de son.
import { player, ctl } from './player.js';
import { on, isLiked, toggleLike } from './state.js';
import { icon, esc, artistNames } from './ui.js';

let close = null;

export function openCarMode() {
  if (close) return closeCarMode();
  const ov = document.createElement('div');
  ov.id = 'carmode';
  ov.innerHTML = `<div class="car-bg"></div>
    <header class="car-head"><span class="car-title">Mode voiture</span><button class="icon-btn" data-c="close" title="Quitter le mode voiture">${icon('close', 30)}</button></header>
    <div class="car-art"></div>
    <div class="car-info"><b></b><span></span></div>
    <div class="car-bar"><div></div></div>
    <div class="car-ctrl"><button data-c="prev" aria-label="Précédent">${icon('prev', 56)}</button><button class="car-play" data-c="toggle" aria-label="Lecture / pause">${icon('play', 64)}</button><button data-c="next" aria-label="Suivant">${icon('next', 56)}</button></div>
    <div class="car-sub"><button data-c="like" aria-label="Liker">${icon('heart', 36)}</button><button data-c="shuffle" aria-label="Aléatoire">${icon('shuffle', 36)}</button></div>`;
  document.body.appendChild(ov);
  // Garde l'écran allumé pendant la conduite (si le navigateur le permet)
  let lock = null;
  navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
  let shown = null;
  const draw = () => {
    if (!ov.isConnected) return;
    const t = player.track;
    if (t && t.id !== shown) {
      shown = t.id;
      const img = esc((t.thumb || '').replace(/=w\d+-h\d+[^&?/]*/, '=w800-h800-l90-rj'));
      ov.querySelector('.car-art').innerHTML = img ? `<img src="${img}" alt="" referrerpolicy="no-referrer">` : '';
      ov.querySelector('.car-bg').innerHTML = img ? `<img src="${img}" alt="" referrerpolicy="no-referrer">` : '';
      ov.querySelector('.car-info b').textContent = t.title;
      ov.querySelector('.car-info span').textContent = artistNames(t);
    }
    const d = player.shownDuration?.() || player.duration();
    ov.querySelector('.car-bar div').style.width = (d ? Math.min(100, (player.time() / d) * 100) : 0) + '%';
    ov.querySelector('[data-c=toggle]').innerHTML = icon(player.paused ? 'play' : 'pause', 64);
    const liked = t && isLiked(t.id);
    const lb = ov.querySelector('[data-c=like]');
    lb.classList.toggle('on', !!liked);
    lb.innerHTML = icon(liked ? 'heartFill' : 'heart', 36);
    ov.querySelector('[data-c=shuffle]').classList.toggle('on', player.shuffle);
  };
  ov.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (!c) return;
    if (c === 'close') return closeCarMode();
    if (c === 'like') return player.track && toggleLike(player.track);
    if (c === 'shuffle') return ctl.toggleShuffle();
    ctl[c]();
  });
  // Balayage sur la pochette : gauche = suivant, droite = précédent
  let x0 = null;
  ov.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  ov.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 70) dx < 0 ? ctl.next() : ctl.prev();
  });
  const iv = setInterval(draw, 400);
  on('player:track', draw);
  draw();
  close = () => {
    clearInterval(iv);
    lock?.release?.().catch(() => {});
    ov.remove();
  };
}

export function closeCarMode() {
  close?.();
  close = null;
}
