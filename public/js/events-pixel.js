// Boombox · thèmes d'événements (module autonome)
// - calendrier : quel thème est actif à une date donnée
// - logos 32×32 habillés (à partir de design/logo-pixel/logo-pixel.svg)
// - peintres de fond compatibles avec pixel-bg.js : (img, w, h, t) sur une ImageData basse résolution
const BBEvents = (() => {
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
  const lum = (c) => {
    const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  // ───────────────────────── Calendrier ─────────────────────────
  const EVENTS = [
    { id: 'noel', from: [12, 1], to: [12, 26] },
    { id: 'nouvel-an', from: [12, 27], to: [1, 2] },
    { id: 'valentin', from: [2, 7], to: [2, 14] },
    { id: 'paques', easter: [-6, 1] }, // du lundi avant Pâques au lundi de Pâques
    { id: 'musique', from: [6, 18], to: [6, 21] },
    { id: 'ete', from: [7, 1], to: [8, 31] },
    { id: 'rentree', from: [9, 1], to: [9, 15] },
    { id: 'halloween', from: [10, 20], to: [10, 31] },
  ];
  // Dimanche de Pâques (algorithme de Meeus / Jones / Butcher)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Occurrence de l'événement qui commence pendant l'année `year` : [début, fin] (dates incluses)
  function rangeOf(ev, year) {
    if (typeof ev === 'string') ev = EVENTS.find((e) => e.id === ev);
    if (ev.easter) {
      const e = easter(year);
      return [new Date(year, e.getMonth(), e.getDate() + ev.easter[0]), new Date(year, e.getMonth(), e.getDate() + ev.easter[1])];
    }
    const start = new Date(year, ev.from[0] - 1, ev.from[1]);
    const endYear = ev.to[0] < ev.from[0] ? year + 1 : year;
    return [start, new Date(endYear, ev.to[0] - 1, ev.to[1])];
  }
  // birthday : 'MM-JJ' ; mode : 'auto' | 'base' ; muted : clé renvoyée par instanceKey() pour couper un seul événement
  function eventFor(date = new Date(), { birthday = null, mode = 'auto', muted = null } = {}) {
    if (mode === 'base') return { id: 'base', key: null };
    const d = day0(date), y = d.getFullYear();
    let found = null;
    if (birthday) {
      let [bm, bd] = birthday.split('-').map(Number);
      const leap = new Date(y, 1, 29).getMonth() === 1;
      if (bm === 2 && bd === 29 && !leap) bd = 28; // né un 29 février : fêté le 28 les autres années
      if (d.getMonth() + 1 === bm && d.getDate() === bd) found = { id: 'anniversaire', key: 'anniversaire-' + y };
    }
    if (!found) {
      for (const ev of EVENTS) {
        for (const yy of [y - 1, y]) {
          const [s, e] = rangeOf(ev, yy);
          if (d >= s && d <= e) { found = { id: ev.id, key: ev.id + '-' + yy }; break; }
        }
        if (found) break;
      }
    }
    if (!found || (muted && muted === found.key)) return { id: 'base', key: found ? found.key : null, muted: !!found };
    return found;
  }

  // ───────────────────────── Thèmes ─────────────────────────
  // swatches : [couleur, rôle] ; backdrop : réglages du fond (style = styles existants de pixel-bg.js)
  const THEMES = {
    base: {
      name: 'Thème de base', dates: 'Toute l’année', accent: '#b07cf7', accent2: '#2ef28b', bg: '#131019',
      swatches: [['#131019', 'Fond'], ['#b07cf7', 'Accent'], ['#2ef28b', 'En direct'], ['#d4b3ff', 'Accent clair'], ['#8754d6', 'Accent sombre']],
      backdrop: { style: 'waves', speed: 0.4, overlay: null, opts: {} },
    },
    noel: {
      name: 'Noël', dates: '1er – 26 décembre', accent: '#ff5a64', accent2: '#47d17f', bg: '#0e1220',
      swatches: [['#0e1220', 'Nuit bleue'], ['#ff5a64', 'Rouge bonnet'], ['#47d17f', 'Sapin'], ['#ffd166', 'Guirlande'], ['#eef3ff', 'Neige']],
      backdrop: { style: 'waves', speed: 0.22, overlay: 'snow', opts: { density: 0.006, speed: [2, 5], colors: ['#eef3ff', '#b9c6e4'], big: 0.2, ground: true } },
    },
    'nouvel-an': {
      name: 'Nouvel An', dates: '27 décembre – 2 janvier', accent: '#ffcf4d', accent2: '#ff5fa2', bg: '#0d0b1c',
      swatches: [['#0d0b1c', 'Minuit'], ['#ffcf4d', 'Or'], ['#ff5fa2', 'Rose fête'], ['#c9d3ff', 'Argent'], ['#fff1b8', 'Champagne']],
      backdrop: { style: 'stars', speed: 0.5, overlay: 'fireworks', opts: { bursts: 3, period: 3.2, spokes: 14, radius: 0.18, colors: ['#ffcf4d', '#ff5fa2', '#c9d3ff', '#fff1b8'] } },
    },
    valentin: {
      name: 'Saint-Valentin', dates: '7 – 14 février', accent: '#ff6b9a', accent2: '#ff3d6e', bg: '#1a0f17',
      swatches: [['#1a0f17', 'Bordeaux nuit'], ['#ff6b9a', 'Rose'], ['#ff3d6e', 'Framboise'], ['#ffc2d6', 'Rose pâle'], ['#b07cf7', 'Violet Boombox']],
      backdrop: { style: 'waves', speed: 0.3, overlay: 'hearts', opts: { per: 1 / 14, speed: [2, 4], colors: ['#ff6b9a', '#ff3d6e', '#ffc2d6'], small: 0.5 } },
    },
    paques: {
      name: 'Pâques', dates: 'Semaine de Pâques', accent: '#9be38c', accent2: '#f7a8d8', bg: '#11141a',
      swatches: [['#11141a', 'Fond'], ['#9be38c', 'Vert tendre'], ['#f7a8d8', 'Rose dragée'], ['#ffd36e', 'Jaune poussin'], ['#9ec9ff', 'Bleu ciel']],
      backdrop: { style: 'plasma', speed: 0.25, overlay: 'eggs', opts: { per: 1 / 18, speed: [1, 2.2], colors: ['#9be38c', '#f7a8d8', '#9ec9ff', '#ffd36e'], petals: 0.004, petalColors: ['#ffffff', '#f7a8d8'] } },
    },
    musique: {
      name: 'Fête de la musique', dates: '18 – 21 juin', accent: '#2ef28b', accent2: '#ffd34d', bg: '#0c1316',
      swatches: [['#0c1316', 'Fond'], ['#2ef28b', 'Vert scène'], ['#ffd34d', 'Jaune'], ['#ff6b4a', 'Orange ampli'], ['#4dc3ff', 'Bleu néon']],
      backdrop: { style: 'rings', speed: 0.35, overlay: 'notes', opts: { per: 1 / 12, speed: [2, 4], colors: ['#2ef28b', '#ffd34d', '#ff6b4a', '#4dc3ff'], eq: true, bpm: 120 } },
    },
    ete: {
      name: 'Été / vacances', dates: '1er juillet – 31 août', accent: '#ffb347', accent2: '#3fd0c9', bg: '#0b1418',
      swatches: [['#0b1418', 'Mer de nuit'], ['#ffb347', 'Abricot'], ['#3fd0c9', 'Lagon'], ['#ffe066', 'Soleil'], ['#ff7a7a', 'Corail']],
      backdrop: { style: 'waves', speed: 0.3, overlay: 'summer', opts: { sun: true, sunColors: ['#ffe066', '#ffb347'], per: 1 / 16, speed: [1.5, 3], colors: ['#3fd0c9', '#bff3ef'] } },
    },
    rentree: {
      name: 'Rentrée', dates: '1er – 15 septembre', accent: '#ffd34d', accent2: '#5aa9ff', bg: '#10131a',
      swatches: [['#10131a', 'Tableau'], ['#ffd34d', 'Crayon'], ['#5aa9ff', 'Stylo bleu'], ['#ff6b6b', 'Pomme'], ['#e9e4d8', 'Papier']],
      backdrop: { style: 'plasma', speed: 0.15, overlay: 'school', opts: { grid: 6, gridColor: '#e9e4d8', gridAlpha: 0.07, per: 1 / 16, speed: [1.5, 3], colors: ['#ff9f43', '#ffd34d', '#ff6b6b'] } },
    },
    halloween: {
      name: 'Halloween', dates: '20 – 31 octobre', accent: '#ff8a2a', accent2: '#b07cf7', bg: '#0f0b10',
      swatches: [['#0f0b10', 'Nuit'], ['#ff8a2a', 'Citrouille'], ['#b07cf7', 'Violet sorcier'], ['#9be564', 'Potion'], ['#d9d4e8', 'Os']],
      backdrop: { style: 'plasma', speed: 0.2, overlay: 'spooky', opts: { moon: true, moonColor: '#e8e2c8', fog: 0.35, fogColor: '#4a3d5e', bats: 4, batColor: '#5a4778', eyeColor: '#ff8a2a' } },
    },
    anniversaire: {
      name: 'Anniversaire', dates: 'Le jour de ton anniversaire', accent: '#ff7ac6', accent2: '#7ae0ff', bg: '#151020',
      swatches: [['#151020', 'Fond'], ['#ff7ac6', 'Rose bonbon'], ['#7ae0ff', 'Cyan'], ['#ffd34d', 'Bougie'], ['#b07cf7', 'Violet Boombox']],
      backdrop: { style: 'stars', speed: 0.4, overlay: 'party', opts: { confetti: 0.005, colors: ['#ff7ac6', '#7ae0ff', '#ffd34d', '#b07cf7'], balloons: 3, speed: [1.5, 2.5] } },
    },
  };
  // Dégradé du fond : très sombre, l'accent ne dépasse pas 22 % pour rester derrière le contenu
  const backdropPalette = (id) => { const th = THEMES[id]; return [th.bg, mix(th.bg, th.accent, 0.08), mix(th.bg, th.accent, 0.15), mix(th.bg, th.accent2, 0.22)]; };

  // ───────────────────────── Champs tramés (identiques à pixel-bg.js) ─────────────────────────
  const FIELDS = {
    waves: (x, y, t, w, h, sp) => 0.5 + 0.5 * Math.sin((x + y) * 0.18 - t * sp),
    rings: (x, y, t, w, h, sp) => 0.5 + 0.5 * Math.sin(Math.hypot(x - w / 2, (y - h / 2) * 1.4) * 0.32 - t * sp * 2.2),
    plasma: (x, y, t, w, h, sp) => (Math.sin(x * 0.13 + t * sp) + Math.sin(y * 0.19 - t * sp * 0.8) + Math.sin((x + y) * 0.09 + t * sp * 1.3) + 3) / 6,
    stars: (x, y, t, w, h, sp) => {
      const base = 0.08 + 0.22 * (y / h);
      const r = hash(x, y, 11);
      return r < 0.035 ? Math.max(base, 0.5 + 0.5 * Math.sin(t * sp * 3 + r * 900)) : base;
    },
  };
  function fieldPainter(palette, { style = 'waves', speed = 0.5 } = {}) {
    const field = FIELDS[style] || FIELDS.waves;
    const cols = palette.map(rgb), n = cols.length - 1;
    return (img, w, h, t) => {
      const d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = Math.max(0, Math.min(1, field(x, y, t, w, h, speed)));
        const s = v * n;
        let k = Math.floor(s);
        if (s - k > BAYER[(y & 3) * 4 + (x & 3)]) k++;
        const c = cols[Math.min(n, k)], o = (y * w + x) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    };
  }

  // ───────────────────────── Particules (par-dessus le champ) ─────────────────────────
  // plot(x, y, couleur, opacité) : l'opacité est rendue par tramage Bayer (pas de transparence réelle)
  const plotter = (img, w, h) => {
    const d = img.data;
    return (x, y, c, a = 1) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      if (a < 1 && a <= BAYER[(y & 3) * 4 + (x & 3)]) return;
      const o = (y * w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    };
  };
  const sprite = (pl, rows, x, y, color, a = 1) => rows.forEach((r, ry) => [...r].forEach((ch, rx) => {
    if (ch === '.' || ch === ' ') return;
    pl(x + rx, y + ry, typeof color === 'function' ? color(ch) : color, a);
  }));
  const wrap = (v, m) => ((v % m) + m) % m;
  const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  const HEART_S = ['#.#', '###', '.#.'];
  const EGG = ['.##.', '####', '====', '####', '.##.'];
  const NOTE1 = ['..##', '..#.#', '..#', '###', '###'];
  const NOTE2 = ['.####', '.#..#', '.#..#', '##.##', '##.##'];
  const LEAF = ['.##', '###', '#..'];
  const BAT_A = ['#.....#', '##.#.##', '.#####.', '...#...'];
  const BAT_B = ['...#...', '.#####.', '##.#.##', '#.....#'];
  const BALLOON = ['.###.', '#####', '#####', '.###.', '..#..'];

  const OVERLAYS = {
    // Neige qui tombe + couche au sol
    snow: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h), c = o.colors.map(rgb), n = Math.max(6, Math.round(w * h * o.density));
      for (let i = 0; i < n; i++) {
        const v = o.speed[0] + hash(i, 1) * (o.speed[1] - o.speed[0]);
        const y = wrap(hash(i, 3) * (h + 6) + t * v, h + 6) - 3;
        const x = wrap(hash(i, 2) * w + Math.sin(t * 0.9 + i * 1.7) * 1.5, w);
        const col = c[hash(i, 4) < 0.7 ? 0 : 1];
        if (hash(i, 5) < o.big) { pl(x, y, col); pl(x - 1, y, col, 0.6); pl(x + 1, y, col, 0.6); pl(x, y - 1, col, 0.6); pl(x, y + 1, col, 0.6); }
        else pl(x, y, col);
      }
      if (o.ground) for (let x = 0; x < w; x++) {
        const gh = 1 + Math.round(1 + Math.sin(x * 0.35) * 0.6 + Math.sin(x * 0.13 + 1) * 0.6);
        for (let k = 0; k < gh; k++) pl(x, h - 1 - k, c[k === gh - 1 ? 1 : 0], k === gh - 1 ? 0.6 : 0.95);
      }
    },
    // Feux d'artifice : fusée puis gerbe
    fireworks: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h), cols = o.colors.map(rgb), R = Math.max(4, Math.min(w, h) * o.radius), white = rgb('#ffffff');
      for (let k = 0; k < o.bursts; k++) {
        const tt = t + (k * o.period) / o.bursts, cyc = Math.floor(tt / o.period), lt = tt - cyc * o.period;
        const cx = (0.15 + 0.7 * hash(k, cyc, 1)) * w, cy = (0.12 + 0.4 * hash(cyc, k, 2)) * h;
        const col = cols[Math.floor(hash(k, cyc, 3) * cols.length)];
        if (lt < 0.8) {
          const y = h - (h - cy) * (lt / 0.8);
          pl(cx, y, col); pl(cx, y + 1, col, 0.6); pl(cx, y + 2, col, 0.3);
        } else if (lt < 2.6) {
          const u = (lt - 0.8) / 1.8, r = R * (1 - Math.exp(-4 * u)), fall = u * u * R * 0.35, fade = 1 - u;
          for (let s = 0; s < o.spokes; s++) {
            const a = (s / o.spokes) * Math.PI * 2 + hash(k, cyc, 4) * 6;
            pl(cx + Math.cos(a) * r, cy + Math.sin(a) * r + fall, col, fade);
            pl(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7 + fall * 0.8, col, fade * 0.5);
          }
          if (u < 0.12) pl(cx, cy, white);
        }
      }
    },
    // Cœurs qui montent
    hearts: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h), cols = o.colors.map(rgb), n = Math.max(3, Math.round(w * o.per));
      for (let i = 0; i < n; i++) {
        const big = hash(i, 8) >= o.small, spr = big ? HEART : HEART_S, sw = spr[0].length;
        const v = o.speed[0] + hash(i, 9) * (o.speed[1] - o.speed[0]), span = h + 8;
        const y = span - wrap(t * v + hash(i, 2) * span, span) - 6;
        const x = hash(i, 5) * Math.max(1, w - sw) + Math.sin(t * 1.2 + i) * 1.5;
        sprite(pl, spr, Math.round(x), Math.round(y), cols[i % cols.length], big ? 1 : 0.8);
      }
    },
    // Œufs rayés + pétales
    eggs: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h), cols = o.colors.map(rgb), n = Math.max(3, Math.round(w * o.per));
      for (let i = 0; i < n; i++) {
        const v = o.speed[0] + hash(i, 1) * (o.speed[1] - o.speed[0]), span = h + 8;
        const y = wrap(hash(i, 2) * span + t * v, span) - 6, x = hash(i, 3) * Math.max(1, w - 4) + Math.sin(t * 1.1 + i * 2) * 2;
        const a = cols[i % cols.length], b = cols[(i + 1) % cols.length];
        sprite(pl, EGG, Math.round(x), Math.round(y), (ch) => (ch === '=' ? b : a));
      }
      const pc = o.petalColors.map(rgb), m = Math.round(w * h * o.petals);
      for (let i = 0; i < m; i++) {
        const y = wrap(hash(i, 7) * h + t * (1 + hash(i, 8) * 1.5), h), x = wrap(hash(i, 6) * w + Math.sin(t * 2 + i) * 3, w);
        pl(x, y, pc[i % pc.length], 0.8);
      }
    },
    // Notes qui montent + égaliseur
    notes: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h), cols = o.colors.map(rgb), n = Math.max(3, Math.round(w * o.per));
      const beat = Math.floor((t * o.bpm) / 60);
      for (let i = 0; i < n; i++) {
        const v = o.speed[0] + hash(i, 1) * (o.speed[1] - o.speed[0]), span = h + 8;
        const y = span - wrap(t * v + hash(i, 2) * span, span) - 6, x = hash(i, 3) * Math.max(1, w - 5) + Math.sin(t * 1.5 + i) * 1.5;
        sprite(pl, hash(i, 4) < 0.5 ? NOTE1 : NOTE2, Math.round(x), Math.round(y), cols[(i + beat) % cols.length]);
      }
      if (o.eq) for (let x = 0; x < w; x += 3) {
        const hh = Math.round(1 + 5 * (0.5 + 0.5 * Math.sin(t * 6 + x * 0.7)) * (0.6 + 0.4 * hash(x, beat)));
        for (let k = 0; k < hh; k++) { pl(x, h - 1 - k, cols[0], 0.5); pl(x + 1, h - 1 - k, cols[0], 0.5); }
      }
    },
    // Soleil + bulles
    summer: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h), cols = o.colors.map(rgb);
      if (o.sun) {
        const sc = o.sunColors.map(rgb), r = Math.max(3, Math.min(w, h) * 0.075), cx = w - r * 1.8, cy = r * 1.8;
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
          const dd = Math.hypot(x, y) / r;
          if (dd <= 1) pl(cx + x, cy + y, dd + 0.25 > BAYER[((cy + y) & 3) * 4 + ((cx + x) & 3)] * 1.25 ? sc[1] : sc[0]);
        }
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + t * 0.6;
          for (let s = 1.4; s < 2.1; s += 0.3) pl(cx + Math.cos(a) * r * s, cy + Math.sin(a) * r * s, sc[0], 0.7);
        }
      }
      const n = Math.max(3, Math.round(w * o.per));
      for (let i = 0; i < n; i++) {
        const v = o.speed[0] + hash(i, 1) * (o.speed[1] - o.speed[0]), span = h + 6;
        const y = span - wrap(t * v + hash(i, 2) * span, span) - 3, x = hash(i, 3) * w + Math.sin(t * 2 + i) * 2;
        const rr = hash(i, 4) < 0.5 ? 1 : 2, c = cols[i % cols.length];
        for (let a = 0; a < 12; a++) pl(x + Math.round(Math.cos((a / 12) * Math.PI * 2) * rr), y + Math.round(Math.sin((a / 12) * Math.PI * 2) * rr), c, 0.9);
      }
    },
    // Papier quadrillé + feuilles d'automne
    school: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h), gc = rgb(o.gridColor), cols = o.colors.map(rgb);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x % o.grid === 0 || y % o.grid === 0) pl(x, y, gc, o.gridAlpha);
      const n = Math.max(3, Math.round(w * o.per));
      for (let i = 0; i < n; i++) {
        const v = o.speed[0] + hash(i, 1) * (o.speed[1] - o.speed[0]), span = h + 6;
        const y = wrap(hash(i, 2) * span + t * v, span) - 3, x = hash(i, 3) * w + Math.sin(t * 1.3 + i) * 3;
        const flip = Math.floor(t * 2 + i) % 2;
        sprite(pl, flip ? LEAF : LEAF.map((r) => [...r].reverse().join('')), Math.round(x), Math.round(y), cols[i % cols.length]);
      }
    },
    // Lune, brume, chauves-souris
    spooky: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h);
      if (o.moon) {
        const mc = rgb(o.moonColor), r = Math.max(3, Math.min(w, h) * 0.075), cx = w - r * 2, cy = r * 2;
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
          const dd = Math.hypot(x, y) / r;
          if (dd <= 1) pl(cx + x, cy + y, mc, dd > 0.85 ? 0.6 : 0.95);
        }
        pl(cx - r * 0.3, cy - r * 0.2, rgb(mix(o.moonColor, '#000000', 0.25)));
        pl(cx + r * 0.35, cy + r * 0.3, rgb(mix(o.moonColor, '#000000', 0.25)));
      }
      const fc = rgb(o.fogColor), top = h * (1 - o.fog);
      for (let y = Math.floor(top); y < h; y++) for (let x = 0; x < w; x++) {
        const k = (y - top) / (h - top);
        const v = k * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(x * 0.15 + t * 0.6 + Math.sin(y * 0.3 + t * 0.4) * 2)));
        pl(x, y, fc, v * 0.7);
      }
      const bc = rgb(o.batColor), ec = rgb(o.eyeColor);
      for (let i = 0; i < o.bats; i++) {
        const v = 3 + hash(i, 1) * 3, span = w + 14, dir = i % 2 ? 1 : -1;
        let x = wrap(t * v + hash(i, 2) * span, span) - 7; if (dir < 0) x = w - x;
        const y = (0.1 + 0.45 * hash(i, 3)) * h + Math.sin(t * 2 + i) * 2;
        const fr = Math.floor(t * 6 + i) % 2 ? BAT_A : BAT_B;
        sprite(pl, fr, Math.round(x), Math.round(y), bc);
        pl(Math.round(x) + 3, Math.round(y) + (fr === BAT_A ? 2 : 1), ec);
      }
    },
    // Confettis + ballons
    party: (o) => (img, w, h, t) => {
      const pl = plotter(img, w, h), cols = o.colors.map(rgb), n = Math.max(8, Math.round(w * h * o.confetti));
      for (let i = 0; i < n; i++) {
        const y = wrap(hash(i, 2) * h + t * (2 + hash(i, 1) * 3), h), x = wrap(hash(i, 3) * w + Math.sin(t * 2 + i) * 2, w);
        const c = cols[i % cols.length];
        pl(x, y, c);
        if (Math.floor(t * 3 + i) % 2) pl(x + 1, y, c); else pl(x, y + 1, c);
      }
      for (let i = 0; i < o.balloons; i++) {
        const v = o.speed[0] + hash(i, 5) * (o.speed[1] - o.speed[0]), span = h + 12;
        const y = span - wrap(t * v + hash(i, 6) * span, span) - 10, x = (0.1 + 0.8 * hash(i, 7)) * (w - 5) + Math.sin(t + i) * 1.5;
        sprite(pl, BALLOON, Math.round(x), Math.round(y), cols[(i * 2) % cols.length]);
        for (let s = 0; s < 4; s++) pl(Math.round(x) + 2 + (s % 2), Math.round(y) + 5 + s, rgb('#d4b3ff'), 0.7);
      }
    },
  };

  // Peintre complet d'un thème : champ tramé + particules. Même signature que fieldPainter de pixel-bg.js.
  function themePainter(id, { palette } = {}) {
    const th = THEMES[id] || THEMES.base, b = th.backdrop;
    const base = fieldPainter(palette || backdropPalette(id), { style: b.style, speed: b.speed });
    const ov = b.overlay ? OVERLAYS[b.overlay](b.opts) : null;
    return (img, w, h, t) => { base(img, w, h, t); if (ov) ov(img, w, h, t); };
  }

  // ───────────────────────── Logos ─────────────────────────
  // Logo actuel (design/logo-pixel/logo-pixel.svg), grille 32×32
  const LOGO_BASE = [
    '................................', '................................', '................................',
    '.........aaaaaaaaaaaaaa.........', '.........bbbbbbbbbbbbbb.........', '.........bb..........bb.........',
    '.........bb..........bb.........', '.........bb..........bb.........', '.........bb..........bb.........',
    '....aaaaaaaaaaaaaaaaaaaaaaaa....', '...bbbbbbbbbbbbbbbbbbbbbbbbbb...', '..bbbbbbbbbb........bbbccbbbbd..',
    '..bbbbbbbbbb........bbbccbbbbd..', '..bbbbbbbbbbbbbbbbbbbbbbbbbbbd..', '..bbbbb.....bbbbbbbb.....bbbbd..',
    '..bbbb.......bbbbbb.......bbbd..', '..bbb..bbbbb..bbbb..bb.....bbd..', '..bb..bb...bb..bb...bbb.....bd..',
    '..bb..b.bbb.b..bb...bbbbb...bd..', '..bb..b.bbb.b..bb...bbbbbb..bd..', '..bb..b.bbb.b..bb...bbbbb...bd..',
    '..bb..bb...bb..bb...bbb.....bd..', '..bbb..bbbbb..bbbb..bb.....bbd..', '..bbbb.......bbbbbb.......bbbd..',
    '..bbbbb.....bbbbbbbb.....bbbbd..', '..bbbbbbbbbbbbbbbbbbbbbbbbbbbd..', '...dddddddddddddddddddddddddd...',
    '....dddddddddddddddddddddddd....', '................................', '................................',
    '................................', '................................',
  ];
  const LOGO_COLORS = { a: '#d4b3ff', b: '#b07cf7', c: '#2ef28b', d: '#8754d6' };
  // Habillages : calques [x, y, lignes] posés sur la grille ; '.' = transparent
  const DRESS = {
    base: { colors: {}, layers: [] },
    noel: {
      colors: { R: '#e8434b', r: '#a8252f', W: '#f4f7ff', G: '#2f9e5a', Y: '#ffd34d', B: '#5ec8ff' },
      layers: [
        [8, 0, ['....RRRRRRRR......', '..RRRRRRRRRRRRR.WW', '.rRRRRRRRRRRRRr.WW', 'WWWWWWWWWWWWWWWW..']],
        [4, 8, ['WWWWW']], [23, 8, ['WWWWW']],
        [3, 10, ['GRGGYGGBGGRGGYGGBGGRGGYGGB']],
      ],
    },
    'nouvel-an': {
      colors: { Y: '#ffd34d', P: '#ff5fa2', S: '#dfe6ff', W: '#ffffff' },
      layers: [
        [14, 0, ['..W..', '.YPY.', 'PYPYP']],
        [4, 9, ['YYYYYYYYYYYYYYYYYYYYYYYY']],
        [0, 1, ['P..P..P', '.P.P.P.', '..PSP..', 'PPSWSPP', '..PSP..', '.P.P.P.', 'P..P..P']],
        [25, 2, ['Y..Y..Y', '.Y.Y.Y.', '..YWY..', 'YYWWWYY', '..YWY..', '.Y.Y.Y.', 'Y..Y..Y']],
        [0, 30, ['S']], [30, 29, ['Y']],
      ],
    },
    valentin: {
      colors: { P: '#ff6b9a', R: '#ff3d6e', L: '#ffc2d6' },
      layers: [
        [0, 1, ['.RR.RR.', 'RLRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...']],
        [25, 3, ['PP.PP', 'PPPPP', 'PPPPP', '.PPP.', '..P..']],
        [23, 11, ['RR', 'RR']],
        [0, 28, ['P.P', '.P.']], [28, 29, ['L.L', '.L.']],
      ],
    },
    paques: {
      colors: { W: '#ffffff', P: '#f7a8d8', Y: '#ffd36e', G: '#9be38c', B: '#9ec9ff' },
      layers: [
        [4, 2, ['.W.', 'WWW', 'WPW', 'WPW', 'WPW', 'WPW', 'WWW']],
        [25, 2, ['..W', '.WW', 'WPW', 'WPW', 'WPW', 'WPW', 'WWW']],
        [0, 24, ['.BBB.', 'BBBBB', 'YYYYY', 'BBBBB', 'PPPPP', 'BBBBB', '.BBB.']],
        [27, 25, ['.GG.', 'GGGG', 'PPPP', 'GGGG', 'GGGG', '.GG.']],
      ],
    },
    musique: {
      colors: { G: '#2ef28b', Y: '#ffd34d', C: '#4dc3ff' },
      layers: [
        [0, 1, ['..GG.', '..G.G', '..G..', '.GG..', 'GGG..', '.G...']],
        [24, 1, ['..YYYYY', '..Y...Y', '..Y...Y', '.YY..YY', 'YYY.YYY', '.Y...Y.']],
        [0, 16, ['C', 'C', 'C', 'C', 'C', 'C', 'C']],
        [31, 16, ['C', 'C', 'C', 'C', 'C', 'C', 'C']],
      ],
    },
    ete: {
      colors: { Y: '#ffe066', O: '#ffb347', K: '#1b1a24', k: '#4a4560', W: '#ffffff', R: '#ff5a5a' },
      layers: [
        [8, 0, ['kkkkkkkkkkkkkkkk', 'kKKKKk....kKKKKk', 'kKWKKk....kKWKKk', '.kKKk......kKKk.']],
        [26, 0, ['..YY..', '.YYYY.', 'YYYYYY', 'YYYYYO', '.YYYO.', '..OO..']],
        [0, 22, ['..RWWR..', '.RRWWRR.', 'RR....WW', 'WW....RR', 'WW....RR', 'RR....WW', '.RRWWRR.', '..RWWR..']],
      ],
    },
    rentree: {
      colors: { Y: '#ffd34d', O: '#e0a92e', p: '#ff9fb8', g: '#a9a9b8', w: '#e8c39e', K: '#2b2633', R: '#ff5a5a', G: '#5ad16a', n: '#7a4b2a', W: '#ffffff' },
      layers: [
        [4, 0, ['ppgYYYYYYYYYYYYYYYYYww..', 'ppgOOOOOOOOOOOOOOOOOwwwK']],
        [3, 4, ['..nG.', 'RRRRR', 'RWRRR', 'RRRRR', '.RRR.']],
      ],
    },
    halloween: {
      colors: { O: '#ff8a2a', o: '#c45a12', K: '#120c14', g: '#4caf50', S: '#d9d4e8', s: '#8f88a3', q: '#6b5a86', E: '#ff8a2a' },
      web: { color: 'S', size: 7 },
      layers: [
        [15, 4, ['s', 's']],
        [13, 6, ['q.q.q', '.qqq.', 'qEqEq']],
        [23, 11, ['OO', 'OO']],
        [24, 25, ['...gg...', '.oOOOOo.', 'oOOOOOOo', 'oOKOOKOo', 'oOOOOOOo', 'oOKKKKOo', '.oOOOOo.']],
      ],
    },
    anniversaire: {
      colors: { P: '#ff7ac6', C: '#7ae0ff', Y: '#ffd34d', W: '#ffffff', s: '#d4b3ff' },
      layers: [
        [11, 0, ['Y..Y..Y..Y', 'P..C..P..C', 'P..C..P..C']],
        [4, 9, ['WWWWWWWWWWWWWWWWWWWWWWWW']],
        [5, 10, ['WW']], [11, 10, ['W']], [16, 10, ['WW']], [24, 10, ['W']], [26, 10, ['W']],
        [6, 11, ['W']], [26, 11, ['W']],
        [1, 1, ['.PPP.', 'PWPPP', 'PPPPP', '.PPP.', '..P..', '..s..', '.s...']],
        [26, 0, ['.CCC.', 'CWCCC', 'CCCCC', '.CCC.', '..C..', '..s..', '...s.']],
      ],
    },
  };
  // Grille 32×32 de couleurs (null = transparent)
  function logoGrid(id) {
    const g = LOGO_BASE.map((r) => [...r].map((ch) => LOGO_COLORS[ch] || null));
    const dr = DRESS[id] || DRESS.base;
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < 32 && y < 32) g[y][x] = c; };
    if (dr.web) { // toile d'araignée dans le coin haut gauche
      const c = dr.colors[dr.web.color], S = dr.web.size;
      for (const deg of [0, 45, 90]) for (let r = 0; r <= S; r++) set(Math.round(r * Math.cos((deg * Math.PI) / 180)), Math.round(r * Math.sin((deg * Math.PI) / 180)), c);
      for (const R of [3.5, 6.5]) for (let deg = 0; deg <= 90; deg += 3) {
        const rr = R - 0.7 * Math.sin((((deg % 45) / 45) * Math.PI));
        set(Math.round(rr * Math.cos((deg * Math.PI) / 180)), Math.round(rr * Math.sin((deg * Math.PI) / 180)), c);
      }
    }
    for (const [x, y, rows] of dr.layers) rows.forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch !== '.') set(x + rx, y + ry, dr.colors[ch]); }));
    return g;
  }
  // SVG pixel : une <rect> par suite horizontale de même couleur
  function logoSVG(id, size = 512) {
    const g = logoGrid(id);
    let out = '';
    g.forEach((row, y) => {
      let x = 0;
      while (x < 32) {
        const c = row[x];
        if (!c) { x++; continue; }
        let e = x; while (e + 1 < 32 && row[e + 1] === c) e++;
        out += `<rect x="${x}" y="${y}" width="${e - x + 1}" height="1" fill="${c}"/>`;
        x = e + 1;
      }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" shape-rendering="crispEdges">${out}</svg>`;
  }

  // Tokens CSS d'un thème
  function cssTokens(id) {
    const th = THEMES[id], b = th.backdrop, pal = backdropPalette(id), sel = id === 'base' ? ':root' : `:root[data-event="${id}"]`;
    const parts = b.overlay ? (b.opts.colors || []).join(' ') : 'none';
    return `${sel} {\n  --accent: ${th.accent};\n  --accent-2: ${th.accent2};\n  --accent-rgb: ${rgb(th.accent).join(', ')};\n  --bg-tint: ${th.bg};\n  --bg-palette: ${pal.join(' ')};\n  --bg-style: ${b.style};\n  --particles: ${b.overlay || 'none'};\n  --particles-colors: ${parts};\n}`;
  }

  return { BAYER, hash, rgb, hex, mix, lum, contrast, EVENTS, easter, rangeOf, eventFor, THEMES, backdropPalette, FIELDS, fieldPainter, OVERLAYS, themePainter, LOGO_BASE, LOGO_COLORS, DRESS, logoGrid, logoSVG, cssTokens, plotter, sprite };
})();

export { BBEvents };
export default BBEvents;
