// Fond animé pixel art (DA « pixel » uniquement) : dégradé tramé Bayer 4×4 en bandes diagonales qui avancent,
// rendu des pochettes de /assets/pixel/. Canvas basse résolution (1 cellule = 8 px CSS) agrandi en pixelated,
// redessiné à 10 images/s pour un mouvement saccadé rétro. Réservé aux écrans festifs (party, récap, en-tête Jam).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const hash = (x, y, z) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const rgb = (hex) => {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const isPixelDA = () => {
  try { return (localStorage.getItem('bb-da') || 'pixel') === 'pixel'; } catch { return true; }
};

// host : élément qui reçoit le fond (le canvas est placé derrière son contenu). Renvoie une fonction d'arrêt.
export function pixelBackdrop(host, palette, { accents = [], speed = 0.5, cell = 8, fps = 10, accentRate = 0.004 } = {}) {
  if (!host || !isPixelDA()) return () => {};
  host.querySelector(':scope > canvas.pxbg')?._stop?.();
  const cv = document.createElement('canvas');
  cv.className = 'pxbg';
  cv.setAttribute('aria-hidden', 'true');
  host.classList.add('has-pxbg');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.prepend(cv);
  const g = cv.getContext('2d');
  const cols = palette.map(rgb);
  const acc = accents.map(rgb);
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
  const draw = (t) => {
    if (!img) return;
    const d = img.data;
    const n = cols.length - 1;
    const tick = Math.floor(t * 0.6); // les cellules d'accent changent de place de temps en temps
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 0.5 + 0.5 * Math.sin((x + y) * 0.18 - t * speed);
        const s = v * n;
        let k = Math.floor(s);
        if (s - k > BAYER[(y & 3) * 4 + (x & 3)]) k++;
        let c = cols[Math.min(n, k)];
        if (acc.length && v > 0.75 && hash(x, y, tick) < accentRate) c = acc[Math.floor(hash(y, x, tick) * acc.length)];
        const o = (y * w + x) * 4;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
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
  draw(0);
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

export const PARTY_PALETTE = ['#131019', '#241D33', '#3A2A63', '#8A55D8'];
export const PARTY_ACCENTS = ['#2EF28B', '#FFD34D'];
