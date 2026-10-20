// Synchronisation entre appareils via Firestore (fonctionne par Internet, sans serveur à faire tourner) :
// appareils connectés (contrôle à distance façon Spotify Connect) et Jam (écoute à plusieurs).
// La bibliothèque, elle, se synchronise toute seule (voir state.js).
import { state, emit, on, ls, api } from './state.js';
import { player } from './player.js';
import { toast } from './ui.js';
import { cloud, db, doc, collection, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, arrayUnion, arrayRemove, runTransaction, deleteField } from './cloud.js';

const ONLINE_MS = 75e3;

export const sync = {
  connected: false,
  devices: [],
  remote: {}, // deviceId -> dernier état connu
  target: null, // appareil piloté (null = cet appareil)
  jam: null,
  listenAlong: false,
  _allDevices: [],
  _unsubs: [],
  _jamUnsubs: [],
  _jamCode: null,

  devRef(id = state.device.id) {
    return cloud.ref('devices', id);
  },

  async connect() {
    const { device, profile } = state;
    // PC : ses adresses sur le réseau local, pour que le téléphone lise par lui quand il est sur le même Wi-Fi
    const lan = window.Capacitor?.isNativePlatform?.() ? [] : state.status?.lan || [];
    await setDoc(this.devRef(), { name: device.name, kind: device.kind, profileId: profile.id, profileName: profile.name, lan, lastSeen: Date.now(), online: true }, { merge: true }).catch(() => {});
    this.connected = true;

    this._unsubs.push(
      onSnapshot(query(cloud.col('devices'), where('profileId', '==', profile.id)), (snap) => {
        this._allDevices = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        for (const d of this._allDevices) if (d.id !== device.id && d.state) this.remote[d.id] = d.state;
        this._refreshDevices();
        if (this.target) {
          emit('player:track');
          emit('player:state');
          emit('player:queue');
        }
      }),
      // Commandes reçues d'un autre appareil (télécommande)
      onSnapshot(collection(db, 'spaces', cloud.spaceId, 'devices', device.id, 'commands'), (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type !== 'added') continue;
          const c = ch.doc.data();
          deleteDoc(ch.doc.ref).catch(() => {});
          if (Date.now() - (c.at || 0) < 60e3) this._command(c);
        }
      }),
    );

    // Présence : signal de vie régulier
    setInterval(() => {
      updateDoc(this.devRef(), { lastSeen: Date.now(), online: true, ...(player.track && !player.paused ? { state: player.snapshot() } : {}) }).catch(() => {});
      this._refreshDevices();
    }, 25e3);
    window.addEventListener('pagehide', () => updateDoc(this.devRef(), { online: false }).catch(() => {}));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') updateDoc(this.devRef(), { lastSeen: Date.now(), online: true }).catch(() => {});
    });

    const savedJam = ls.get('boombox.jam');
    if (savedJam) this._subscribeJam(savedJam, true);
    emit('sync');
  },

  async reconnect() {
    await updateDoc(this.devRef(), { name: state.device.name }).catch(() => {});
  },

  _refreshDevices() {
    const now = Date.now();
    this.devices = this._allDevices
      .filter((d) => d.id === state.device.id || (d.online !== false && now - (d.lastSeen || 0) < ONLINE_MS))
      .map((d) => ({ id: d.id, name: d.name, kind: d.kind, playing: !!(d.state?.track && !d.state.paused) }));
    if (this.target && !this.devices.some((d) => d.id === this.target)) {
      toast("L'appareil piloté s'est déconnecté");
      this.control(null);
    }
    emit('sync');
  },

  sendCommand(target, action, args = []) {
    addDoc(collection(db, 'spaces', cloud.spaceId, 'devices', target, 'commands'), { action, args: JSON.parse(JSON.stringify(args)), from: state.device.id, at: Date.now() }).catch((e) => toast(e.message));
  },

  // Publie l'état de lecture de cet appareil (pour les autres appareils et la Jam).
  publish(force = false) {
    if (!this.connected || !player.track) return;
    const snap = player.snapshot();
    // N'écrit que si quelque chose a réellement changé (limite les écritures Firestore)
    const sig = [snap.track.id, snap.paused, snap.shuffle, snap.repeat, snap.volume, snap.muted, snap.context?.id, snap.upcoming.map((t) => t.id).join()].join('|');
    const last = this._last;
    const expected = last ? (last.paused ? last.position : last.position + (Date.now() - last.ts) / 1000) : 0;
    if (!force && last && sig === this._lastSig && Math.abs(expected - snap.position) < 3) return;
    this._lastSig = sig;
    this._last = snap;
    updateDoc(this.devRef(), { state: snap, lastSeen: Date.now(), online: true }).catch(() => {});
    if (this.isJamHost()) updateDoc(doc(db, 'jams', this._jamCode), { state: snap }).catch(() => {});
  },

  // ----- Contrôle d'un autre appareil -----
  control(deviceId) {
    if (!deviceId || deviceId === state.device.id) {
      this.target = null;
      player.remoteSender = null;
    } else {
      this.target = deviceId;
      player.remoteSender = (action, args) => this.sendCommand(deviceId, action, args);
      if (!player.paused) player.pause();
    }
    emit('sync');
    emit('player:track');
    emit('player:state');
  },

  // Transfère la lecture vers un autre appareil (ou la récupère ici).
  transfer(deviceId) {
    if (deviceId === state.device.id) {
      const from = this.target;
      const st = from && this.remote[from];
      if (from) this.sendCommand(from, 'pause');
      this.control(null);
      if (st?.track) {
        player.list = [st.track, ...(st.upcoming || [])];
        player.order = player.list.map((_, i) => i);
        player.pos = 0;
        player.userQueue = [];
        player.context = st.context;
        player._load(st.track, { start: this.position(st), autoplay: !st.paused });
        emit('player:queue');
      }
      return;
    }
    if (player.track) {
      const snap = { ...player.snapshot(), list: player.list.slice(0, 300), order: player.order.slice(0, 300), pos: player.pos, userQueue: player.userQueue, sentAt: Date.now() };
      this.sendCommand(deviceId, '__transfer', [snap]);
      // Comme Spotify : cet appareil devient la télécommande (la musique continue là-bas, la barre avance ici).
      // Si l'autre appareil ne prend pas la main (appli fermée, en veille…), la lecture reprend ici au lieu de rester en pause.
      const wasPlaying = !snap.paused;
      const trackId = snap.track.id;
      const name = this.devices.find((d) => d.id === deviceId)?.name || "l'autre appareil";
      clearTimeout(this._transferCheck);
      this._transferCheck = setTimeout(() => {
        const st = this.remote[deviceId];
        const took = st?.track?.id === trackId && (st.ts || 0) >= snap.sentAt - 1000;
        if (took || this.target !== deviceId) return;
        this.control(null);
        if (wasPlaying) player.play();
        toast(`${name} n'a pas répondu (appli fermée ou en veille ?) : la musique continue ici`, { timeout: 7000 });
      }, 7000);
    }
    this.control(deviceId);
  },

  position(st) {
    if (!st) return 0;
    return st.paused ? st.position : st.position + (Date.now() - st.ts) / 1000;
  },

  view() {
    if (this.target) {
      const st = this.remote[this.target];
      return { remote: true, ...(st || {}), position: this.position(st), deviceName: this.devices.find((d) => d.id === this.target)?.name };
    }
    return { remote: false, ...player.snapshot(), buffering: player.buffering };
  },

  // ----- Jam -----
  async jamCreate() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => A[b % A.length]).join('');
    await setDoc(doc(db, 'jams', code), {
      host: state.device.id,
      hostName: state.profile.name,
      everyoneControls: true,
      members: { [state.device.id]: `${state.profile.name} · ${state.device.name}` },
      queue: [],
      state: player.track ? player.snapshot() : null,
      createdAt: Date.now(),
    });
    this._subscribeJam(code);
  },

  async jamJoin(code) {
    code = String(code || '').toUpperCase().trim();
    if (!code) return;
    const snap = await getDoc(doc(db, 'jams', code)).catch(() => null);
    if (!snap?.exists() || snap.data().ended) return toast('Code de party introuvable');
    await updateDoc(doc(db, 'jams', code), { [`members.${state.device.id}`]: `${state.profile.name} · ${state.device.name}` });
    this._subscribeJam(code);
  },

  async jamLeave() {
    // Code de la party : celui de l'abonnement, sinon celui de la party affichée (reprise après redémarrage)
    const code = this._jamCode || this.jam?.code || ls.get('boombox.jam');
    if (!code) return this._setJam(null);
    const host = this.isJamHost() || this.jam?.host === state.device.id;
    this._unsubscribeJam();
    this._setJam(null);
    const ok = host
      ? await updateDoc(doc(db, 'jams', code), { ended: true }).then(() => true).catch(() => false)
      : await updateDoc(doc(db, 'jams', code), { [`members.${state.device.id}`]: deleteField() }).then(() => true).catch(() => false);
    toast(host ? (ok ? 'Party terminée' : 'Party terminée sur cet appareil (hors connexion : elle se fermera pour les autres au retour du réseau)') : 'Tu as quitté la party');
  },

  jamAdd(track) {
    if (!this._jamCode) return;
    const t = { id: track.id, title: track.title, artists: track.artists || [], album: track.album || null, duration: track.duration || 0, thumb: track.thumb || null };
    updateDoc(doc(db, 'jams', this._jamCode), { queue: arrayUnion({ ...t, qid: Math.random().toString(36).slice(2), addedBy: state.profile.name }) })
      .then(() => toast('Ajouté à la file de la party'))
      .catch((e) => toast(e.message));
  },

  // Retire un titre de la file de la Jam. Écriture directe (arrayRemove de l'élément exact) : une transaction
  // échouait quand l'hôte publiait son état en même temps, et le titre restait en tête de file (rejoué en boucle).
  jamRemove(qid, item = (this.jam?.queue || []).find((t) => t.qid === qid)) {
    this._jamPlayed.add(qid);
    const ref = doc(db, 'jams', this._jamCode);
    if (item) return updateDoc(ref, { queue: arrayRemove(item) }).catch(() => this._jamRemoveTx(ref, qid));
    this._jamRemoveTx(ref, qid);
  },
  _jamRemoveTx(ref, qid) {
    runTransaction(db, async (tx) => {
      const s = await tx.get(ref);
      if (s.exists()) tx.update(ref, { queue: (s.data().queue || []).filter((t) => t.qid !== qid) });
    }).catch(() => {});
  },
  _jamPlayed: new Set(), // titres de la Jam déjà lancés par l'hôte (jamais rejoués, même si Firebase est en retard)

  jamCommand(action, args = []) {
    if (this.isJamHost()) return player[action](...args);
    addDoc(collection(db, 'jams', this._jamCode, 'commands'), { action, args, from: state.device.id, at: Date.now() }).catch(() => {});
  },

  jamSettings(s) {
    updateDoc(doc(db, 'jams', this._jamCode), s).catch(() => {});
  },

  isJamHost() {
    return !!this.jam && this.jam.host === state.device.id;
  },

  setListenAlong(v) {
    this.listenAlong = v;
    if (!v) player.pause();
    else this._followJam();
    emit('jam', this.jam);
  },

  _subscribeJam(code, resuming = false) {
    this._unsubscribeJam();
    this._jamCode = code;
    ls.set('boombox.jam', code);
    this._jamUnsubs.push(
      onSnapshot(doc(db, 'jams', code), (s) => {
        if (!s.exists() || s.data().ended) {
          if (this.jam && !this.isJamHost()) toast("L'hôte a terminé la party");
          this._unsubscribeJam();
          this._setJam(null);
          return;
        }
        const d = s.data();
        if (resuming && !d.members?.[state.device.id]) {
          this._unsubscribeJam();
          return this._setJam(null);
        }
        this._setJam({ code, ...d, members: Object.entries(d.members || {}).map(([id, name]) => ({ id, name })) });
      }, () => this._setJam(null)),
      // Mode soirée hors Wi-Fi : recherches des invités faites par l'hôte
      onSnapshot(collection(db, 'jams', code, 'searches'), (snap) => {
        if (!this.isJamHost()) return;
        for (const ch of snap.docChanges()) {
          if (ch.type !== 'added' || ch.doc.data().results) continue;
          api(`/api/search?q=${encodeURIComponent(ch.doc.data().q)}&type=song`)
            .then((r) => updateDoc(ch.doc.ref, { results: r.items.slice(0, 6).map(({ type, ...t }) => ({ id: t.id, title: t.title, artists: t.artists || [], album: t.album || null, duration: t.duration || 0, thumb: t.thumb || null })) }))
            .catch(() => updateDoc(ch.doc.ref, { results: [] }).catch(() => {}));
        }
      }),
      // Mode soirée : liens / textes envoyés par les invités, transformés en titres par l'hôte
      onSnapshot(collection(db, 'jams', code, 'requests'), (snap) => {
        if (!this.isJamHost()) return;
        for (const ch of snap.docChanges()) {
          if (ch.type !== 'added' || ch.doc.data().status !== 'pending') continue;
          const r = ch.doc.data();
          api('/api/resolve', { method: 'POST', body: { input: r.input } })
            .then(async (t) => {
              await updateDoc(doc(db, 'jams', code), { queue: arrayUnion({ id: t.id, title: t.title, artists: t.artists || [], album: t.album || null, duration: t.duration || 0, thumb: t.thumb || null, qid: Math.random().toString(36).slice(2), addedBy: r.name || 'Invité' }) });
              await deleteDoc(ch.doc.ref);
            })
            .catch(() => updateDoc(ch.doc.ref, { status: 'notfound' }).catch(() => {}));
        }
      }),
      onSnapshot(collection(db, 'jams', code, 'commands'), (snap) => {
        if (!this.isJamHost()) return;
        for (const ch of snap.docChanges()) {
          if (ch.type !== 'added') continue;
          const c = ch.doc.data();
          deleteDoc(ch.doc.ref).catch(() => {});
          if (Date.now() - (c.at || 0) < 60e3 && this.jam?.everyoneControls && ['toggle', 'play', 'pause', 'next', 'prev'].includes(c.action)) player[c.action]();
        }
      }),
    );
  },

  _unsubscribeJam() {
    this._jamUnsubs.forEach((u) => u());
    this._jamUnsubs = [];
    this._jamCode = null;
    ls.set('boombox.jam', null);
  },

  _setJam(room) {
    const wasHost = this.isJamHost();
    const prevHead = this.jam?.queue?.[0]?.qid;
    this.jam = room;
    // Invité qui écoute en même temps : le lecteur laisse l'hôte choisir l'enchaînement
    player.jamFollow = () => !!this.jam && !this.isJamHost() && this.listenAlong;
    player.jamQueue = room ? (tracks) => tracks.forEach((t) => this.jamAdd(t)) : null;
    // Les titres déjà lancés n'apparaissent plus dans la file, même avant que Firebase confirme leur retrait
    if (room?.queue) room.queue = room.queue.filter((t) => !this._jamPlayed.has(t.qid));
    if (room && room.host === state.device.id) {
      player.jamNext = () => {
        const t = this.jam?.queue?.[0];
        if (!t) return null;
        this.jam.queue = this.jam.queue.slice(1);
        this.jamRemove(t.qid, t);
        emit('jam', this.jam);
        return { ...t };
      };
      player.jamPeek = () => this.jam?.queue?.[0] || null;
      if (!player.track && room.queue.length) player.next();
      // Nouveau titre en tête de la file de la Jam : l'automix / le préchargement se recalent dessus
      else if (room.queue[0]?.qid !== prevHead) emit('player:queue');
    } else {
      player.jamNext = null;
      player.jamPeek = null;
      if (wasHost && !room) toast('Party terminée');
    }
    if (!room) this.listenAlong = false;
    if (room && !this.isJamHost() && this.listenAlong) this._followJam();
    emit('jam', room);
  },

  _followJam() {
    const st = this.jam?.state;
    if (!st?.track) return;
    const pos = this.position(st);
    if (player.track?.id !== st.track.id) {
      player._load(st.track, { start: pos, autoplay: !st.paused });
      return;
    }
    if (st.paused && !player.paused) player.pause();
    if (!st.paused && player.paused) player.play();
    if (Math.abs(player.time() - pos) > 4) player.seek(pos);
  },

  _command({ action, args = [] }) {
    if (action === '__transfer') {
      const s = args[0];
      if (this.target) this.control(null);
      Object.assign(player, { list: s.list, order: s.order, pos: s.pos, userQueue: s.userQueue || [], context: s.context, shuffle: s.shuffle, repeat: s.repeat });
      const lag = !s.paused && s.sentAt ? Math.min(10, Math.max(0, (Date.now() - s.sentAt) / 1000)) : 0;
      player._load(s.track, { start: (s.position || 0) + lag, autoplay: !s.paused });
      emit('player:queue');
      this.publish(true); // l'appareil d'origine voit tout de suite que la lecture est ici
      toast('Lecture transférée sur cet appareil');
      // Lecture automatique bloquée (navigateur sans interaction récente) : un appui suffit
      if (!s.paused) setTimeout(() => player.paused && toast('Appuie sur lecture pour continuer ici', { action: 'Lecture', timeout: 10000, onAction: () => player.play() }), 2500);
      return;
    }
    if (typeof player[action] === 'function' && !action.startsWith('_')) player[action](...args);
  },
};

// Publie l'état à chaque changement (regroupé pour limiter les écritures).
let pubTimer = null;
const schedulePublish = () => {
  clearTimeout(pubTimer);
  pubTimer = setTimeout(() => sync.publish(), 800);
};
on('player:track', schedulePublish);
on('player:state', schedulePublish);
on('player:queue', schedulePublish);
// Détecte les sauts dans le titre (seek) : vérification toutes les 2 s, n'écrit que si nécessaire.
let lastTimeCheck = 0;
on('player:time', () => {
  if (Date.now() - lastTimeCheck < 2000) return;
  lastTimeCheck = Date.now();
  sync.publish();
});
