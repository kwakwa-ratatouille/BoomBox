// Image « Story » (1080 × 1920) de tes stats, à partager sur Insta, Snap… : dessinée dans un canvas.
// Les pochettes passent par le serveur (ou le HTTP natif sur téléphone) pour pouvoir être dessinées.
import { isNative, localApi } from './native.js';
import { toast } from './ui.js';

const W = 1080;
const H = 1920;

export async function loadImg(url) {
  if (!url) return null;
  try {
    const src = url.startsWith('/') || url.startsWith('data:') ? url : isNative ? await (await localApi()).media.imageBlobUrl(url) : `/api/img?u=${encodeURIComponent(url)}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((ok, ko) => ((img.onload = ok), (img.onerror = ko), (img.src = src)));
    return img;
  } catch {
    return null;
  }
}

function fit(ctx, text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function drawCover(ctx, img, x, y, size, round = false, r = 16) {
  ctx.save();
  ctx.beginPath();
  if (round) ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  else ctx.roundRect(x, y, size, size, r);
  ctx.clip();
  if (img) {
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, x, y, size, size);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

// data : { kicker, title, stats: [[label, value]…], artists: [{ name, thumb }], tracks: [{ title, artist, thumb }], colors: [c1, c2] }
// Décor pixel art : petits cubes dorés / colorés, certains « en train de se retourner » (vus par la tranche),
// en vague du haut vers le bas, sur les bords de l'image (le centre reste lisible)
// Décor pixel art discret : quelques petits cubes (certains « en train de se retourner », vus par la tranche)
// uniquement dans les bandes du haut et du bas et dans les coins, pour ne jamais passer sur le texte
export function pixelDeco(ctx, w, h, seed = 1) {
  let s = seed * 7919 + 13;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const colors = ['#ffd34d', '#b07cf7', '#3fd0ff', '#ff4fa3', '#2ef28b', '#ffffff'];
  const unit = Math.round(w / 60);
  for (let k = 0; k < 34; k++) {
    const top = r() < 0.5;
    const x = r() * w;
    const y = top ? r() * h * 0.045 : h - unit * 3 - r() * h * 0.035;
    const size = unit * (1 + Math.floor(r() * 2));
    const phase = (x / w + r() * 0.3) % 1;
    const hh = Math.max(2, size * Math.abs(Math.cos(phase * Math.PI)));
    ctx.globalAlpha = 0.15 + r() * 0.25;
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    ctx.fillRect(Math.round(x), Math.round(y + (size - hh) / 2), size, Math.round(hh));
  }
  ctx.globalAlpha = 1;
}

export async function makeStory(data) {
  await document.fonts?.ready;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const [c1, c2] = data.colors || ['#2ef28b', '#0b3d1f'];
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  pixelDeco(ctx, W, H, String(data.label || '').length + 3);
  // Voile sombre en bas pour la lisibilité
  const v = ctx.createLinearGradient(0, H * 0.3, 0, H);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  const [logo, ...imgs] = await Promise.all([loadImg((await import('./events.js')).eventLogo()), ...data.artists.slice(0, 5).map((a) => loadImg(a.thumb)), ...data.tracks.slice(0, 5).map((t) => loadImg(t.thumb))]);
  const aImgs = imgs.slice(0, Math.min(5, data.artists.length));
  const tImgs = imgs.slice(aImgs.length);

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  if (logo) ctx.drawImage(logo, 80, 90, 96, 96);
  ctx.font = `800 44px ${font}`;
  ctx.fillText('Boombox', 196, 156);
  ctx.font = `600 40px ${font}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText(fit(ctx, data.kicker, W - 160), 80, 300);
  ctx.globalAlpha = 1;
  ctx.font = `900 96px ${font}`;
  ctx.fillText(fit(ctx, data.title, W - 160), 80, 400);

  // Chiffres clés
  let x = 80;
  for (const [label, value] of data.stats.slice(0, 3)) {
    ctx.font = `900 72px ${font}`;
    ctx.fillText(String(value), x, 540);
    ctx.font = `600 32px ${font}`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(label, x, 590);
    ctx.globalAlpha = 1;
    x += 320;
  }

  const list = (title, rows, imgsRow, y0, round) => {
    ctx.font = `800 44px ${font}`;
    ctx.fillText(title, 80, y0);
    rows.slice(0, 5).forEach((r, i) => {
      const y = y0 + 40 + i * 118;
      ctx.font = `800 44px ${font}`;
      ctx.globalAlpha = 0.7;
      ctx.fillText(String(i + 1), 80, y + 68);
      ctx.globalAlpha = 1;
      drawCover(ctx, imgsRow[i], 140, y, 96, round);
      ctx.font = `800 42px ${font}`;
      ctx.fillText(fit(ctx, r.name || r.title, W - 360), 266, y + (r.artist ? 46 : 64));
      if (r.artist) {
        ctx.font = `500 32px ${font}`;
        ctx.globalAlpha = 0.75;
        ctx.fillText(fit(ctx, r.artist, W - 360), 266, y + 88);
        ctx.globalAlpha = 1;
      }
    });
  };
  if (data.artists.length) list('Top artistes', data.artists, aImgs, 720, true);
  // Top titres juste sous les artistes (moins de 5 artistes : pas de grand vide)
  if (data.tracks.length) list('Top titres', data.tracks, tImgs, data.artists.length ? 720 + 40 + Math.min(5, data.artists.length) * 118 + 90 : 720, false);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

// Partage l'image (feuille de partage du téléphone → Insta…) ou la télécharge sur PC
// Partage d'une image ou d'une vidéo :
//  1. appli iPhone / Android avec le module de partage natif → feuille de partage (Instagram, Snap, Photos…)
//  2. navigateur qui sait partager des fichiers → feuille de partage
//  3. sinon : téléchargement sur PC, ou image affichée en grand sur téléphone (appui long pour l'enregistrer)
export async function shareFile(blob, name) {
  if (!blob) return toast('Fichier impossible à créer');
  const P = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins;
  if (P?.Share && P?.Filesystem) {
    try {
      const b64 = await new Promise((ok, ko) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1]);
        r.onerror = ko;
        r.readAsDataURL(blob);
      });
      const { uri } = await P.Filesystem.writeFile({ path: `share/${name}`, data: b64, directory: 'CACHE', recursive: true });
      await P.Share.share({ files: [uri], title: 'Mon récap Boombox' });
      return;
    } catch (e) {
      if (/cancel|annul/i.test(e?.message || '')) return;
    }
  }
  const file = new File([blob], name, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: 'Mon récap Boombox' });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  if (window.Capacitor?.isNativePlatform?.() || /iphone|ipad|android/i.test(navigator.userAgent)) {
    if (blob.type.startsWith('image/')) return showImage(blob);
    return toast('Mets à jour l’appli (SideStore) pour partager la vidéo', { timeout: 6000 });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(blob.type.startsWith('video/') ? 'Vidéo enregistrée dans Téléchargements' : 'Image enregistrée dans Téléchargements');
}

// Copier l'image (PC) : à coller directement dans un message, Discord, Insta web…
export async function copyImage(blob) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copiée');
  } catch {
    toast('Copie impossible ici : utilise « Télécharger »');
  }
}

export async function shareStory(blob, name = 'boombox-recap.png') {
  if (!blob) return toast('Image impossible à créer');
  return shareFile(blob, name);
}

function showImage(blob) {
  const url = URL.createObjectURL(blob);
  const ov = document.createElement('div');
  ov.className = 'story-save';
  ov.innerHTML = `<div class="ss-box"><img src="${url}" alt="Ton récap"><p><b>Appuie longuement sur l'image</b> puis « Enregistrer dans Photos » (ou « Partager » → Instagram).</p><button class="btn white">Fermer</button></div>`;
  document.body.appendChild(ov);
  const close = () => (ov.remove(), URL.revokeObjectURL(url));
  ov.querySelector('button').onclick = close;
  ov.addEventListener('click', (e) => e.target === ov && close());
}
