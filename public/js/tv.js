// Écran Télé du mode party : à ouvrir dans le navigateur d'une télé (ou d'un Chromecast, d'une console…).
// La télé affiche un code à 4 chiffres ; l'hôte le tape dans Boombox (Mode party → Connecter une télé) et la télé
// affiche alors la party : QR code pour que les invités ajoutent leurs sons, son en cours avec le clip (muet,
// le son vient de l'enceinte de l'hôte), progression et file d'attente. Aucun compte nécessaire sur la télé.
import { pixelBackdrop, PARTY_PALETTE, PARTY_ACCENTS } from './pixel-bg.js';
import { initializeApp } from '../vendor/firebase/firebase-app.js';
import { getAuth, signInAnonymously } from '../vendor/firebase/firebase-auth.js';
import { getFirestore, doc, setDoc, onSnapshot, deleteDoc } from '../vendor/firebase/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { html, raw } from './ui.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const root = document.getElementById('tv');
const GUEST_BASE = 'https://musikal-b72d1.web.app/party.html?code=';
let stopRoom = null;
let stopBg = null;
let tick = 0;

const cover = (t, size = 180) => html`<div class="cover" style="width:${size}px;height:${size}px">${t?.thumb ? html`<img src="${t.thumb}" alt="" referrerpolicy="no-referrer">` : ''}</div>`;
const artists = (t) => (t?.artists || []).map((a) => a.name).join(', ');

async function start() {
  await signInAnonymously(getAuth(app));
  const direct = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  if (direct) return showRoom(direct);
  pair();
}

// Code à 4 chiffres affiché en grand ; quand l'hôte le tape, le document tvs/<code> reçoit le code de la party
function pair() {
  stopRoom?.();
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const ref = doc(db, 'tvs', pin);
  setDoc(ref, { at: Date.now(), jam: null }).catch(() => {});
  root.innerHTML = String(html`<div class="tv-pair">
    <img src="/assets/logo-symbol.png?v=2" alt="" style="width:110px">
    <h1>Boombox sur la télé</h1>
    <p>Sur ton téléphone ou ton PC : <b>Mode party</b> → <b>Connecter une télé</b>, puis tape ce code :</p>
    <div class="tv-pin">${pin}</div>
    <p>La party s'affichera ici toute seule.</p>
    <form class="tv-alt" id="tv-alt"><input class="input" id="tv-code" placeholder="Code party" maxlength="8"><button class="btn white">Afficher</button></form>
  </div>`);
  stopBg?.();
  stopBg = pixelBackdrop(root.firstElementChild, PARTY_PALETTE, { accents: PARTY_ACCENTS, speed: 0.3, cell: 16, fps: 8 });
  const off = onSnapshot(ref, (s) => {
    const jam = s.data()?.jam;
    if (!jam) return;
    off();
    deleteDoc(ref).catch(() => {});
    showRoom(String(jam).toUpperCase());
  });
  root.querySelector('#tv-alt').onsubmit = (e) => {
    e.preventDefault();
    const c = root.querySelector('#tv-code').value.trim().toUpperCase();
    if (!c) return;
    off();
    deleteDoc(ref).catch(() => {});
    showRoom(c);
  };
  // Code périmé au bout d'une heure : on en affiche un nouveau
  clearTimeout(tick);
  tick = setTimeout(() => (off(), deleteDoc(ref).catch(() => {}), pair()), 3600e3);
}

let qrLib = null;
async function renderQr(box, text, size) {
  qrLib ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/vendor/qrcode.min.js';
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  await qrLib.catch(() => {});
  if (!window.QRCode || !box) return;
  box.innerHTML = '<div class="qr"></div>';
  new window.QRCode(box.firstChild, { text, width: size, height: size });
}

