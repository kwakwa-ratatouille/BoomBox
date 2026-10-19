// Firebase : connexion anonyme, « espace » partagé entre tes appareils, accès à Firestore.
// Toutes les données (profils, playlists, likes…) vivent dans spaces/{espace}/… et se
// synchronisent en direct entre appareils, avec un cache hors ligne.
import { initializeApp } from '../vendor/firebase/firebase-app.js';
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInAnonymously, onAuthStateChanged, signOut } from '../vendor/firebase/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED, getDocsFromCache, getDocsFromServer,
  doc, collection, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit, writeBatch, serverTimestamp, arrayUnion, arrayRemove, runTransaction, deleteField,
} from '../vendor/firebase/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
// Appli mobile (Capacitor) : getAuth() charge le module de connexion par fenêtre web, qui ne répond jamais dans
// une appli iPhone (l'appli restait bloquée au chargement). On initialise la connexion sans lui.
export const auth = window.Capacitor?.isNativePlatform?.()
  ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
  : getAuth(app);
// Jeton de connexion (vérifié par le mini-serveur de l'assistant IA : seules les applis Boombox connectées passent)
window.__bbIdToken = () => auth.currentUser?.getIdToken() ?? Promise.resolve(null);
export const db = initializeFirestore(app, {
  // Cache local sans limite de taille : la bibliothèque y est gardée en entier et n'est relue à Firebase que pour les changements
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED }),
  ignoreUndefinedProperties: true,
});
export { getDocsFromCache, getDocsFromServer, doc, collection, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, writeBatch, serverTimestamp, arrayUnion, arrayRemove, runTransaction, deleteField };

const randomId = (n) => {
  const A = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => A[b % A.length]).join('');
};
export { randomId };

export const cloud = {
  uid: null,
  spaceId: localStorage.getItem('boombox.space') || null,

  async signIn() {
    const user = await new Promise((resolve) => {
      const off = onAuthStateChanged(auth, (u) => {
        off();
        resolve(u);
      });
    });
    if (user) {
      this.uid = user.uid;
      return;
    }
    try {
      const cred = await signInAnonymously(auth);
      this.uid = cred.user.uid;
    } catch (e) {
      if (/admin-restricted|operation-not-allowed/.test(e.code || '')) {
        throw new Error("La connexion anonyme n'est pas activée dans Firebase (Authentication → Méthode de connexion → Anonyme).");
      }
      if (!navigator.onLine) throw new Error('Première ouverture : une connexion Internet est nécessaire.');
      throw e;
    }
  },

  // Vérifie que cet appareil fait bien partie de l'espace enregistré.
  async checkSpace() {
    if (!this.spaceId) return false;
    // Déjà vérifié sur cet appareil : on démarre tout de suite et on revérifie en fond (le démarrage n'attend plus le réseau)
    const okKey = 'boombox.spaceOk';
    if (localStorage.getItem(okKey) === `${this.spaceId}:${this.uid}`) {
      getDoc(doc(db, 'spaces', this.spaceId, 'members', this.uid))
        .then((m) => !m.exists() && !m.metadata.fromCache && (localStorage.removeItem(okKey), location.reload()))
        .catch(() => {});
      return true;
    }
    try {
      const m = await getDoc(doc(db, 'spaces', this.spaceId, 'members', this.uid));
      if (m.exists()) return localStorage.setItem(okKey, `${this.spaceId}:${this.uid}`), true;
    } catch (e) {
      // Hors ligne : on fait confiance au cache local
      if (e.code === 'unavailable') return true;
    }
    return false;
  },

  // Connexion refusée (jeton périmé, horloge du téléphone décalée…) : on repart d'une connexion anonyme neuve et on réessaie une fois
  async retryFresh(fn) {
    try {
      return await fn();
    } catch (e) {
      if (!/permission|unauthenticated/i.test(e.code || e.message || '')) throw e;
      await signOut(auth).catch(() => {});
      this.uid = (await signInAnonymously(auth)).user.uid;
      return fn();
    }
  },

  async createSpace(deviceName) {
    return this.retryFresh(() => this._createSpace(deviceName));
  },
  async _createSpace(deviceName) {
    const sid = randomId(20);
    const secret = randomId(32);
    await setDoc(doc(db, 'spaces', sid), { owner: this.uid, createdAt: serverTimestamp() });
    await setDoc(doc(db, 'spaces', sid, 'private', 'secret'), { value: secret });
    await setDoc(doc(db, 'spaces', sid, 'members', this.uid), { secret, deviceName, joinedAt: serverTimestamp() });
    this._setSpace(sid);
    return sid;
  },

  async joinSpace(sid, secret, deviceName) {
    return this.retryFresh(() => this._joinSpace(sid, secret, deviceName));
  },
  async _joinSpace(sid, secret, deviceName) {
    await setDoc(doc(db, 'spaces', sid, 'members', this.uid), { secret, deviceName, joinedAt: serverTimestamp() });
    this._setSpace(sid);
  },

  leaveSpace() {
    localStorage.removeItem('boombox.space');
    this.spaceId = null;
  },

  _setSpace(sid) {
    this.spaceId = sid;
    localStorage.setItem('boombox.space', sid);
  },

  // Appareils liés à l'espace (membres), et retrait d'un appareil (il perd l'accès à la bibliothèque)
  async members() {
    const snap = await getDocs(collection(db, 'spaces', this.spaceId, 'members'));
    return snap.docs.map((d) => ({ id: d.id, deviceName: d.data().deviceName || '', joinedAt: d.data().joinedAt?.toDate?.() || null })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  },
  removeMember(uid) {
    return deleteDoc(doc(db, 'spaces', this.spaceId, 'members', uid));
  },

  // Lien d'invitation pour lier un autre appareil.
  async inviteLink(base = location.origin) {
    const s = await getDoc(doc(db, 'spaces', this.spaceId, 'private', 'secret'));
    return `${base}/#/join?s=${this.spaceId}&k=${s.data().value}`;
  },

  // Raccourcis vers les chemins de l'espace
  ref(...path) {
    return doc(db, 'spaces', this.spaceId, ...path);
  },
  col(...path) {
    return collection(db, 'spaces', this.spaceId, ...path);
  },
};

// Lit les paramètres d'un lien d'invitation (#/join?s=…&k=… ou boombox://join?s=…&k=…)
export function parseInvite(text) {
  const m = String(text || '').match(/[?&]s=([\w-]+).*?[?&]k=([\w-]+)/);
  return m ? { sid: m[1], secret: m[2] } : null;
}
