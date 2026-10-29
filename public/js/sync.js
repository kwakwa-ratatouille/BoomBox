// Synchronisation entre appareils via Firestore (fonctionne par Internet, sans serveur à faire tourner) :
// appareils connectés (contrôle à distance façon Spotify Connect) et Jam (écoute à plusieurs).
// La bibliothèque, elle, se synchronise toute seule (voir state.js).
import { state, emit, on, ls, api, setting } from './state.js';
import { player } from './player.js';
import { toast } from './ui.js';
import { isNative, localApi } from './native.js';
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
        for (const d of this._allDevices) {
          if (d.id === device.id || !d.state) continue;
          // Commande envoyée il y a peu : on garde l'état prévu tant que l'appareil n'a pas confirmé
          const p = this._pending;
          if (p?.target === d.id && Date.now() < p.until && Object.entries(p.patch).some(([k, v]) => (k === 'position' ? Math.abs(this.position(d.state) - v) > 2.5 : d.state[k] !== v))) continue;
          if (p?.target === d.id) this._pending = null;
          if (Date.now() - (this._lanFresh || 0) < 30e3 && this.remote[d.id]?.track?.id === d.state.track?.id && this.remote[d.id]?.paused === d.state.paused) continue;
          // Nouvel état qui vient d'arriver par Internet (daté de moins de 10 s par l'autre appareil) : daté avec notre
          // horloge, moins le trajet habituel (~0,3 s) ; les horloges des appareils ont souvent 1 s d'écart
          if (d.state.ts && d.state.ts === this._lastTs[d.id] && this.remote[d.id]) continue; // même état qu'avant : on garde sa date
          this._lastTs[d.id] = d.state.ts;
          this.remote[d.id] = this._local(d.id, d.state, 300);
        }
        this._refreshDevices();
        if (this.target) this._remoteEmit();
      }),
      // Commandes reçues d'un autre appareil (télécommande)
      onSnapshot(collection(db, 'spaces', cloud.spaceId, 'devices', device.id, 'commands'), (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type !== 'added') continue;
          const c = ch.doc.data();
          deleteDoc(ch.doc.ref).catch(() => {});
          if (c.cid && this._seenCmd.has(c.cid)) continue; // déjà reçue par le canal direct
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
      if (document.visibilityState === 'visible') {
        updateDoc(this.devRef(), { lastSeen: Date.now(), online: true }).catch(() => {});
        this._refreshDevices(); // retour sur l'appli : un appareil éteint entre-temps n'est plus affiché ni piloté
      }
    });

    this._lanStart();
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
      if (!this._auto) toast("L'appareil piloté s'est déconnecté");
      this.control(null, { auto: true });
    }
    this._autoFollow();
    emit('sync');
  },

  // Appareils liés (comme Spotify, réglage « Suivre mes autres appareils », activé par défaut) : un appareil qui ne
  // joue rien affiche en direct le son qui passe sur un autre (titre, avancée, pause) sans le jouer lui-même.
  // Pause / suivant / précédent pilotent l'autre appareil ; lancer un son ici reprend la main (voir _autoRoute).
  _autoFollow() {
    if (!setting('followDevices', true) || this.target || this.jam || Date.now() < (this._noAutoUntil || 0)) return;
    if (player.track && !player.paused) return;
    const now = Date.now();
    // Seulement un appareil vraiment allumé : signal de vie de moins d'1 min et état de lecture récent (avant : un PC
    // éteint pendant qu'il jouait restait « en lecture » et le téléphone s'y rattachait au réveil)
    const seen = (id) => this._allDevices.find((x) => x.id === id)?.lastSeen || 0;
    const other = this.devices.find((d) => d.id !== state.device.id && d.playing && now - seen(d.id) < 60e3 && now - (this.remote[d.id]?.ts || 0) < 2 * 60e3);
    if (other) this.control(other.id, { auto: true });
  },
  // Suivi automatique : lancer un son ou une liste ici, c'est le jouer ici (l'autre appareil se met en pause)
  _autoRoute(action) {
    if (!this._auto || !this.target || !['playList', 'playTrack', 'playRadio', 'jumpTo'].includes(action)) return false;
    this.sendCommand(this.target, 'fadeOutPause');
    this.control(null);
    return true;
  },

  sendCommand(target, action, args = []) {
    this._optimistic(target, action, args);
    const c = { cid: Math.random().toString(36).slice(2), action, args: JSON.parse(JSON.stringify(args)), from: state.device.id, at: Date.now() };
    this._lanSend([target], { type: 'cmd', ...c }); // direct par le PC (instantané)…
    addDoc(collection(db, 'spaces', cloud.spaceId, 'devices', target, 'commands'), c).catch((e) => toast(e.message)); // … et par Internet en secours
  },

  // ----- Canal direct par le PC (même Wi-Fi) -----
  // Le PC Boombox relaie commandes et états entre appareils en quelques dizaines de ms (server/index.js, /api/rc).
  // PC : son propre serveur ; téléphone : le PC trouvé par relay.js. Firebase reste le chemin de secours.
  _seenCmd: new Set(),
  _lastTs: {},
  // Écart d'horloge avec chaque appareil (ms) : le plus petit « heure de réception − heure de l'état » vu depuis
  // 10 min, moins le trajet habituel. L'état est re-daté avec notre horloge : la position avance juste, même si
  // le téléphone a 1 s (ou 1 min) d'avance ou de retard sur le PC.
  _skew: {},
  // Nouvel état de l'appareil piloté : on ne redessine tout (« player:track ») que si le son a changé. Sinon simple
  // mise à jour (pause, position) : avant, chaque état reçu redessinait le panneau Paroles, qui repartait en haut
  // au lieu de suivre la ligne en cours.
  _remoteEmit() {
    const st = this.remote[this.target];
    const id = st?.track?.id || null;
    if (id !== this._shownRemote) {
      this._shownRemote = id;
      emit('player:track');
      emit('player:queue');
    }
    emit('player:state');
    emit('player:time');
  },
  _local(id, st, trip) {
    if (!st?.ts) return st;
    const now = Date.now();
    const o = now - st.ts - trip;
    const k = this._skew[id];
    // Nouvel échantillon plus petit (meilleur), ou ancien trop vieux : on le prend
    if (!k || o < k.o || now - k.at > 10 * 60e3) this._skew[id] = { o, at: now };
    return { ...st, ts: st.ts + this._skew[id].o };
  },
  async _lanBase(p) {
    if (!isNative) return /^(localhost|127.0.0.1)$/.test(location.hostname) ? p : null;
    return (await localApi()).media.relayHref?.(p) || null;
  },
  async _lanStart() {
    const url = await this._lanBase(`/api/rc/stream?dev=${encodeURIComponent(state.device.id)}`);
    if (url && url !== this._lanUrl) {
      this._lan?.close();
      this._lanUrl = url;
      this._lan = new EventSource(url);
      this._lan.onmessage = (e) => {
        let m = null;
        try {
          m = JSON.parse(e.data);
        } catch {}
        if (m?.type === 'cmd' && m.cid && !this._seenCmd.has(m.cid)) {
          this._seenCmd.add(m.cid);
          if (this._seenCmd.size > 200) this._seenCmd = new Set([...this._seenCmd].slice(-100));
          if (Date.now() - (m.at || 0) < 60e3) this._command(m);
        } else if (m?.type === 'state' && m.from && m.state && m.from !== state.device.id) {
          const p = this._pending;
          if (p?.target === m.from && Date.now() < p.until && Object.entries(p.patch).some(([k, v]) => (k === 'position' ? Math.abs(this.position(m.state) - v) > 2.5 : m.state[k] !== v))) return;
          if (p?.target === m.from) this._pending = null;
          // Reçu à l'instant (quelques dizaines de ms) : on date l'état avec NOTRE horloge, pas celle de l'autre appareil
          // (deux horloges décalées d'1 s mettaient la barre et les paroles en retard d'autant)
          this.remote[m.from] = this._local(m.from, m.state, 40);
          this._lanFresh = Date.now();
          if (this.target === m.from) this._remoteEmit();
        }
      };
      this._lan.onerror = () => {}; // EventSource se reconnecte tout seul
    }
    // Téléphone : le PC peut changer (Wi-Fi, tunnel) : on revérifie régulièrement
    clearTimeout(this._lanTimer);
    if (isNative) this._lanTimer = setTimeout(() => this._lanStart(), 30e3);
  },
  async _lanSend(to, msg) {
    if (!to.length) return;
    const url = await this._lanBase('/api/rc/send');
    if (!url) return;
    fetch(url, { method: 'POST', body: JSON.stringify({ to, msg }) }).catch(() => {});
  },

  // Publie l'état de lecture de cet appareil (pour les autres appareils et la Jam).
  publish(force = false) {
    if (!this.connected || !player.track) return;
    const snap = player.snapshot();
    // N'écrit que si quelque chose a réellement changé (limite les écritures Firestore)
    const sig = [snap.track.id, snap.paused, snap.shuffle, snap.repeat, snap.volume, snap.muted, snap.context?.id, (snap.upcoming || []).map((t) => t?.id).join()].join('|');
    const last = this._last;
    const expected = last ? (last.paused ? last.position : last.position + (Date.now() - last.ts) / 1000) : 0;
    if (!force && last && sig === this._lastSig && Math.abs(expected - snap.position) < 3) return;
    this._lastSig = sig;
    this._last = snap;
    updateDoc(this.devRef(), { state: snap, lastSeen: Date.now(), online: true }).catch(() => {});
    this._lanSend(this.devices.filter((d) => d.id !== state.device.id).map((d) => d.id), { type: 'state', from: state.device.id, state: snap });
    if (this.isJamHost()) updateDoc(doc(db, 'jams', this._jamCode), { state: snap }).catch(() => {});
  },

  // Télécommande : l'écran change tout de suite (pause, lecture, position), sans attendre que l'autre appareil
  // confirme ; ses états encore anciens qui arrivent entre-temps sont ignorés 4 s (avant, la pause « sautait » :
  // l'écran repassait en lecture un instant, et le déplacement dans le son arrivait avec du retard)
  _optimistic(target, action, args) {
    const st = this.remote[target];
    if (!st) return;
    const pos = this.position(st);
    const set = (patch) => {
      this.remote[target] = { ...st, ...patch, ts: Date.now() };
      this._pending = { target, patch, until: Date.now() + 4000 };
      emit('player:state');
      emit('player:time');
    };
    if (action === 'pause' || action === 'fadeOutPause' || (action === 'toggle' && !st.paused)) set({ paused: true, position: pos });
    else if (action === 'play' || action === 'toggle') set({ paused: false, position: pos });
    else if (action === 'seek') set({ position: Math.max(0, Number(args[0]) || 0) });
  },

  // ----- Contrôle d'un autre appareil -----
  control(deviceId, { auto = false, keepPlaying = false } = {}) {
    // Suivi automatique quitté à la main (choix de cet appareil, son lancé ici) : pas de nouveau suivi avant 20 min
    if (this._auto && !auto) this._noAutoUntil = Date.now() + 20 * 60e3;
    this._auto = auto && !!deviceId;
    if (!deviceId || deviceId === state.device.id) {
      this.target = null;
      player.remoteSender = null;
    } else {
      this.target = deviceId;
      player.remoteSender = (action, args) => (this._autoRoute(action) ? player[action](...args) : this.sendCommand(deviceId, action, args));
      if (!player.paused && !keepPlaying) player.pause();
    }
    this._shownRemote = undefined; // appareil (ou retour ici) : tout est redessiné
    emit('sync');
    emit('player:track');
    emit('player:state');
  },

  // Transfère la lecture vers un autre appareil (ou la récupère ici).
  transfer(deviceId) {
    if (deviceId === state.device.id) {
      // Comme Spotify : l'appareil piloté, sinon celui qui joue en ce moment (le son s'y arrête et reprend ici,
      // au même moment). Avant, sans appareil piloté, choisir cet appareil ne faisait rien.
      const from = this.target || this.devices.find((d) => d.id !== state.device.id && d.playing)?.id;
      const st = from && this.remote[from];
      if (from) this.sendCommand(from, 'fadeOutPause'); // l'autre appareil s'éteint en fondu…
      // L'autre appareil joue encore 3 s plus tard (commande perdue, appli en arrière-plan) : on lui redemande d'arrêter
      if (from) setTimeout(() => this.remote[from] && !this.remote[from].paused && this.sendCommand(from, 'pause'), 3500);
      this.control(null);
      if (st?.track) {
        player.list = [st.track, ...(st.upcoming || [])];
        player.order = player.list.map((_, i) => i);
        player.pos = 0;
        player.userQueue = [];
        player.context = st.context;
        // Lecteur de cet appareil remis à neuf : il était resté arrêté (et parfois à volume nul) pendant qu'il pilotait
        // l'autre appareil, et le son ne repartait pas sans recharger la page
        const e = player.engine;
        e?.stop?.();
        e?._setLevel?.(e.a, 1);
        player._userPauseAt = 0;
        if (!st.paused) player.paused = false;
        const pos = this.position(st);
        player._load(st.track, { start: pos, autoplay: !st.paused });
        if (!st.paused) {
          player.fadeIn(); // … pendant que celui-ci monte
          // Toujours rien au bout de 4 s : nouveau chargement du son (lien neuf), au même endroit
          const id = st.track.id;
          setTimeout(() => {
            if (player.track?.id !== id || this.target) return;
            const el = player.engine?.a;
            if (player.engine?.name === 'audio' && el && (el.paused || el.readyState < 2)) {
              player.engine._setLevel?.(el, 1);
              player.engine.load(id, pos + 4, true, true);
            }
          }, 4000);
        }
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
    // Cet appareil s'éteint en fondu pendant que l'autre démarre (au lieu d'une pause sèche)
    if (player.track && !player.paused) player.fadeOutPause();
    this.control(deviceId, { keepPlaying: true });
  },

  // Où en est le son de l'autre appareil. Jamais au-delà de la fin du son ni dans le passé : avec un état ancien ou
  // une horloge décalée, la position filait trop loin (paroles toutes « passées », barre au bout)
  position(st) {
    if (!st) return 0;
    const p = st.paused ? st.position : st.position + Math.max(0, Date.now() - st.ts) / 1000 * (st.rate || 1);
    return Math.max(0, st.duration ? Math.min(p, st.duration) : p);
  },

  view() {
    if (this.target) {
      const st = this.remote[this.target];
      return { remote: true, ...(st || {}), position: this.position(st), deviceName: this.devices.find((d) => d.id === this.target)?.name };
    }
    return { remote: false, ...player.snapshot(), buffering: player.buffering };
  },

  // ----- Jam -----
  async jamCreate(mode = 'soiree') {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => A[b % A.length]).join('');
    await setDoc(doc(db, 'jams', code), {
      host: state.device.id,
      mode: mode === 'together' ? 'together' : 'soiree',
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
    // « Écouter ensemble » : on entend la musique de l'hôte sur son appareil, synchronisée ;
    // « Soirée » : la musique sort chez l'hôte, on propose juste des sons
    const together = snap.data().mode === 'together';
    this.listenAlong = together;
    this._subscribeJam(code);
    toast(together ? 'Tu écoutes en même temps que les autres, sur cet appareil' : 'Party rejointe : ajoute tes sons, la musique sort chez l’hôte', { timeout: 6000 });
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

  // L'hôte change de mode en cours de party
  jamSetMode(mode) {
    if (!this._jamCode || !this.isJamHost()) return;
    updateDoc(doc(db, 'jams', this._jamCode), { mode }).catch(() => {});
  },

  // front : en tête de file (« Lire ensuite »), sinon à la fin
  jamAdd(track, { front = false } = {}) {
    if (!this._jamCode) return Promise.resolve();
    const t = { id: track.id, title: track.title, artists: track.artists || [], album: track.album || null, duration: track.duration || 0, thumb: track.thumb || null, qid: Math.random().toString(36).slice(2), addedBy: state.profile.name };
    const ref = doc(db, 'jams', this._jamCode);
    // Affiché tout de suite chez soi, sans attendre Firebase
    if (this.jam) {
      this.jam.queue = front ? [t, ...(this.jam.queue || [])] : [...(this.jam.queue || []), t];
      emit('jam', this.jam);
    }
    const write = front
      ? runTransaction(db, async (tx) => {
        const s = await tx.get(ref);
        if (s.exists()) tx.update(ref, { queue: [t, ...(s.data().queue || [])] });
      })
      : updateDoc(ref, { queue: arrayUnion(t) });
    return write.then(() => toast(front ? 'Sera joué ensuite dans la party' : 'Ajouté à la file de la party')).catch((e) => toast(e.message));
  },

  // Commandes de lecture en party (voir player.jamRoute) : true = prises en charge ici
  _jamRoute(action, args) {
    if (!this.jam) return false;
    const host = this.isJamHost();
    // Lancer un son directement : il passe tout de suite, pour tout le monde
    if (action === 'playTrack' || action === 'playList') {
      if (host) return false; // l'hôte joue chez lui, et tout le monde suit
      const t = action === 'playList' ? args[0]?.[args[1] || 0] : args[0];
      if (!t?.id) return true;
      if (!this.jam.everyoneControls) return this.jamAdd(t), true; // l'hôte a réservé les commandes : ça va dans la file
      this.jamCommand('playNow', [{ id: t.id, title: t.title, artists: t.artists || [], album: t.album || null, duration: t.duration || 0, thumb: t.thumb || null }]);
      toast(`« ${t.title} » lancé pour toute la party`);
      return true;
    }
    if (host || !['toggle', 'play', 'pause', 'next', 'prev', 'seek'].includes(action)) return false;
    if (!this.jam.everyoneControls) {
      if (this.listenAlong && ['toggle', 'play', 'pause'].includes(action)) return false; // couper le son chez soi seulement
      toast('L’hôte a réservé les commandes de la party');
      return true;
    }
    this.jamCommand(action, args);
    // Réaction immédiate chez soi (écoute ensemble), sans attendre l'aller-retour par l'hôte
    if (this.listenAlong && ['toggle', 'play', 'pause', 'seek'].includes(action)) {
      this._jamCmdAt = Date.now();
      player[action](...args);
    }
    return true;
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
        const lastActive = Math.max(d.createdAt || 0, d.state?.at || 0, d.updatedAt || 0);
        if (resuming && (!d.members?.[state.device.id] || Date.now() - lastActive > 6 * 3600e3)) {
          if (d.host === state.device.id) updateDoc(doc(db, 'jams', code), { ended: true }).catch(() => {});

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
          if (Date.now() - (c.at || 0) > 60e3 || !this.jam?.everyoneControls) continue;
          if (['toggle', 'play', 'pause', 'next', 'prev', 'seek'].includes(c.action)) player[c.action](...(c.args || []));
          else if (c.action === 'playNow' && c.args?.[0]?.id) player.playTrack(c.args[0], { type: 'jam', name: 'Party' });
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
    // L'hôte a changé de mode : les invités suivent (écouter ensemble = son sur chaque appareil)
    if (room && this.jam && room.mode !== this.jam.mode && !this.isJamHost()) this.listenAlong = room.mode === 'together';
    this.jam = room;
    // Invité qui écoute en même temps : le lecteur laisse l'hôte choisir l'enchaînement
    player.jamFollow = () => !!this.jam && !this.isJamHost() && this.listenAlong;
    player.jamQueue = room ? (tracks, front = false) => (front ? [...tracks].reverse() : tracks).forEach((t) => this.jamAdd(t, { front })) : null;
    player.jamRoute = room ? (a, args) => this._jamRoute(a, args) : null;
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
    // Commande envoyée il y a peu : l'état de l'hôte peut être encore l'ancien, on ne revient pas en arrière
    if (Date.now() - (this._jamCmdAt || 0) < 3000) return;
    if (st.paused && !player.paused) player.pause();
    if (!st.paused && player.paused) player.play();
    if (Math.abs(player.time() - pos) > 2.5) player.seek(pos); // resynchronise dès 2,5 s d'écart
  },

  _command({ action, args = [] }) {
    if (action === '__transfer') {
      const s = args[0];
      if (this.target) this.control(null);
      // Lecteur remis à neuf (il pouvait être resté arrêté ou à volume nul en pilotant l'autre appareil)
      player.engine?.stop?.();
      player.engine?._setLevel?.(player.engine.a, 1);
      player._userPauseAt = 0;
      if (!s.paused) player.paused = false;
      Object.assign(player, { list: s.list, order: s.order, pos: s.pos, userQueue: s.userQueue || [], context: s.context, shuffle: s.shuffle, repeat: s.repeat });
      const lag = !s.paused && s.sentAt ? Math.min(10, Math.max(0, (Date.now() - s.sentAt) / 1000)) : 0;
      player._load(s.track, { start: (s.position || 0) + lag, autoplay: !s.paused });
      if (!s.paused) player.fadeIn(); // monte en fondu pendant que l'appareil d'origine s'éteint
      emit('player:queue');
      this.publish(true); // l'appareil d'origine voit tout de suite que la lecture est ici
      toast('Lecture transférée sur cet appareil');
      // Lecture automatique bloquée (navigateur sans interaction récente) : un appui suffit
      if (!s.paused) setTimeout(() => player.paused && toast('Appuie sur lecture pour continuer ici', { action: 'Lecture', timeout: 10000, onAction: () => player.play() }), 2500);
      return;
    }
    if (typeof player[action] === 'function' && !action.startsWith('_')) player[action](...args);
    // L'appareil qui pilote voit le résultat tout de suite (sans attendre la publication regroupée)
    setTimeout(() => this.publish(true), 150);
  },
};

// Publie l'état à chaque changement (regroupé pour limiter les écritures).
let pubTimer = null;
const schedulePublish = () => {
  // Par le PC (même Wi-Fi) : tout de suite ; Firebase : regroupé
  if (sync.connected && player.track && !player.remoteSender) sync._lanSend(sync.devices.filter((d) => d.id !== state.device.id).map((d) => d.id), { type: 'state', from: state.device.id, state: player.snapshot() });
  clearTimeout(pubTimer);
  pubTimer = setTimeout(() => sync.publish(), sync.isJamHost() ? 120 : 800); // party : les autres suivent vite
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
