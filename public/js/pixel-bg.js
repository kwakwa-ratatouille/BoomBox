// Fonds animés pixel art (DA « pixel » uniquement) : dégradé tramé Bayer 4×4, rendu des pochettes de /assets/pixel/.
// Canvas basse résolution (1 cellule = 8 px CSS) agrandi en pixelated, redessiné à 10 images/s pour un mouvement
// saccadé rétro. Plusieurs styles (vagues, pluie, étoiles, ondes, plasma, cœurs) ; couleurs tirées de la couleur
// d'interface choisie. Utilisé pour la party, le récap, l'en-tête Jam, l'accueil et les bannières de playlists.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const hash = (x, y, z = 0) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const rgb = (hex) => {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, k) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * k));

export const isPixelDA = () => {
  try { return (localStorage.getItem('bb-da') || 'pixel') === 'pixel'; } catch { return true; }
};
// Couleur d'interface en cours (réglée dans les Paramètres, ou celle de la pochette en mode Auto)
export const accentColor = () => (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b07cf7');
// Dégradé du fond sombre de l'appli vers une couleur
export const accentPalette = (c = accentColor()) => ['#131019', mix('#131019', c, 0.22), mix('#131019', c, 0.5), mix('#131019', c, 0.82)];
export const PARTY_PALETTE = ['#131019', '#241D33', '#3A2A63', '#8A55D8'];
export const PARTY_ACCENTS = ['#2EF28B', '#FFD34D'];

// Styles proposés pour les bannières de playlists
export const BACKDROP_STYLES = { waves: 'Vagues', rain: 'Pluie de pixels', stars: 'Étoiles', rings: 'Ondes', plasma: 'Plasma' };

// Valeur 0..1 de chaque cellule selon le style
const FIELDS = {
  waves: (x, y, t, w, h, sp) => 0.5 + 0.5 * Math.sin((x + y) * 0.18 - t * sp),
  rings: (x, y, t, w, h, sp) => 0.5 + 0.5 * Math.sin(Math.hypot(x - w / 2, (y - h / 2) * 1.4) * 0.32 - t * sp * 2.2),
  plasma: (x, y, t, w, h, sp) => (Math.sin(x * 0.13 + t * sp) + Math.sin(y * 0.19 - t * sp * 0.8) + Math.sin((x + y) * 0.09 + t * sp * 1.3) + 3) / 6,
  rain: (x, y, t, w, h, sp) => {
    const len = 4 + Math.floor(hash(x, 7) * 7);
    const head = (t * sp * (5 + hash(x, 3) * 6) + hash(x, 1) * (h + 20)) % (h + 20) - 4;
    const d = head - y;
    return 0.12 + (d >= 0 && d < len ? 0.88 * (1 - d / len) : 0) + (y / h) * 0.1;
  },
  stars: (x, y, t, w, h, sp) => {
    const base = 0.08 + 0.22 * (y / h);
    const r = hash(x, y, 11);
    return r < 0.035 ? Math.max(base, 0.5 + 0.5 * Math.sin(t * sp * 3 + r * 900)) : base;
  },
  hearts: (x, y, t, w, h, sp) => 0.3 + 0.6 * (0.5 + 0.5 * Math.sin((x - y) * 0.12 + t * sp * 0.6)),
};
// Cœur pixel 7×6 qui monte (Titres likés)
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

// host : élément qui reçoit le fond (le canvas est placé derrière son contenu). Renvoie une fonction d'arrêt.
export function pixelBackdrop(host, palette = accentPalette(), { style = 'waves', accents = [], speed = 0.5, cell = 8, fps = 10, accentRate = 0.004 } = {}) {
  if (!host || !isPixelDA()) return () => {};
  host.querySelector(':scope > canvas.pxbg')?._stop?.();
  const field = FIELDS[style] || FIELDS.waves;
  const cv = document.createElement('canvas');
  cv.className = 'pxbg';
  cv.setAttribute('aria-hidden', 'true');
  host.classList.add('has-pxbg');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.prepend(cv);
  const g = cv.getContext('2d');
  const cols = palette.map(rgb);
  const acc = accents.map(rgb);
  const top = rgb(mix(palette[palette.length - 1], '#ffffff', 0.55)); // cœurs : couleur la plus claire
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, img = null, timer = 0, stopped = false;
  const size = () => {
    const r = host.getBoundingClientRect();
    w = Math.max(1, Math.ceil(r.width / cell));
    h = Math.max(1, Math.ceil(r.height / cell));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
      img = g.createImageData(w, h);
    }
  };
  const put = (d, x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
    d[o + 3] = 255;
  };
  const draw = (t) => {
    if (!img) return;
    const d = img.data;
    const n = cols.length - 1;
    const tick = Math.floor(t * 0.6); // les cellules d'accent changent de place de temps en temps
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.max(0, Math.min(1, field(x, y, t, w, h, speed)));
        const s = v * n;
        let k = Math.floor(s);
        if (s - k > BAYER[(y & 3) * 4 + (x & 3)]) k++;
        let c = cols[Math.min(n, k)];
        if (acc.length && v > 0.75 && hash(x, y, tick) < accentRate) c = acc[Math.floor(hash(y, x, tick) * acc.length)];
        put(d, x, y, c);
      }
    }
    // Titres likés : des cœurs pixel montent doucement
    if (style === 'hearts') {
      const count = Math.max(3, Math.round(w / 14));
      for (let i = 0; i < count; i++) {
        const hx = Math.floor(hash(i, 5) * (w - 7));
        const span = h + 8;
        const hy = Math.floor(span - ((t * speed * (2 + hash(i, 9) * 2.5) + hash(i, 2) * span) % span)) - 6;
        HEART.forEach((row, ry) => [...row].forEach((ch, rx) => ch === '#' && put(d, hx + rx, hy + ry, top)));
      }
    }
    g.putImageData(img, 0, 0);
  };
  const t0 = performance.now();
  const loop = () => {
    timer = 0;
    if (stopped) return;
    if (!host.isConnected) return stop(); // écran quitté
    if (!host.getClientRects().length) return (timer = setTimeout(loop, 1000)); // masqué : on attend sans dessiner
    if (!w || cv.width !== Math.ceil(host.getBoundingClientRect().width / cell)) size();
    if (document.hidden) return; // repris par visibilitychange
    draw((performance.now() - t0) / 1000);
    timer = setTimeout(loop, 1000 / fps);
  };
  const onVis = () => !document.hidden && !timer && !still && loop();
  const ro = new ResizeObserver(() => (size(), still && draw(0)));
  ro.observe(host);
  // Contenu redessiné (innerHTML) : on remet le canvas derrière
  const mo = new MutationObserver(() => !stopped && !cv.isConnected && (host.prepend(cv), host.classList.add('has-pxbg')));
  mo.observe(host, { childList: true });
  size();
  draw(still ? 4 : 0);
  if (!still) {
    document.addEventListener('visibilitychange', onVis);
    timer = setTimeout(loop, 1000 / fps);
  }
  function stop() {
    stopped = true;
    clearTimeout(timer);
    ro.disconnect();
    mo.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    cv.remove();
    host.classList.remove('has-pxbg');
  }
  cv._stop = stop;
  return stop;
}
