// Compte Google : la même bibliothèque sur tous tes appareils, sans lien ni code à recopier. Avec Google, chaque
// appareil se connecte au même compte Firebase : il est donc membre de la bibliothèque dès qu'il se connecte.
// Le document users/<compte> retient quelle bibliothèque (espace) va avec le compte.
//
// iPhone, Android et téléphone sur le Wi-Fi du PC : Google refuse sa fenêtre de connexion dans une appli (et sur une
// adresse locale). On ouvre donc la page google.html du site dans le vrai navigateur : elle connecte avec Google,
// chiffre le jeton et le dépose dans Firestore (authRelay/<numéro aléatoire>). L'appli, qui attend sur ce numéro,
// le déchiffre et se connecte avec. La clé ne passe que par l'adresse (après le #, jamais envoyée à un serveur).
import { auth, db, doc, getDoc, setDoc, deleteDoc, onSnapshot, cloud } from './cloud.js';
import { GoogleAuthProvider, signInWithPopup, linkWithPopup, linkWithCredential, signInWithCredential, browserPopupRedirectResolver } from '../vendor/firebase/firebase-auth.js';
import { modal, html, toast } from './ui.js';

const RELAY = 'https://musikal-b72d1.web.app/google.html';
const native = !!window.Capacitor?.isNativePlatform?.();
// Fenêtre Google directe seulement sur les adresses autorisées par Firebase (PC en localhost, site en ligne)
// PC (Boombox ouvert depuis le PC lui-même) : aussi par la page relais, ouverte dans le vrai navigateur (la fenêtre
// surgissante de Google ne s'ouvrait pas, ou restait cachée, depuis la fenêtre d'appli)
const onPc = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
export const viaRelay = native || onPc || !/^(localhost|127\.0\.0\.1)$|\.web\.app$|\.firebaseapp\.com$/.test(location.hostname);
export const isGoogle = () => !!auth.currentUser && !auth.currentUser.isAnonymous;
export const googleEmail = () => auth.currentUser?.providerData?.find((p) => p.providerId === 'google.com')?.email || auth.currentUser?.email || '';

const b64 = (o) => btoa(String.fromCharCode(...new Uint8Array(o))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const ERRORS = {
  'auth/operation-not-allowed': 'La connexion Google n’est pas encore activée pour Boombox (Firebase → Authentication → Google).',
  'auth/popup-closed-by-user': 'Connexion Google annulée.',
  'auth/cancelled-popup-request': 'Connexion Google annulée.',
  'auth/popup-blocked': 'La fenêtre Google a été bloquée par le navigateur : autorise les fenêtres pour Boombox et réessaie.',
  'auth/network-request-failed': 'Pas de connexion Internet.',
  'auth/unauthorized-domain': 'Cette adresse n’est pas autorisée pour la connexion Google.',
};
export const googleError = (e) => ERRORS[e?.code] || e?.message || String(e);

// Jeton Google obtenu dans le navigateur (page relais). onWaiting(cancel) : l'appli affiche « termine dans ton navigateur ».
function relayCredential(onWaiting) {
  return new Promise((resolve, reject) => {
    const id = b64(crypto.getRandomValues(new Uint8Array(18)));
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const ref = doc(db, 'authRelay', id);
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      stop();
      clearTimeout(timer);
      deleteDoc(ref).catch(() => {});
      fn();
    };
    const stop = onSnapshot(ref, async (snap) => {
      const d = snap.data()?.d;
      if (!d || done) return;
      try {
        const all = unb64(d);
        const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
        const j = JSON.parse(new TextDecoder().decode(clear));
        finish(() => resolve(GoogleAuthProvider.credential(j.i || null, j.a || null)));
      } catch (e) {
        finish(() => reject(e));
      }
    }, () => {});
    const timer = setTimeout(() => finish(() => reject(new Error('Connexion Google trop longue : réessaie.'))), 10 * 60e3);
    onWaiting?.(() => finish(() => reject(Object.assign(new Error('Connexion Google annulée.'), { code: 'auth/popup-closed-by-user' }))));
    // Appli : une adresse extérieure s'ouvre dans Safari / Chrome (comme la connexion Spotify) ; navigateur : nouvel onglet
    const url = `${RELAY}#id=${id}&k=${b64(raw)}`;
    if (native) location.href = url;
    else if (onPc) fetch('/api/open-browser', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }).then((r) => r.ok || Promise.reject()).catch(() => window.open(url, '_blank'));
    else if (!window.open(url, '_blank')) location.href = url;
  });
}

// Connexion Google. Cet appareil était connecté sans compte (anonyme) : le compte Google y est rattaché (même
// identité, rien ne change) ; si ce compte Google existe déjà (relié depuis un autre appareil), on s'y connecte.
export async function connectGoogle({ onWaiting } = {}) {
  const u = auth.currentUser;
  const anon = !!u?.isAnonymous;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  let user;
  if (viaRelay) {
    let cred = await relayCredential(onWaiting);
    if (anon) {
      try {
        user = (await linkWithCredential(u, cred)).user;
      } catch (e) {
        if (!/credential-already-in-use|email-already-in-use|provider-already-linked/.test(e.code || '')) throw e;
        cred = GoogleAuthProvider.credentialFromError(e) || cred;
      }
    }
    user ||= (await signInWithCredential(auth, cred)).user;
  } else if (anon) {
    try {
      user = (await linkWithPopup(u, provider, browserPopupRedirectResolver)).user;
    } catch (e) {
      if (!/credential-already-in-use|email-already-in-use/.test(e.code || '')) throw e;
      const cred = GoogleAuthProvider.credentialFromError(e);
      if (!cred) throw e;
      user = (await signInWithCredential(auth, cred)).user;
    }
  } else {
    user = (await signInWithPopup(auth, provider, browserPopupRedirectResolver)).user;
  }
  cloud.uid = user.uid;
  localStorage.removeItem('boombox.spaceOk');
  return user;
}

