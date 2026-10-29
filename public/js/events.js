// Thèmes d'événements (Noël, Halloween, Saint-Valentin, été…) : branchement du moteur events-pixel.js dans l'appli.
// - thème du jour selon la date (réglage « Auto / Toujours le thème de base », anniversaire, événement coupé) ;
// - <html data-event="…"> (couleurs du thème, voir app.css), logo habillé, fond animé de l'accueil et des bannières ;
// - textes du bandeau d'accueil et des playlists de saison (events-data.js).
// Seulement en DA pixel : en DA Spotify, rien ne change.
import { BBEvents } from './events-pixel.js';
import { EVENT_TEXT } from './events-data.js';

export const B = BBEvents;
const get = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {}
};
const pixelDA = () => (get('bb-da') || 'pixel') === 'pixel';

export let current = { id: 'base', key: null };

// Thème du jour. date : pour les tests (simuler Noël…), sinon aujourd'hui
export function compute(date = new Date()) {
  if (!pixelDA()) return { id: 'base', key: null };
  return B.eventFor(date, { mode: get('bb-events') || 'auto', muted: get('bb-event-off'), birthday: get('bb-birthday') });
}

const logoUrl = (id) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(B.logoSVG(id, 64))}`;

// Applique le thème : attribut sur <html>, logos, mémorisé pour le prochain démarrage (pas de flash, voir index.html)
export function apply(date) {
  current = compute(date);
  const id = current.id;
  const root = document.documentElement;
  if (id === 'base') delete root.dataset.event;
  else root.dataset.event = id;
  const logo = id === 'base' ? null : logoUrl(id);
  set('bb-event-cache', id);
  set('bb-event-logo', logo);
  document.querySelectorAll('.brand-logo, .sp-box').forEach((img) => {
    if (!img.dataset.baseSrc) img.dataset.baseSrc = img.getAttribute('src');
    img.src = logo || img.dataset.baseSrc;
  });
  window.dispatchEvent(new CustomEvent('bb-event', { detail: current }));
  return current;
}

export const active = () => current.id !== 'base';
export const eventLogo = () => (active() ? logoUrl(current.id) : '/assets/logo-symbol.png?v=2');
// Peintre du fond animé du thème (même signature que fieldPainter de pixel-bg.js), ou null
export const painter = () => (active() ? B.themePainter(current.id) : null);
export const theme = () => B.THEMES[current.id];

// Textes : bandeau et playlists de saison, avec le prénom du profil
export function texts(name = '') {
  const t = EVENT_TEXT[current.id];
  if (!t || !active()) return null;
  const who = (s) => String(s || '').replace(/Matis/g, name || '').replace(/,\s*!/, ' !').replace(/\s+!/, ' !');
  return { banner: (t.banner || []).map(who), playlists: t.playlists || [], card: t.card };
}

// « Couper le thème » (bandeau) : seulement cette occurrence de l'événement ; « Réactiver » l'annule
export function mute() {
  if (current.key) set('bb-event-off', current.key);
  return apply();
}
export function unmute() {
  set('bb-event-off', null);
  return apply();
}
export const mutedNow = () => !!compute().muted;
export const settings = {
  mode: () => get('bb-events') || 'auto',
  setMode: (m) => (set('bb-events', m === 'base' ? 'base' : 'auto'), apply()),
  birthday: () => get('bb-birthday') || '',
  setBirthday: (v) => (set('bb-birthday', /^\d{2}-\d{2}$/.test(v || '') ? v : null), apply()),
};

// Bandeau de l'accueil : une fois par jour pendant l'événement (✕ le ferme pour la journée)
export const bannerKey = () => `bb-event-banner-${current.key}-${new Date().toDateString()}`;
export const bannerHidden = () => !!get(bannerKey());
export const hideBanner = () => set(bannerKey(), '1');

// Pochette pixel d'une playlist de saison : dégradé tramé aux couleurs du thème + logo du thème (24×24 agrandi)
export function seasonCover(i = 0) {
  const th = theme();
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const g = c.getContext('2d');
  const img = g.createImageData(24, 24);
  const a = B.rgb(th.accent);
  const b = B.rgb(th.bg || '#131019');
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const v = (y + x * 0.4 + i * 5) / 34 + (B.hash(x, y, i) - 0.5) * 0.15;
      const k = v > B.BAYER[(y % 4) * 4 + (x % 4)] ? 0.85 : 0.25;
      const o = (y * 24 + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[o + ch] = b[ch] + (a[ch] - b[ch]) * k * (1 - y / 40);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}
