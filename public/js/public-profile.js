// Page publique d'un profil Boombox (lien partagé /u?c=CODE) : lisible par tout le monde, sans compte.
import { initializeApp } from '../vendor/firebase/firebase-app.js';
import { getFirestore, doc, getDoc } from '../vendor/firebase/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { html, icon, plural, dominantColor } from './ui.js';

const root = document.getElementById('pub');
const code = (new URLSearchParams(location.search).get('c') || '').toUpperCase();
const fmtN = (n) => Math.round(n || 0).toLocaleString('fr-FR');
const img = (url, cls = '') => html`<div class="cover ${cls}">${url ? html`<img src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon('music')}</div>`;
const mosaic = (p) => (p.cover ? img(p.cover) : p.thumbs?.length >= 2 ? html`<div class="cover mosaic">${[0, 1, 2, 3].map((i) => html`<img src="${p.thumbs[i % p.thumbs.length]}" alt="" referrerpolicy="no-referrer">`)}</div>` : img(p.thumbs?.[0]));

async function start() {
  if (!code) return (root.innerHTML = '<div class="empty"><h2>Lien incomplet</h2></div>');
  const snap = await getDoc(doc(getFirestore(initializeApp(firebaseConfig)), 'publicProfiles', code)).catch(() => null);
  if (!snap?.exists()) return (root.innerHTML = '<div class="empty"><h2>Profil introuvable</h2><p>Ce profil n’est plus partagé.</p></div>');
  const p = snap.data();
  document.title = `${p.name} · Boombox`;
  root.innerHTML = String(html`
    <div class="pub-top"><img src="/assets/logo-symbol.png?v=2" alt="">Boombox</div>
    <div class="pub-head">
      ${p.photo ? html`<span class="avatar-img" style="background-image:url('${p.photo}')"></span>` : html`<span class="avatar-img" style="background:${p.color}">${(p.name || '?')[0].toUpperCase()}</span>`}
      <div><div style="font-size:14px;font-weight:700">Profil</div><h1>${p.name}</h1>
        <div class="pub-meta"><span>${plural(p.counts?.playlists || 0, 'playlist')}</span><span>${plural(p.counts?.follows || 0, 'abonnement')}</span><span>${plural(p.counts?.liked || 0, 'titre liké')}</span>${p.minutes ? html`<span>${fmtN(p.minutes)} min d'écoute ce mois-ci</span>` : ''}</div></div>
    </div>
    ${p.topArtists?.length ? html`<h2>Top artistes du mois</h2><div class="pub-row">${p.topArtists.map((a) => html`<div class="pub-card">${img(a.thumb, 'round')}<b>${a.name}</b><span>${plural(a.count, 'écoute')}</span></div>`)}</div>` : ''}
    ${p.topTracks?.length ? html`<h2>Top titres du mois</h2><div class="pub-tracks">${p.topTracks.map((t, i) => html`<div class="q-item"><span class="num">${i + 1}</span>${img(t.thumb)}<div class="t-text"><span class="t-title">${t.title}</span><span class="t-artists">${(t.artists || []).map((a) => a.name).join(', ')}</span></div></div>`)}</div>` : ''}
    ${p.playlists?.length ? html`<h2>Playlists</h2><div class="pub-row">${p.playlists.map((pl) => html`<div class="pub-card">${mosaic(pl)}<b>${pl.name}</b><span>${plural(pl.count, 'titre')}</span></div>`)}</div>` : ''}
    ${p.follows?.length ? html`<h2>Abonnements</h2><div class="pub-row">${p.follows.map((a) => html`<div class="pub-card">${img(a.thumb, 'round')}<b>${a.name}</b><span>Artiste</span></div>`)}</div>` : ''}
    <p class="pub-foot">Mis à jour le ${new Date(p.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} · Boombox</p>`);
  const c = p.photo ? await dominantColor(p.photo).catch(() => null) : p.color;
  if (c) document.body.style.setProperty('--hero', c);
}
start();
