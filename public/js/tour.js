// Visite guidée au premier lancement : un projecteur sur chaque vrai bouton de l'écran et une bulle courte.
// Les étapes dont le bouton n'est pas affiché (PC ou téléphone, écran étroit…) sont sautées toutes seules.
// Suivant / Retour / Passer, flèches du clavier et Échap, ou un glissement du doigt sur la bulle.
// Une fois vue (ou passée), elle ne revient plus ; Paramètres → « Revoir la visite guidée » la relance.
import { state } from './state.js';
import { isNative } from './native.js';

const DONE_KEY = 'boombox.tourDone';
export const tourDone = () => !!localStorage.getItem(DONE_KEY);

// Premier élément vraiment affiché parmi les sélecteurs
const visible = (sel) => [...document.querySelectorAll(sel)].find((el) => {
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight;
});

function steps() {
  const name = state.profile?.name ? ` ${state.profile.name}` : '';
  const touch = isNative || !!visible('#mobilenav'); // barre du bas affichée = mise en page téléphone
  return [
    { emoji: '👋', title: `Bienvenue${name} !`, text: 'Boombox, c’est toute ta musique gratuite, synchronisée sur tous tes appareils. Petit tour en 1 minute ?', next: 'C’est parti' },
    { target: '#search-input, #mobilenav [data-nav="search"]', emoji: '🔎', title: 'Cherche n’importe quel son', text: 'Un titre, un artiste, un album… ou même quelques paroles. Le micro marche aussi.' },
    { target: '#mobilenav [data-nav="library"], #sidebar .lib-title', emoji: '📚', title: 'Ta bibliothèque', text: 'Tes playlists et tes titres likés ❤️. Tout est sauvegardé et suit sur ton téléphone et ton PC.' },
    { target: '#btn-import', emoji: '⬇️', title: 'Ramène tes playlists', text: 'Spotify, Deezer, Apple Music, YouTube : colle un lien ou importe un fichier, Boombox retrouve les sons.' },
    { target: '#mobilenav [data-nav="discover"], #sidebar [data-nav="discover"]', emoji: '🧭', title: 'Découvre', text: 'Des nouveaux sons et artistes choisis selon ce que tu écoutes, par style ou au hasard.' },
    { target: '#mobilenav [data-nav="ai"], #sidebar [data-nav="ai"]', emoji: '✨', title: 'Demande à l’IA', text: 'Écris comme à un pote : « fais-moi une playlist chill pour la route » et c’est fait.' },
    { emoji: touch ? '👆' : '🖱️', title: 'Sur un son', gestures: touch
      ? [['👉', 'Glisse à droite', 'ajouter à la file d’attente'], ['👈', 'Glisse à gauche', 'ajouter à une playlist'], ['✋', 'Appui long', 'toutes les options']]
      : [['▶️', 'Un clic', 'le lancer'], ['🖱️', 'Clic droit', 'toutes les options'], ['❤️', 'Le cœur', 'le liker']] },
    { target: '#playerbar', emoji: '🎧', title: 'Le lecteur', text: touch ? 'Touche-le pour l’ouvrir en grand : paroles, file d’attente, automix. Glisse-le pour changer de son.' : 'Paroles, file d’attente, automix et fondu enchaîné. Touche la pochette pour l’ouvrir en grand.' },
    { target: '#btn-friends', emoji: '👥', title: 'Tes potes', text: 'Ce qu’ils écoutent en direct, vos messages, et la Jam pour écouter ensemble.' },
    { target: '#btn-rank', emoji: '🏆', title: 'Le classement', text: 'Qui écoute le plus cette semaine ? Grimpe dans le top.' },
    { target: '#btn-profile', emoji: '⚙️', title: 'Ton profil et les réglages', text: 'Lie ton téléphone et ton PC, change de couleur, et retrouve cette visite quand tu veux.' },
    { emoji: '🎶', title: 'À toi de jouer !', text: 'Cherche ton son préféré et lance-le. Bonne écoute !', next: 'Commencer' },
  ];
}

let running = false;
export function startTour({ force = false } = {}) {
  if (running || (!force && tourDone())) return;
  running = true;
  // Fenêtres ouvertes (panneau, plein écran) : la visite montre l'écran principal
  document.querySelector('#fullplayer:not(.hidden)')?.classList.add('hidden');
  const all = steps();
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  const spot = root.querySelector('.tour-spot');
  const card = root.querySelector('.tour-card');
  let i = 0;
  let list = all;

  const finish = () => {
    localStorage.setItem(DONE_KEY, String(Date.now()));
    removeEventListener('resize', place);
    removeEventListener('keydown', onKey, true);
    root.classList.add('out');
    setTimeout(() => root.remove(), 300);
    running = false;
  };
  const go = (d) => {
    i += d;
    if (i >= list.length) return finish();
    if (i < 0) i = 0;
    render();
  };

  function place() {
    const s = list[i];
    const el = s.target && visible(s.target);
    card.classList.toggle('center', !el);
    spot.classList.toggle('none', !el);
    if (!el) {
      card.style.left = card.style.top = '';
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 8;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // Bulle sous l'élément s'il y a la place, sinon au-dessus ; toujours dans l'écran
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const below = r.bottom + pad + 14 + ch < innerHeight - 8;
    const top = below ? r.bottom + pad + 14 : Math.max(8, r.top - pad - 14 - ch);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - cw / 2), innerWidth - cw - 8);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.dataset.side = below ? 'below' : 'above';
    card.style.setProperty('--arrow', `${Math.min(Math.max(18, r.left + r.width / 2 - left), cw - 18)}px`);
  }

  function render() {
    // Étapes sans bouton visible à l'écran : sautées (sauf les cartes centrées, prévues sans cible)
    list = all.filter((s) => !s.target || visible(s.target));
    const s = list[i];
    const last = i === list.length - 1;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    card.innerHTML = `
      ${last ? '' : '<button class="tour-skip" aria-label="Passer le tuto">Passer le tuto ✕</button>'}
      <div class="tour-emoji">${s.emoji}</div>
      <h3>${esc(s.title)}</h3>
      ${s.text ? `<p>${esc(s.text)}</p>` : ''}
      ${s.gestures ? `<ul class="tour-gestures">${s.gestures.map(([e, a, b]) => `<li><span>${e}</span><b>${esc(a)}</b><em>${esc(b)}</em></li>`).join('')}</ul>` : ''}
      <div class="tour-dots">${list.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'seen' : ''}"></i>`).join('')}</div>
      <div class="tour-actions">
        <span style="flex:1"></span>
        ${i > 0 && !last ? '<button class="tour-back" aria-label="Retour">‹</button>' : ''}
        <button class="tour-next">${esc(s.next || (last ? 'Commencer' : 'Suivant'))}</button>
      </div>`;
    card.querySelector('.tour-next').onclick = () => go(1);
    card.querySelector('.tour-back')?.addEventListener('click', () => go(-1));
    card.querySelector('.tour-skip')?.addEventListener('click', finish);
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
    place();
    card.querySelector('.tour-next').focus({ preventScroll: true });
  }

  const onKey = (e) => {
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // Glisser la bulle : gauche = suivant, droite = retour
  let x0 = null;
  card.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  card.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
  // Un toucher en dehors de la bulle ne lance rien derrière : la bulle sautille pour se faire remarquer
  root.addEventListener('click', (e) => {
    if (card.contains(e.target)) return;
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
  });
  addEventListener('resize', place);
  addEventListener('keydown', onKey, true);
  render();
}
