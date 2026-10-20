// Amis Boombox : activité d'écoute (si la personne l'a activée) et messages (texte, sons, playlists).
// Chaque profil a un « code ami » et une fiche publique people/{code} : nom, photo, et — seulement si le partage
// est activé dans les paramètres — le son en cours ou le dernier écouté. Les messages arrivent dans
// people/{code}/inbox, lisible uniquement par les appareils du profil (voir firestore.rules).
import { state, emit, on, updateProfile, cleanTrack, addToPlaylist, removeFromPlaylist, updatePlaylist, getStatsFull } from './state.js';
import { cloud, db, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, query, where, orderBy, limit, writeBatch } from './cloud.js';
import { player } from './player.js';
import { toast } from './ui.js';

const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => A[b % A.length]).join('');
const peopleRef = (code) => doc(db, 'people', code);
const inboxCol = (code) => collection(db, 'people', code, 'inbox');
const slim = (t) => {
  const c = cleanTrack(t);
  return c && { id: c.id, title: c.title, artists: c.artists.map((a) => ({ name: a.name, id: a.id })), duration: c.duration, thumb: c.thumb };
};
const LIKES = '__likes';
const smallBanner = (p) => (p.banner && p.banner.length < 250000 ? p.banner : null);
const smallPhoto =(p) => (p.photo && p.photo.length < 60000 ? p.photo : null);

