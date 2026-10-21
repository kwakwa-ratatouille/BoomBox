// Page invité du mode soirée : sans compte, on rejoint la file de la soirée avec le code du QR code.
// Les invités cherchent un titre (si la page est servie par le PC de la soirée) ou collent un lien
// Spotify / Deezer / YouTube / Apple Music, que l'appli de l'hôte transforme en titre jouable.
import { pixelBackdrop, PARTY_PALETTE, PARTY_ACCENTS } from './pixel-bg.js';
import { initializeApp } from '../vendor/firebase/firebase-app.js';
import { getAuth, signInAnonymously } from '../vendor/firebase/firebase-auth.js';
import { getFirestore, doc, collection, onSnapshot, updateDoc, addDoc, deleteDoc, arrayUnion, query, where } from '../vendor/firebase/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { html, icon, toast, debounce, artistLinks, esc } from './ui.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const root = document.getElementById('party');
const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
let me = localStorage.getItem('boombox.guestName') || '';
let room = null;
let ended = false;
let uid = null;
let myRequests = [];

const cover = (t) => html`<div class="cover">${t?.thumb ? html`<img src="${t.thumb}" alt="" referrerpolicy="no-referrer">` : icon('music')}</div>`;

async function start() {
  if (!code) return (root.innerHTML = '<div class="empty"><h2>Code manquant</h2><p>Scanne le QR code affiché par l’hôte de la party.</p></div>');
  uid = (await signInAnonymously(getAuth(app))).user.uid;
  if (!me) return askName();
  join();
}

function askName() {
  root.innerHTML = String(html`<div class="party-head"><img class="logo-img" src="/assets/logo-symbol.png?v=2" alt="Boombox"><h1>Boombox · Party</h1><span class="code">${code}</span></div>
    <div class="box"><h2>Comment tu t'appelles ?</h2><p class="muted" style="margin-top:0">Ton prénom s'affichera à côté des sons que tu ajoutes.</p>
    <form id="nf" class="row-flex"><input class="input" id="nn" maxlength="24" placeholder="Prénom" style="flex:1" autofocus><button class="btn primary">Entrer</button></form></div>`);
  root.querySelector('#nf').onsubmit = (e) => {
    e.preventDefault();
    me = root.querySelector('#nn').value.trim();
    if (!me) return;
    localStorage.setItem('boombox.guestName', me);
    join();
  };
}

function join() {
  const ref = doc(db, 'jams', code);
  updateDoc(ref, { [`members.guest_${uid}`]: `${me} (invité)` }).catch(() => {});
  onSnapshot(ref, (s) => {
    room = s.exists() && !s.data().ended ? s.data() : null;
    ended = s.exists() && !!s.data().ended;
    render();
  }, () => {
    room = null;
    render();
  });
  // Suivi de mes demandes (liens envoyés) pour savoir si elles ont été trouvées
  onSnapshot(query(collection(db, 'jams', code, 'requests'), where('by', '==', uid)), (s) => {
    myRequests = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at);
    renderRequests();
  });
}

// La page est construite une fois ; seules les zones « en cours » et « à suivre » sont mises à jour ensuite
// (pour ne pas effacer ce que l'invité est en train de taper).
let built = false;
function render() {
  if (!room) {
    built = false;
    root.innerHTML = ended
      ? String(html`<div class="empty"><h2>La party est terminée</h2><p>Merci ${me} d'avoir mis l'ambiance ! Tu peux fermer cette page.</p></div>`)
      : String(html`<div class="empty"><h2>Party introuvable</h2><p>Le code ${code} n'existe pas.</p></div>`);
    return;
  }
  if (!built) build();
  const st = room.state;
  root.querySelector('#now').innerHTML = st?.track
    ? String(html`<div class="now">${cover(st.track)}<div class="t-text" style="flex:1;min-width:0"><small>${st.paused ? 'EN PAUSE' : 'EN COURS'}</small><b class="ellipsis" style="display:block">${st.track.title}</b><span class="muted ellipsis" style="display:block">${(st.track.artists || []).map((a) => a.name).join(', ')}</span></div></div>`)
    : '';
  const queue = room.queue || [];
  root.querySelector('#queue').innerHTML = String(html`<h2>À suivre (${queue.length})</h2>
    ${queue.length ? queue.map((t) => html`<div class="qrow">${cover(t)}<div class="t-text" style="flex:1;min-width:0"><b class="ellipsis" style="display:block;font-size:14px">${t.title}</b><span class="who">${(t.artists || []).map((a) => a.name).join(', ')} · ajouté par ${t.addedBy}</span></div></div>`) : html`<p class="muted">La file est vide : ajoute le premier son !</p>`}`);
}