// Bibliothèque reliée au compte Google connecté
export async function accountSpace() {
  return (await getDoc(doc(db, 'users', cloud.uid)))?.data()?.spaceId || null;
}
export async function saveAccountSpace(sid = cloud.spaceId) {
  await setDoc(doc(db, 'users', cloud.uid), { spaceId: sid, email: googleEmail(), at: Date.now() }, { merge: true });
}

// Appareil déjà relié à une bibliothèque (connexion sans compte) : on y rattache le compte Google.
// chooseSpace() : appelé si ce compte Google va déjà avec une autre bibliothèque → 'theirs' ou 'mine'.
export async function linkGoogleToSpace({ chooseSpace, onWaiting } = {}) {
  const sid = cloud.spaceId;
  // Code secret de la bibliothèque, lu tant que cet appareil en est membre (pour y ajouter le compte Google)
  const secret = (await getDoc(doc(db, 'spaces', sid, 'private', 'secret'))).data()?.value;
  const before = cloud.uid;
  await connectGoogle({ onWaiting });
  if (cloud.uid !== before) {
    const other = await accountSpace().catch(() => null);
    if (other && other !== sid && (await chooseSpace?.()) === 'theirs') {
      cloud._setSpace(other);
      return 'switched';
    }
    if (other !== sid) await cloud._joinSpace(sid, secret, (await import('./state.js')).state.device.name);
  }
  await saveAccountSpace(sid);
  return 'linked';
}

// ---------- Code de sécurité ----------
// Montré dès la création de la bibliothèque : si tu perds l'accès à ton compte Google (ou sans compte Google), il
// suffit pour tout retrouver sur un nouvel appareil.
export async function showSecurityCode({ fresh = false } = {}) {
  const R = await import('./recovery.js');
  let code = await R.readSecurityCode().catch(() => null);
  if (!code) {
    code = R.newSecurityCode();
    await R.saveSecurityCode(code);
  }
  await modal({
    title: '🔐 Ton code de sécurité',
    body: String(html`<p class="muted" style="margin-top:0">${fresh ? 'Ta bibliothèque est prête ! ' : ''}Garde ce code précieusement : fais une capture d'écran ou note-le. Si un jour tu n'as plus accès à ton compte Google, il suffit pour retrouver toute ta bibliothèque sur un nouvel appareil (« Sans compte Google » → « J'ai mon code de sécurité »).</p>
      <div class="sec-code" id="sec-code">${code}</div>
      <button class="btn ghost" id="sec-copy" style="width:100%">Copier le code</button>
      <p class="muted" style="font-size:12px;margin-bottom:0">Tu peux le revoir à tout moment dans Paramètres → Compte.</p>`),
    actions: [{ label: fresh ? 'C’est noté' : 'Fermer', primary: true }],
    onMount: (w) => {
      w.querySelector('#sec-copy').onclick = () => navigator.clipboard?.writeText(code).then(() => toast('Code copié'));
    },
  });
}

// Bouton « Continuer avec Google » (logo officiel)
export const GOOGLE_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

// Appareil déjà relié (sans compte) : connexion Google depuis la proposition au démarrage ou les Paramètres
export async function connectGoogleFlow() {
  try {
    const res = await linkGoogleToSpace({
      onWaiting: (cancel) => {
        toast('Termine la connexion Google dans ton navigateur, puis reviens ici', { action: 'Annuler', onAction: cancel, timeout: 10 * 60e3 });
      },
      chooseSpace: async () => (await modal({
        title: 'Ce compte Google a déjà une bibliothèque',
        body: '<p class="muted" style="margin-top:0">Ce compte Google est déjà relié à une autre bibliothèque Boombox. Laquelle veux-tu garder sur cet appareil ?</p>',
        actions: [{ label: 'Garder celle de cet appareil', value: () => 'mine' }, { label: 'Prendre celle du compte', primary: true, value: () => 'theirs' }],
      })) || 'mine',
    });
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    if (res === 'switched') return location.reload();
    toast(`Compte Google connecté${googleEmail() ? ` (${googleEmail()})` : ''}`);
    const R = await import('./recovery.js');
    if (!(await R.readSecurityCode().catch(() => null))) await showSecurityCode();
    return true;
  } catch (e) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    if (!/popup-closed|cancelled/.test(e.code || '')) toast(googleError(e), { timeout: 6000 });
    return false;
  }
}

// Proposition au démarrage (appareils reliés sans compte Google) : une fois, puis tous les 7 jours si « Plus tard »
export async function offerGoogle() {
  if (isGoogle() || Date.now() < Number(localStorage.getItem('boombox.googleAskAt') || 0)) return;
  const r = await modal({
    title: 'Connecte ton compte Google',
    body: '<p class="muted" style="margin-top:0">Avec Google, ta bibliothèque te suit partout : sur un nouveau téléphone ou un nouveau PC, tu te connectes et tu retrouves tout, sans lien ni QR code. Rien ne change dans ta bibliothèque.</p>',
    actions: [{ label: 'Plus tard' }, { label: 'Connecter Google', primary: true, value: () => 'go' }],
  });
  if (r !== 'go') return localStorage.setItem('boombox.googleAskAt', String(Date.now() + 7 * 86400e3));
  await connectGoogleFlow();
}