export const social = {
  friends: [], // [{ code, name, photo, color, share, activity, self? }]
  inbox: [], // messages (reçus et envoyés), du plus récent au plus ancien
  unread: 0,
  ready: false,
  _unsubs: [],
  _friendUnsubs: new Map(),
  _lastPub: { id: null, playing: null, at: 0 },

  get code() {
    return state.profile?.socialCode || null;
  },
  get sharing() {
    return state.profile?.shareActivity !== false; // partagée par défaut (désactivable)
  },

  // Fiche publique du profil (créée à la première ouverture), puis abonnements : amis et messages
  async start() {
    const p = state.profile;
    if (!p) return;
    if (!p.socialCode) {
      p.socialCode = newCode();
      await updateProfile(p.id, { socialCode: p.socialCode }).catch(() => {});
    }
    await this._ensureCard();
    this.ready = true;
    this._watchInbox();
    this.refreshFriends();
    this._startPlaylistSharing();
    setTimeout(() => this.publishTop(), 15e3);
    setInterval(() => this.publishTop(), 3600e3);
    on('player:track', () => this.publishActivity());
    on('player:state', () => this.publishActivity());
    // Nom / photo changés dans le profil : la fiche suit
    document.addEventListener('profile-updated', () => this._syncCard());
  },

  // Fiche publique : créée / mise à jour au démarrage ; en cas d'échec (hors ligne, règles pas encore à jour),
  // nouvel essai 30 s plus tard, et de toute façon avant un envoi
  async _ensureCard() {
    const p = state.profile;
    try {
      await setDoc(peopleRef(p.socialCode), { space: cloud.spaceId, pid: p.id, name: p.name, photo: smallPhoto(p), color: p.color || '#b07cf7', banner: smallBanner(p), share: p.shareActivity !== false, likes: p.shareLikes !== false, updatedAt: Date.now() }, { merge: true });
      this._cardOk = true;
      if (this._inboxBroken) this._watchInbox();
    } catch (e) {
      this._cardOk = false;
      console.warn('Amis :', e.message);
      clearTimeout(this._cardRetry);
      this._cardRetry = setTimeout(() => this._ensureCard(), 30e3);
    }
  },

  _syncCard() {
    const p = state.profile;
    if (!this.code) return;
    updateDoc(peopleRef(this.code), { name: p.name, photo: smallPhoto(p), banner: smallBanner(p), color: p.color || '#b07cf7', updatedAt: Date.now() }).catch(() => {});
  },

  // ----- Activité d'écoute -----
  async setSharing(on) {
    const p = state.profile;
    p.shareActivity = !!on;
    await updateProfile(p.id, { shareActivity: !!on });
    // Partage coupé : l'activité est effacée de la fiche (plus rien de visible)
    await updateDoc(peopleRef(this.code), on ? { share: true } : { share: false, activity: null }).catch(() => {});
    this._lastPub = { id: null, playing: null, at: 0 };
    if (on) this.publishActivity(true);
    emit('social');
  },

  // Top du moment (30 derniers jours) visible sur mon profil par mes amis, si l'activité est partagée.
  // Recalculé au démarrage puis toutes les 6 h.
  async publishTop() {
    if (!this.code) return;
    if (!this.sharing) return updateDoc(peopleRef(this.code), { top: null, stats: null }).catch(() => {});
    const st = await getStatsFull(30, null, 10).catch(() => null);
    if (!st) return;
    const top = {
      at: Date.now(),
      tracks: (st.topTracks || []).slice(0, 10).map((t) => ({ ...slim(t.track), count: t.count })),
      artists: (st.topArtists || []).slice(0, 6).map((a) => ({ id: a.artist.id || null, name: a.artist.name, thumb: a.thumb || null, count: a.count })),
      minutes: st.minutes || 0,
    };
    // Chiffres pour le classement Boombox : semaine (depuis lundi), mois, année en cours
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
    const ranges = { week: monday, month: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), year: new Date(now.getFullYear(), 0, 1).getTime() };
    const stats = { at: Date.now(), week0: monday, month0: ranges.month, year0: ranges.year };
    for (const [k, since] of Object.entries(ranges)) {
      const r = await getStatsFull(0, { since, until: Date.now() }, 1).catch(() => null);
      stats[k] = r ? { minutes: r.minutes || 0, plays: r.plays || 0, artists: r.uniqueArtists || 0, tracks: r.uniqueTracks || 0 } : null;
    }
    await updateDoc(peopleRef(this.code), { top, stats }).catch(() => {});
  },

  // Son en cours (ou dernier écouté) : écrit au changement de titre, à la lecture / pause, et au plus toutes les 10 s
  publishActivity(force = false) {
    if (!this.ready || !this.sharing || !this.code) return;
    if (player.remoteSender) return; // on pilote un autre appareil : c'est lui qui publie
    const t = player.track;
    if (!t) return;
    const playing = !player.paused;
    const last = this._lastPub;
    if (!force && last.id === t.id && last.playing === playing) return;
    // Lecture / pause en rafale sur le même son : on n'écrit pas plus d'une fois toutes les 10 s,
    // mais le dernier état part quand même à la fin du délai (sinon une pause resterait « en écoute »)
    const wait = 10e3 - (Date.now() - last.at);
    if (!force && last.id === t.id && wait > 0) {
      clearTimeout(this._pubTimer);
      this._pubTimer = setTimeout(() => this.publishActivity(), wait + 50);
      return;
    }
    clearTimeout(this._pubTimer);
    this._lastPub = { id: t.id, playing, at: Date.now() };
    const ctx = player.context?.name ? { name: String(player.context.name).slice(0, 100), type: player.context.type || null, id: player.context.type === 'playlist' ? null : player.context.id || null } : null;
    updateDoc(peopleRef(this.code), { activity: { track: slim(t), context: ctx, playing, at: Date.now() } }).catch(() => {});
  },

  // ----- Amis -----
  // Mes amis ajoutés + les autres profils du même espace (s'ils ont déjà ouvert Boombox depuis cette version)
  _codes() {
    const mine = (state.profile?.friends || []).map((f) => f.code);
    const space = (state.profiles || []).filter((p) => p.id !== state.profile?.id && p.socialCode).map((p) => p.socialCode);
    return [...new Set([...space, ...mine])].filter((c) => c && c !== this.code);
  },
  refreshFriends() {
    const codes = new Set(this._codes());
    for (const [c, off] of this._friendUnsubs) if (!codes.has(c)) (off(), this._friendUnsubs.delete(c));
    for (const c of codes) {
      if (this._friendUnsubs.has(c)) continue;
      this._friendUnsubs.set(c, onSnapshot(peopleRef(c), (s) => {
        const d = s.exists() ? s.data() : null;
        const i = this.friends.findIndex((f) => f.code === c);
        const f = d && { code: c, name: d.name, photo: d.photo, color: d.color, share: !!d.share, activity: d.share ? d.activity || null : null, sameSpace: d.space === cloud.spaceId };
        if (i >= 0) f ? (this.friends[i] = f) : this.friends.splice(i, 1);
        else if (f) this.friends.push(f);
        emit('social');
      }, () => {}));
    }
    this.friends = this.friends.filter((f) => codes.has(f.code));
    emit('social');
  },

  async addFriend(input) {
    const m = String(input || '').toUpperCase().match(/(?:[?&](?:ADD|F)=)?([A-Z2-9]{8})\b/);
    if (!m) throw new Error('Code ami invalide (8 caractères)');
    const code = m[1];
    if (code === this.code) throw new Error("C'est ton propre code");
    const s = await getDoc(peopleRef(code));
    if (!s.exists()) throw new Error('Aucun profil Boombox avec ce code');
    // Il m'avait déjà envoyé une demande : on l'accepte directement
    if (this.requests().some((r) => r.peer === code)) return (await this.acceptRequest(code), s.data().name);
    if (this.isAdded(code)) return s.data().name;
    await this._setFriend(code, s.data().name, true);
    await this._system(code, { request: true });
    return s.data().name;
  },
  // Demandes d'ami reçues (pas encore acceptées ni refusées)
  requests() {
    const seen = new Set();
    return this._sys.filter((m) => m.request && !m.out && !this.isAdded(m.peer) && !seen.has(m.peer) && seen.add(m.peer));
  },
  isPending(code) {
    return (state.profile?.friends || []).some((f) => f.code === code && f.pending);
  },
  async acceptRequest(code) {
    const r = this._sys.find((m) => m.request && m.peer === code);
    await this._setFriend(code, r?.fromName || 'Ami', false);
    await this._system(code, { accept: true });
    this._clearSys(code, (m) => m.request);
    toast(`${r?.fromName || 'Ton ami'} est maintenant dans tes amis`);
  },
  declineRequest(code) {
    this._clearSys(code, (m) => m.request);
  },
  async _setFriend(code, name, pending) {
    const list = (state.profile.friends || []).filter((f) => f.code !== code);
    list.push({ code, name, addedAt: Date.now(), ...(pending ? { pending: true } : {}) });
    state.profile.friends = list;
    await updateProfile(state.profile.id, { friends: list });
    this.refreshFriends();
  },
  // Messages « système » (demande, acceptation, accusé de lecture) : écrits dans la boîte de l'autre, jamais affichés comme messages
  async _system(code, extra) {
    if (!this._cardOk) await this._ensureCard();
    const p = state.profile;
    await addDoc(inboxCol(code), { text: '', at: Date.now(), sys: true, ...extra, fromName: p.name, fromPhoto: smallPhoto(p), fromColor: p.color || '#b07cf7', peer: this.code, out: false, read: true });
  },
  _clearSys(code, test) {
    for (const m of this._sys) if (m.peer === code && test(m)) deleteDoc(doc(db, 'people', this.code, 'inbox', m.mid)).catch(() => {});
  },
  // Réactions emoji : un message est repéré par son heure d'envoi (identique dans les deux boîtes).
  // Ma réaction part chez l'ami (message système) et une copie reste chez moi ; '' = réaction retirée
  async react(code, at, emoji) {
    const p = state.profile;
    const base = { text: '', at: Date.now(), sys: true, react: emoji || '', target: at, fromName: p.name };
    await addDoc(inboxCol(code), { ...base, peer: this.code, out: false, read: true });
    await addDoc(inboxCol(this.code), { ...base, peer: code, out: true, read: true }).catch(() => {});
  },
  reactions(code, at) {
    const last = (out) => this._sys.filter((m) => m.react != null && m.peer === code && m.target === at && !!m.out === out).sort((a, b) => b.at - a.at)[0]?.react || '';
    return { mine: last(true), theirs: last(false) };
  },
  // « Vu » : le dernier moment où cet ami a lu mes messages
  seenAt(code) {
    return this._sys.filter((m) => m.receipt && m.peer === code).reduce((a, m) => Math.max(a, m.readAt || 0), 0);
  },
  async removeFriend(code) {
    const list = (state.profile.friends || []).filter((f) => f.code !== code);
    state.profile.friends = list;
    await updateProfile(state.profile.id, { friends: list });
    this.refreshFriends();
  },
  friend(code) {
    return this.friends.find((f) => f.code === code) || null;
  },
  isAdded(code) {
    return (state.profile?.friends || []).some((f) => f.code === code);
  },

  // Profil supprimé : sa fiche, ses playlists partagées et ses messages disparaissent aussi
  async deleteCard(code) {
    for (const sub of ['playlists', 'inbox']) {
      const s = await getDocs(collection(db, 'people', code, sub)).catch(() => null);
      for (const d of s?.docs || []) await deleteDoc(d.ref).catch(() => {});
    }
    await deleteDoc(peopleRef(code));
  },

  // ----- Playlists publiques / partagées -----
  // Une playlist publique (ou avec des collaborateurs) est copiée dans people/{moi}/playlists/{id} :
  // publique → visible sur mon profil par mes amis (écoute, ajout à leur bibliothèque) ;
  // collaborateurs → ils la modifient comme moi, et leurs changements reviennent dans ma playlist.
  _pubSig: new Map(),
  _appliedAt: new Map(),
  _appliedKey: new Map(),
  async _startPlaylistSharing() {
    const col = collection(db, 'people', this.code, 'playlists');
    // Copies en ligne de playlists supprimées ou repassées en privé (depuis un autre appareil, par exemple)
    let timer = null;
    const later = (ms = 1500) => (clearTimeout(timer), (timer = setTimeout(() => this.publishPlaylists(), ms)));
    this._later = later;
    const existing = await getDocs(col).catch(() => null);
    for (const d of existing?.docs || []) {
      this._pubSig.set(d.id, 'online');
      // Modifiée par un collaborateur pendant mon absence : ses changements passent avant ma republication
      const data = d.data();
      if (data.editor && data.editor !== this.code) await this._applyRemote(d.id, data).catch(() => {});
    }
    on('library', () => later());
    this.publishPlaylists();
    onSnapshot(col, (snap) => {
      for (const ch of snap.docChanges()) {
        const d = ch.doc.data();
        if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites || !d.editor || d.editor === this.code) continue;
        this._applyRemote(ch.doc.id, d);
      }
    }, () => {});
  },
  _shared(p) {
    return p.visibility === 'public' || (p.collaborators || []).length > 0;
  },
  publishPlaylists() {
    if (!this.code) return;
    const seen = new Set();
    for (const p of state.library.playlists) {
      seen.add(p.id);
      // Changements d'un collaborateur reçus à l'instant : on attend que ma bibliothèque les ait intégrés
      if (Date.now() - (this._appliedAt.get(p.id) || 0) < 5000) {
        this._later?.(5000);
        continue;
      }
      const ref = doc(db, 'people', this.code, 'playlists', p.id);
      const collab = (p.collaborators || []).map((c) => c.code);
      const sig = this._shared(p) ? JSON.stringify([p.visibility, p.name, p.description, p.tracks.map((t) => t.id), collab, (p.cover || '').length]) : null;
      if (sig === this._pubSig.get(p.id) || (!sig && !this._pubSig.has(p.id))) continue;
      if (sig) {
        setDoc(ref, {
          owner: this.code, ownerName: state.profile.name, visibility: p.visibility === 'public' ? 'public' : 'private',
          name: p.name, description: p.description || '', cover: p.cover && p.cover.length < 60000 ? p.cover : null,
          tracks: p.tracks.slice(0, 2000).map(slim).filter(Boolean), collaborators: collab,
          editor: this.code, editorName: state.profile.name, editedAt: Date.now(), updatedAt: Date.now(),
        }).then(() => this._pubSig.set(p.id, sig)).catch((e) => console.warn('Playlist publique :', e.message));
      } else deleteDoc(ref).then(() => this._pubSig.delete(p.id)).catch(() => {});
    }
    // Titres likés visibles par mes amis (si activé dans les paramètres) : copie spéciale « __likes »
    seen.add(LIKES);
    const likesRef = doc(db, 'people', this.code, 'playlists', LIKES);
    const liked = state.library.liked;
    const lsig = this.sharingLikes ? `${liked.length}:${liked.slice(0, 50).map((t) => t.id).join(',')}` : null;
    if (lsig !== this._pubSig.get(LIKES) && (lsig || this._pubSig.has(LIKES))) {
      if (lsig) {
        setDoc(likesRef, { owner: this.code, ownerName: state.profile.name, visibility: 'likes', name: 'Titres likés', tracks: liked.slice(0, 2000).map(slim).filter(Boolean), collaborators: [], editor: this.code, updatedAt: Date.now() })
          .then(() => this._pubSig.set(LIKES, lsig)).catch((e) => console.warn('Likes partagés :', e.message));
      } else deleteDoc(likesRef).then(() => this._pubSig.delete(LIKES)).catch(() => {});
    }
    for (const id of [...this._pubSig.keys()]) if (!seen.has(id)) deleteDoc(doc(db, 'people', this.code, 'playlists', id)).then(() => this._pubSig.delete(id)).catch(() => {});
  },
  // Un collaborateur a modifié ma playlist : on reporte ses changements (titres ajoutés / retirés, nom, description)
  async _applyRemote(id, d) {
    const p = state.library.playlists.find((x) => x.id === id);
    if (!p) return;
    // Même modification déjà reportée (lecture au démarrage puis abonnement) : rien à refaire, pas de doublons
    const key = `${d.editor}:${d.editedAt}`;
    if (this._appliedKey.get(id) === key) return;
    this._appliedKey.set(id, key);
    this._appliedAt.set(id, Date.now());
    const remote = new Set(d.tracks.map((t) => t.id));
    const local = new Set(p.tracks.map((t) => t.id));
    const add = d.tracks.filter((t) => !local.has(t.id));
    const del = p.tracks.filter((t) => !remote.has(t.id));
    if (add.length) await addToPlaylist(p.id, add, { quiet: true });
    for (const t of del) await removeFromPlaylist(p.id, t);
    const patch = {};
    if (d.name && d.name !== p.name) patch.name = d.name;
    if ((d.description || '') !== (p.description || '')) patch.description = d.description || '';
    if (Object.keys(patch).length) await updatePlaylist(p.id, patch);
    if (add.length || del.length || patch.name) toast(`${d.editorName || 'Un collaborateur'} a modifié « ${d.name} »`);
  },
  async setVisibility(p, visibility) {
    await updatePlaylist(p.id, { visibility });
    toast(visibility === 'public' ? `« ${p.name} » est publique : tes amis la voient sur ton profil` : `« ${p.name} » est privée`);
  },
  async setCollaborators(p, list) {
    const before = new Set((p.collaborators || []).map((c) => c.code));
    await updatePlaylist(p.id, { collaborators: list });
    // Les nouveaux collaborateurs reçoivent un message avec le lien de la playlist
    for (const c of list) if (!before.has(c.code)) this.send(c.code, { text: `Je t'ai ajouté comme collaborateur de « ${p.name} » : tu peux la modifier comme moi.`, collab: { owner: this.code, id: p.id, name: p.name } }).catch(() => {});
  },
  get sharingLikes() {
    return state.profile?.shareLikes !== false; // activé par défaut
  },
  async setShareLikes(on) {
    const p = state.profile;
    p.shareLikes = !!on;
    await updateProfile(p.id, { shareLikes: !!on });
    await updateDoc(peopleRef(this.code), { likes: !!on }).catch(() => {});
    this.publishPlaylists();
  },
  // Titres likés d'un ami (null s'il ne les partage pas)
  async friendLikes(code) {
    const s = await getDoc(doc(db, 'people', code, 'playlists', LIKES)).catch(() => null);
    return s?.exists() ? s.data().tracks || [] : null;
  },
  // Playlists publiques d'un ami (pour son profil), et une playlist partagée précise
  async publicPlaylists(code) {
    const s = await getDocs(query(collection(db, 'people', code, 'playlists'), where('visibility', '==', 'public')));
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  watchShared(owner, id, cb) {
    return onSnapshot(doc(db, 'people', owner, 'playlists', id), (s) => cb(s.exists() ? { id, ...s.data() } : null), () => cb(null));
  },
  canEdit(pl) {
    return !!pl && (pl.owner === this.code || (pl.collaborators || []).includes(this.code));
  },
  // Modification par un collaborateur : écrite dans la copie partagée, le propriétaire la reçoit
  editShared(pl, patch) {
    const p = { ...patch, editor: this.code, editorName: state.profile.name, editedAt: Date.now(), updatedAt: Date.now() };
    if (p.tracks) p.tracks = p.tracks.slice(0, 2000).map(slim).filter(Boolean);
    return updateDoc(doc(db, 'people', pl.owner, 'playlists', pl.id), p);
  },

  // ----- Messages -----
  _sys: [],
  _watchInbox() {
    let first = true;
    this._inboxBroken = false;
    this._inboxOff?.();
    this._inboxOff = (onSnapshot(query(inboxCol(this.code), orderBy('at', 'desc'), limit(300)), (snap) => {
      const all = snap.docs.map((d) => ({ mid: d.id, ...d.data() }));
      this.inbox = all.filter((m) => !m.sys);
      this._sys = all.filter((m) => m.sys);
      this._handleSys();
      this.unread = this.inbox.filter((m) => !m.out && !m.read).length;
      if (!first) {
        for (const ch of snap.docChanges()) {
          const m = ch.doc.data();
          if (ch.type === 'added' && m.sys && m.request && !this.isAdded(m.peer) && !ch.doc.metadata.hasPendingWrites) {
            toast(`${m.fromName || 'Quelqu’un'} veut t'ajouter en ami`, { action: 'Voir', onAction: () => (location.hash = '#/friends'), timeout: 8000 });
            continue;
          }
          if (ch.type !== 'added' || m.sys || m.out || m.read || ch.doc.metadata.hasPendingWrites) continue;
          // Pas de notification si la conversation est déjà ouverte à l'écran
          if (location.hash.includes(`friends?c=${m.peer}`)) continue;
          toast(`${m.fromName || 'Un ami'} : ${preview(m)}`, { action: 'Voir', onAction: () => (location.hash = `#/friends?c=${m.peer}`), timeout: 6000 });
        }
      }
      first = false;
      emit('social');
    }, (e) => {
      // Boîte illisible tant que la fiche n'existe pas : on se réabonne une fois la fiche créée
      this._inboxBroken = true;
      console.warn('Messages :', e.message);
    }));
  },
  thread(code) {
    return this.inbox.filter((m) => m.peer === code).sort((a, b) => a.at - b.at);
  },
  async markRead(code) {
    const unread = this.inbox.filter((m) => m.peer === code && !m.out && !m.read);
    if (!unread.length) return;
    const b = writeBatch(db);
    unread.forEach((m) => b.update(doc(db, 'people', this.code, 'inbox', m.mid), { read: true }));
    await b.commit().catch(() => {});
    this._system(code, { receipt: true, readAt: Date.now() }).catch(() => {});
  },
  // Acceptations reçues → l'ami n'est plus « en attente » ; ancien accusés de lecture nettoyés (on garde le dernier)
  _handleSys() {
    const list = state.profile?.friends || [];
    let changed = false;
    for (const m of this._sys) {
      if (m.accept && list.some((f) => f.code === m.peer && f.pending)) {
        list.forEach((f) => f.code === m.peer && delete f.pending);
        changed = true;
        this._clearSys(m.peer, (x) => x.accept);
        toast(`${m.fromName || 'Ton ami'} a accepté ta demande d'ami`);
      }
      // Demande reçue de quelqu'un que j'ai moi-même demandé : on devient amis tout de suite
      if (m.request && list.some((f) => f.code === m.peer && f.pending)) {
        list.forEach((f) => f.code === m.peer && delete f.pending);
        changed = true;
        this._system(m.peer, { accept: true }).catch(() => {});
        this._clearSys(m.peer, (x) => x.request);
      }
    }
    if (changed) updateProfile(state.profile.id, { friends: list }).then(() => this.refreshFriends()).catch(() => {});
    const latest = new Map();
    for (const m of this._sys.filter((x) => x.receipt).sort((a, b) => b.readAt - a.readAt)) {
      if (latest.has(m.peer)) deleteDoc(doc(db, 'people', this.code, 'inbox', m.mid)).catch(() => {});
      else latest.set(m.peer, m);
    }
  },
  // msg : { text } | { tracks: [...] } | { playlist: {...} } (+ text facultatif)
  async send(code, msg) {
    if (!this.code) throw new Error('Profil pas encore prêt');
    if (!this._cardOk) await this._ensureCard();
    const p = state.profile;
    const body = { text: String(msg.text || '').slice(0, 2000), at: Date.now() };
    if (msg.tracks?.length) body.tracks = msg.tracks.slice(0, 50).map(slim).filter(Boolean);
    if (msg.playlist) {
      const pl = msg.playlist;
      body.playlist = { name: String(pl.name || 'Playlist').slice(0, 100), description: String(pl.description || '').slice(0, 300), tracks: (pl.tracks || []).slice(0, 500).map(slim).filter(Boolean), cover: pl.cover && pl.cover.length < 60000 ? pl.cover : null };
    }
    if (msg.image) body.image = String(msg.image).slice(0, 900000);
    if (msg.gif) body.gif = String(msg.gif).slice(0, 500);
    if (msg.sticker) body.sticker = String(msg.sticker).slice(0, 300000);
    if (msg.collab) body.collab = { owner: msg.collab.owner, id: msg.collab.id, name: String(msg.collab.name || '').slice(0, 100) };
    if (!body.text && !body.tracks && !body.playlist && !body.image && !body.gif && !body.sticker) return;
    const type = body.playlist ? 'playlist' : body.tracks ? 'tracks' : body.image || body.gif || body.sticker ? 'image' : 'text';
    const from = { fromName: p.name, fromPhoto: smallPhoto(p), fromColor: p.color || '#b07cf7' };
    // Chez l'ami (peer = moi), puis ma copie (peer = lui) pour retrouver la conversation
    await addDoc(inboxCol(code), { ...body, ...from, type, peer: this.code, out: false, read: false });
    await addDoc(inboxCol(this.code), { ...body, ...from, type, peer: code, out: true, read: true }).catch(() => {});
  },
};

export function preview(m) {
  if (m.playlist) return `🎵 Playlist « ${m.playlist.name} »${m.text ? ` · ${m.text}` : ''}`;
  if (m.gif || m.image) return `🖼️ ${m.gif ? 'GIF' : 'Image'}${m.text ? ` · ${m.text}` : ''}`;
  if (m.sticker) return '🙂 Sticker';
  if (m.tracks?.length) return `🎶 ${m.tracks.length > 1 ? `${m.tracks.length} sons` : `« ${m.tracks[0].title} »`}${m.text ? ` · ${m.text}` : ''}`;
  return m.text || '';
}

// « il y a 8 h »
export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d < 7 ? `il y a ${d} j` : new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// En écoute en ce moment : lecture en cours, signalée il y a moins que la durée du son (+ marge)
export function listeningNow(a) {
  if (!a?.playing || !a.at) return false;
  const max = ((a.track?.duration || 300) + 120) * 1000;
  return Date.now() - a.at < max;
}