function showRoom(code) {
  clearTimeout(tick);
  root.innerHTML = String(html`<div class="party-screen">
    <div class="ps-video" aria-hidden="true"></div><div class="ps-shade" aria-hidden="true"></div>
    <div class="ps-left"><img src="/assets/logo-symbol.png?v=2" alt="" style="width:80px"><h1>Ajoute tes sons !</h1><p>Scanne avec l'appareil photo de ton téléphone</p><div id="ps-qr"></div><p class="ps-code">Code ${code}</p></div>
    <div class="ps-right"><div class="ps-now"></div><div class="ps-queue"></div></div>
  </div>`);
  const ov = root.firstElementChild;
  stopBg?.();
  stopBg = pixelBackdrop(ov, PARTY_PALETTE, { accents: PARTY_ACCENTS, speed: 0.3, cell: 16, fps: 8 });
  renderQr(ov.querySelector('#ps-qr'), GUEST_BASE + code, 280);
  let shownId = null;
  let st = null;
  // Clip du son en cours en fond, muet, repris à la bonne position
  const setVideo = (t, pos) => {
    if ((t?.id || null) === shownId) return;
    shownId = t?.id || null;
    const vid = ov.querySelector('.ps-video');
    vid.classList.remove('on');
    vid.innerHTML = t && /^[\w-]{11}$/.test(t.id) ? `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.id)}?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&loop=1&playlist=${encodeURIComponent(t.id)}&start=${Math.max(0, Math.floor(pos || 0))}" allow="autoplay; encrypted-media" tabindex="-1" title=""></iframe>` : '';
    vid.querySelector('iframe')?.addEventListener('load', () => setTimeout(() => vid.classList.add('on'), 2500));
  };
  const pos = () => (!st ? 0 : st.paused ? st.position : st.position + (Date.now() - (st.ts || Date.now())) / 1000);
  const progress = () => {
    const bar = ov.querySelector('.tv-progress i');
    if (bar && st?.duration) bar.style.width = `${Math.min(100, (pos() / st.duration) * 100)}%`;
  };
  stopRoom?.();
  const unsub = onSnapshot(doc(db, 'jams', code), (s) => {
    const room = s.exists() ? s.data() : null;
    if (!room || room.ended) {
      root.querySelector('.ps-now') && (root.querySelector('.ps-now').innerHTML = String(html`<h2>${room?.ended ? 'La party est terminée' : `Party ${code} introuvable`}</h2>`));
      setTimeout(pair, room?.ended ? 8000 : 4000);
      return unsub();
    }
    st = room.state || null;
    const t = st?.track;
    setVideo(t, pos());
    ov.querySelector('.ps-now').innerHTML = t
      ? String(html`${cover(t, 200)}<div style="min-width:0"><small>${st.paused ? 'EN PAUSE' : 'EN COURS'}</small><h2>${t.title}</h2><p>${artists(t)}</p>${t.addedBy ? html`<p class="ps-by">Ajouté par ${t.addedBy}</p>` : ''}<div class="tv-progress"><i></i></div></div>`)
      : String(html`<h2>La musique va commencer…</h2><p>Party de ${room.hostName || 'l’hôte'}</p>`);
    const q = room.queue || [];
    ov.querySelector('.ps-queue').innerHTML = String(html`<h3>À suivre</h3>${q.slice(0, 5).map((x) => html`<div class="ps-q">${cover(x, 64)}<div><b>${x.title}</b><span>${artists(x)}${x.addedBy ? ` · ${x.addedBy}` : ''}</span></div></div>`)}${q.length ? '' : raw('<p class="muted">Personne n’a encore ajouté de son : scanne le QR code !</p>')}`);
    progress();
  }, () => setTimeout(pair, 4000));
  const timer = setInterval(progress, 1000);
  stopRoom = () => (unsub(), clearInterval(timer));
}

// Les télés coupent l'écran au bout d'un moment : on demande à le garder allumé
navigator.wakeLock?.request?.('screen').catch(() => {});
document.addEventListener('visibilitychange', () => !document.hidden && navigator.wakeLock?.request?.('screen').catch(() => {}));
start().catch((e) => (root.innerHTML = `<div class="tv-pair"><h1>Connexion impossible</h1><p>${String(e.message || e)}</p></div>`));