function build() {
  built = true;
  root.innerHTML = String(html`
    <div class="party-head"><img class="logo-img" src="/assets/logo-symbol.png?v=2" alt="Boombox"><h1>Party de ${room.hostName}</h1><span class="code">${code}</span></div>
    <div id="now"></div>
    <div class="box"><h2>Ajouter un son</h2>
      <div class="search-box" style="margin-bottom:10px;max-width:none">${icon('search')}<input id="q" placeholder="Chercher un titre ou un artiste" autocomplete="off"></div>
      <div id="results"></div>
      <form id="lf" class="row-flex" style="margin-top:12px"><input class="input" id="link" placeholder="…ou colle un lien Spotify, Deezer, YouTube" style="flex:1"><button class="btn white">Envoyer</button></form>
      <div id="reqs" style="margin-top:8px"></div>
    </div>
    <div class="box" id="queue"></div>`);
  const q = root.querySelector('#q');
  q.addEventListener('input', debounce(() => doSearch(q.value.trim()), 350));
  root.querySelector('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const v = root.querySelector('#link').value.trim();
    if (!v) return;
    await addDoc(collection(db, 'jams', code, 'requests'), { input: v, by: uid, name: me, at: Date.now(), status: 'pending' });
    root.querySelector('#link').value = '';
    toast('Envoyé ! Le son arrive dans la file dans quelques secondes');
  };
  renderRequests();
}
function renderRequests() {
  const box = root.querySelector('#reqs');
  if (!box) return;
  box.innerHTML = myRequests
    .slice(0, 4)
    .map((r) => `<div class="req ${r.status === 'notfound' ? 'bad' : ''}">${r.status === 'notfound' ? '✗ Introuvable' : '⏳ En recherche…'} : ${esc(r.input.slice(0, 60))}</div>`)
    .join('');
}

let searchSeq = 0;
let direct = !location.hostname.endsWith('.web.app') && !location.hostname.endsWith('.firebaseapp.com');
// Recherche hors du Wi-Fi de la soirée : la demande passe par l'appli de l'hôte (via Firebase)
function hostSearch(q) {
  return new Promise(async (resolve, reject) => {
    const ref = await addDoc(collection(db, 'jams', code, 'searches'), { q, by: uid, at: Date.now() });
    const t = setTimeout(() => (off(), deleteDoc(ref).catch(() => {}), reject(new Error('L’hôte ne répond pas'))), 15000);
    const off = onSnapshot(ref, (s) => {
      const d = s.data();
      if (!d?.results) return;
      clearTimeout(t);
      off();
      deleteDoc(ref).catch(() => {});
      resolve(d.results);
    });
  });
}
async function doSearch(q) {
  const box = root.querySelector('#results');
  if (!box) return;
  if (!q) return (box.innerHTML = '');
  const seq = ++searchSeq;
  try {
    let items;
    if (direct) {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=song`);
        if (!r.ok) throw new Error();
        items = (await r.json()).items;
      } catch {
        direct = false;
      }
    }
    if (!direct) {
      box.innerHTML = '<p class="muted" style="font-size:13px">Recherche…</p>';
      items = await hostSearch(q);
    }
    if (seq !== searchSeq) return;
    box.innerHTML = String(html`${items.slice(0, 6).map((t, i) => html`<div class="res">${cover(t)}<div class="t-text" style="min-width:0"><b class="ellipsis" style="display:block;font-size:14px">${t.title}</b><span class="who">${(t.artists || []).map((a) => a.name).join(', ')}</span></div><button class="btn primary" data-add="${i}" style="padding:8px 14px">Ajouter</button></div>`)}`);
    box.querySelectorAll('[data-add]').forEach((b) => (b.onclick = async () => {
      const { type, ...t } = items[Number(b.dataset.add)];
      b.disabled = true;
      await updateDoc(doc(db, 'jams', code), { queue: arrayUnion({ id: t.id, title: t.title, artists: t.artists || [], album: t.album || null, duration: t.duration || 0, thumb: t.thumb || null, qid: Math.random().toString(36).slice(2), addedBy: me }) });
      b.textContent = 'Ajouté ✓';
      toast(`« ${t.title} » ajouté à la file`);
    }));
  } catch (e) {
    box.innerHTML = String(html`<p class="muted" style="font-size:13px">${e.message || 'Recherche indisponible'} : colle un lien ou écris « artiste titre » ci-dessous.</p>`);
  }
}

// Fond animé pixel derrière l'en-tête (recréé si l'en-tête est redessiné)
new MutationObserver(() => {
  const head = root.querySelector('.party-head');
  if (head && !head.classList.contains('has-pxbg')) pixelBackdrop(head, PARTY_PALETTE, { accents: PARTY_ACCENTS });
}).observe(root, { childList: true });
start().catch((e) => (root.innerHTML = String(html`<div class="empty"><h2>Oups</h2><p>${e.message}</p></div>`)));
