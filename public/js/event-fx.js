// Animations des récaps exportés en vidéo, propres à chaque événement (planche design/themes-evenements) :
// - entrée de la carte : tombe et rebondit (drop), jaillit d'un point en grossissant (pop), glisse (slide / slideR),
//   s'écrit de gauche à droite (write) ;
// - sortie : la couleur du thème recouvre tout en pixels tramés (montée, cercle, égaliseur, vague, balayage, brume),
//   puis le logo habillé apparaît au centre en 3 paliers avec « BOOMBOX ».
// La boucle du milieu (neige, cœurs, feux d'artifice…) est le fond animé du thème, dessiné par ailleurs.
import { BBEvents as B } from './events-pixel.js';

const ENTER = 1.3; // secondes
const EXIT = 1.8;
const easeOutBack = (p) => 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);
function easeOutBounce(p) {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

// cfg : card de events-data.js ; W×H : taille de la carte (en px de mise en page), K : échelle de sortie
export function eventFx(cfg, { W, H, K, logo, duration }) {
  const OW = W * K;
  const OH = H * K;
  const sx = W / 1080; // les points de la planche sont donnés pour une carte 1080 × 1920
  const sy = H / 1920;
  const origin = cfg.origin ? [cfg.origin[0] * sx * K, cfg.origin[1] * sy * K] : [OW / 2, OH / 2];
  const fillOrigin = cfg.fillOrigin ? [cfg.fillOrigin[0] / 1080, cfg.fillOrigin[1] / 1920] : [0.5, 0.5];
  // Calque de sortie en basse résolution (pixels tramés), agrandi sans lissage
  const LW = 54;
  const LH = Math.round((LW * H) / W);
  const low = document.createElement('canvas');
  low.width = LW;
  low.height = LH;
  const lg = low.getContext('2d');
  const img = lg.createImageData(LW, LH);
  const [fr, fg, fb] = B.rgb(cfg.fill || '#b07cf7');
  const dark = B.lum(cfg.fill || '#b07cf7') > 0.45;

  // Part de l'écran couverte au point (u, v) ∈ [0,1]² à l'avancement p : > 0 = couvert
  function cover(kind, u, v, p, t) {
    switch (kind) {
      case 'radial': {
        const d = Math.hypot((u - fillOrigin[0]) * (W / H), v - fillOrigin[1]);
        return p * 1.35 - d;
      }
      case 'eq': {
        const col = Math.floor(u * 12);
        const h = p * 1.25 * (0.65 + 0.35 * B.hash(col, 7)) + 0.08 * Math.sin(t * 9 + col);
        return h - (1 - v);
      }
      case 'wave':
        return v - (1 - p * 1.15) + 0.05 * Math.sin(u * 11 + t * 5);
      case 'wipe':
        return p * 1.12 - u;
      case 'fog':
        return p * 1.3 - (B.hash(Math.floor(u * LW), Math.floor(v * LH)) * 0.45 + (1 - v) * 0.6);
      default: // rise : monte du bas
        return v - (1 - p * 1.12) + (B.hash(Math.floor(u * LW), 3) - 0.5) * 0.04;
    }
  }

  return {
    // Dessine la carte (calque déjà composé) avec l'entrée propre au thème ; true si l'entrée est terminée
    enter(x, tt, card) {
      const p = Math.min(1, tt / ENTER);
      if (p >= 1) {
        x.drawImage(card, 0, 0);
        return true;
      }
      x.save();
      switch (cfg.enter) {
        case 'drop':
          x.translate(0, -(1 - easeOutBounce(p)) * OH * 0.7);
          break;
        case 'pop': {
          const s = Math.max(0.05, easeOutBack(p));
          x.translate(origin[0], origin[1]);
          x.scale(s, s);
          x.translate(-origin[0], -origin[1]);
          x.globalAlpha = Math.min(1, p * 3);
          break;
        }
        case 'slide':
        case 'slideR':
          x.translate((cfg.enter === 'slide' ? -1 : 1) * (1 - easeOutBack(p)) * OW, 0);
          break;
        case 'write':
          x.beginPath();
          x.rect(0, 0, OW * Math.min(1, p * 1.1), OH);
          x.clip();
          break;
        default:
          x.globalAlpha = p;
          x.translate(0, (1 - p) * 40 * K);
      }
      x.drawImage(card, 0, 0);
      x.restore();
      return false;
    },
    // Sortie : à dessiner par-dessus tout, pendant les EXIT dernières secondes
    exit(x, tt) {
      const t0 = duration - EXIT;
      if (tt < t0) return;
      const q = (tt - t0) / EXIT;
      const p = Math.min(1, q / 0.62);
      const data = img.data;
      for (let j = 0; j < LH; j++) {
        for (let i = 0; i < LW; i++) {
          const c = cover(cfg.exit, (i + 0.5) / LW, (j + 0.5) / LH, p, tt);
          const on = c + (B.BAYER[(j % 4) * 4 + (i % 4)] - 0.5) * 0.08 > 0;
          const o = (j * LW + i) * 4;
          data[o] = fr;
          data[o + 1] = fg;
          data[o + 2] = fb;
          data[o + 3] = on ? 255 : 0;
        }
      }
      lg.putImageData(img, 0, 0);
      x.save();
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.imageSmoothingEnabled = false;
      x.drawImage(low, 0, 0, OW, OH);
      // Logo au centre en 3 paliers, puis « BOOMBOX »
      if (q > 0.6 && logo) {
        const step = q < 0.72 ? 0.18 : q < 0.84 ? 0.3 : 0.4;
        const s = OW * step;
        x.drawImage(logo, (OW - s) / 2, OH / 2 - s * 0.7, s, s);
        if (q >= 0.84) {
          x.fillStyle = dark ? '#131019' : '#ffffff';
          x.font = `900 ${Math.round(OW * 0.07)}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
          x.textAlign = 'center';
          x.fillText('BOOMBOX', OW / 2, OH / 2 + s * 0.55);
        }
      }
      x.restore();
    },
  };
}
