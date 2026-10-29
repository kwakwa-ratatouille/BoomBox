// Réveil en musique : à l'heure choisie, les jours choisis (tableau de la semaine), un son précis démarre au passage
// choisi, ou une playlist (ou tes titres likés) en aléatoire. Le volume monte doucement pendant 1 minute.
// Sur téléphone, une notification programmée sonne aussi pour chaque jour choisi (même appli fermée) : la toucher
// ouvre Boombox et lance la musique.
import { state, setting, saveSettings, api, bus } from './state.js';
import { player, ctl, startAt } from './player.js';
import { toast, modal, html, esc, icon, fmtTime } from './ui.js';
import { cover } from './components.js';

const LN = () => window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.LocalNotifications;
const OLD_ID = 770077; // ancienne notification unique (tous les jours)
const dayId = (d) => 770070 + d; // une notification par jour (1 = lundi … 7 = dimanche)

// Jours : 1 = lundi … 7 = dimanche (comme en France)
export const DAYS = [[1, 'L', 'Lundi'], [2, 'M', 'Mardi'], [3, 'M', 'Mercredi'], [4, 'J', 'Jeudi'], [5, 'V', 'Vendredi'], [6, 'S', 'Samedi'], [7, 'D', 'Dimanche']];
const ALL = [1, 2, 3, 4, 5, 6, 7];
const WEEK = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const isoDay = (date) => date.getDay() || 7;

// fade : secondes de montée du volume (0 = d'un coup) ; volume : volume final (0,3 à 1)
export const alarmConf = () => ({ on: false, time: '07:30', days: ALL, source: 'liked', track: null, start: 0, fade: 15, volume: 0.8, ...(setting('alarm', null) || {}) });
const FADES = [[0, 'Direct'], [5, '5 s'], [15, '15 s'], [30, '30 s'], [60, '1 min']];

function tracksOf(source) {
  if (source === 'liked') return state.library.liked || [];
  return state.library.playlists.find((p) => p.id === source)?.tracks || state.library.liked || [];
}

// « Tous les jours », « En semaine », « Le week-end » ou la liste des jours
export function daysLabel(days) {
  const s = [...new Set(days)].sort().join();
  if (s === ALL.join()) return 'tous les jours';
  if (s === WEEK.join()) return 'en semaine';
  if (s === WEEKEND.join()) return 'le week-end';
  if (!days.length) return 'aucun jour';
  return DAYS.filter(([d]) => days.includes(d)).map(([, , n]) => n.toLowerCase()).join(', ');
}

// Prochain réveil (date), ou null s'il n'y a aucun jour
export function nextRing(a = alarmConf()) {
  if (!a.days?.length) return null;
  const [h, m] = a.time.split(':').map(Number);
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m);
    if (d > now && a.days.includes(isoDay(d))) return d;
  }
  return null;
}
export function nextLabel(a = alarmConf()) {
  const d = nextRing(a);
  if (!d) return 'Choisis au moins un jour';
  const today = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400e3);
  const when = diff === 0 ? 'aujourd’hui' : diff === 1 ? 'demain' : d.toLocaleDateString('fr-FR', { weekday: 'long' });
  const mins = Math.round((d - today) / 60e3);
  const left = mins < 60 ? `dans ${mins} min` : `dans ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}`;
  return `Prochain réveil ${when} à ${a.time.replace(':', ' h ')} (${left})`;
}

// Lance un son précis à partir d'un passage (attend qu'il joue vraiment pour se placer)
function playFrom(track, start) {
  ctl.playList([track], 0, { type: 'alarm', name: 'Réveil' });
  if (!start) return;
  const t0 = Date.now();
  const onState = () => {
    if (player.track?.id !== track.id || Date.now() - t0 > 30e3) return bus.removeEventListener('player:state', onState);
    if (player.paused) return;
    bus.removeEventListener('player:state', onState);
    ctl.seek(start);
  };
  bus.addEventListener('player:state', onState);
}

// Lance le réveil : volume de 10 % jusqu'au volume habituel en 60 s
export async function ring() {
  // Le réveil sonne toujours sur cet appareil, jamais sur un autre qu'on pilotait (ex. le PC, éteint la nuit)
  const { sync } = await import('./sync.js');
  if (sync.target) sync.control(null, { auto: true });
  stopKeepAlive?.(); // le son muet du soir laisse la place
  const a = alarmConf();
  // Volume qui monte doucement pendant 1 min, à partir du moment où le son joue vraiment (avant : si le son mettait
  // plus de 6 s à arriver, la montée s'arrêtait et le réveil restait bloqué à 10 % : quasi muet).
  // iPhone : iOS ne laisse pas une appli régler son volume, et ses minuteries ralentissent en arrière-plan : pas de
  // montée, le réveil sonne au volume du téléphone.
  const ramp = !(window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform?.() === 'ios');
  const target = Math.min(1, Math.max(0.3, a.volume ?? 0.8));
  const fadeMs = (a.fade ?? 15) * 1000;
  if (ramp) ctl.setVolume(fadeMs ? 0.1 : target);
  else if ((player.volume || 0) < 0.5) ctl.setVolume(target);
  if (a.source === 'track' && a.track?.id) {
    playFrom(a.track, a.start || 0);
  } else {
    const tracks = tracksOf(a.source);
    if (!tracks.length) return toast('Réveil : la playlist choisie est vide');
    if (!player.shuffle) ctl.toggleShuffle();
    ctl.playList(tracks, startAt(tracks), { type: 'alarm', name: 'Réveil' });
  }
  if (ramp && fadeMs) {
    const asked = player._userPauseAt || 0;
    let t0 = 0;
    const iv = setInterval(() => {
      if ((player._userPauseAt || 0) !== asked) return clearInterval(iv); // tu as mis pause : on n'y touche plus
      if (player.paused || player.buffering) return; // le son n'est pas encore là : la montée attend
      t0 ||= Date.now();
      const k = Math.min(1, (Date.now() - t0) / fadeMs);
      ctl.setVolume(0.1 + (target - 0.1) * k);
      if (k >= 1) clearInterval(iv);
    }, 250);
    setTimeout(() => (clearInterval(iv), player.volume < target && ctl.setVolume(target)), fadeMs + 4 * 60e3); // au pire, volume normal après 5 min
  }
  toast('⏰ Bonjour ! Ton réveil Boombox', { timeout: 8000 });
}

// Notifications programmées (téléphone) : une par jour choisi, chaque semaine
export async function scheduleAlarm() {
  const P = LN();
  if (!P) return;
  await P.cancel({ notifications: [{ id: OLD_ID }, ...ALL.map((d) => ({ id: dayId(d) }))] }).catch(() => {});
  const a = alarmConf();
  if (!a.on || !a.days?.length) return;
  const [hour, minute] = a.time.split(':').map(Number);
  await P.requestPermissions?.().catch(() => {});
  const body = a.source === 'track' && a.track ? `Touche pour lancer « ${a.track.title} »` : 'Touche pour lancer ta musique';
  // Capacitor : weekday 1 = dimanche … 7 = samedi
  await P.schedule({
    notifications: a.days.map((d) => ({ id: dayId(d), title: '⏰ Réveil Boombox', body, schedule: { on: { weekday: (d % 7) + 1, hour, minute }, repeats: true, allowWhileIdle: true }, extra: { alarm: true } })),
  }).catch(() => {});
}

export async function saveAlarm(patch) {
  await saveSettings({ alarm: { ...alarmConf(), ...patch } });
  await scheduleAlarm();
}

// Vérification à l'heure dite quand l'appli est ouverte (PC laissé allumé, téléphone au premier plan)
export function startAlarm() {
  const fired = () => localStorage.getItem('boombox.alarmFired');
  setInterval(() => {
    const a = alarmConf();
    const now = new Date();
    if (!a.on || !a.days?.includes(isoDay(now))) return;
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const key = `${now.toISOString().slice(0, 10)} ${a.time}`;
    if (hm === a.time && fired() !== key) {
      localStorage.setItem('boombox.alarmFired', key);
      ring();
    }
  }, 15e3);
  // Notification de réveil touchée : on lance la musique
  LN()?.addListener?.('localNotificationActionPerformed', (e) => {
    if (!e?.notification?.extra?.alarm) return;
    localStorage.setItem('boombox.alarmFired', `${new Date().toISOString().slice(0, 10)} ${alarmConf().time}`);
    setTimeout(ring, 800);
  });
  scheduleAlarm();
  keepAwakeForAlarm();
}

// iPhone : iOS endort une appli qui ne joue plus rien, donc le réveil ne pouvait que sonner une notification. Tant
// qu'un réveil est prévu dans les 16 h et que Boombox est en arrière-plan sans musique, un son muet tourne en boucle
// (sans couper la musique des autres applis) : Boombox reste éveillé et lance la musique tout seul à l'heure.
// Il faut juste laisser Boombox ouvert en arrière-plan (pas fermé en le balayant vers le haut).
let stopKeepAlive = null;
function keepAwakeForAlarm() {
  const ios = window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform?.() === 'ios';
  if (!ios) return;
  let el = null;
  const silence = () => {
    // 1 s de silence (WAV 8 kHz, 8 bits)
    const n = 8000;
    const b = new Uint8Array(44 + n);
    const v = new DataView(b.buffer);
    const w = (o, s) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    b.fill(128, 44);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  };
  const stop = () => {
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el = null;
  };
  stopKeepAlive = stop;
  const check = () => {
    const a = alarmConf();
    const next = a.on ? nextRing(a) : null;
    const want = document.hidden && player.paused && next && next - Date.now() < 16 * 3600e3 && next > Date.now();
    if (!want) return stop();
    if (el) return;
    window.Capacitor?.Plugins?.BoomboxNative?.setAudioMode?.({ mix: true })?.catch?.(() => {}); // ne coupe pas les autres applis
    el = new Audio(silence());
    el.loop = true;
    el.play().catch(() => (el = null));
  };
  document.addEventListener('visibilitychange', () => setTimeout(check, 500));
  bus.addEventListener('player:state', () => setTimeout(check, 500));
}

// ---------- Fenêtre « Réveil » ----------
// Heure, tableau de la semaine (avec raccourcis), musique (un son précis et son passage, ou une playlist en aléatoire)
export async function openAlarmEditor() {
  const a = alarmConf();
  let days = [...a.days];
  let source = a.source;
  let track = a.track;
  let start = a.start || 0;
  let fade = a.fade ?? 15;
  const ios = window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform?.() === 'ios';
  const playlists = [['liked', 'Titres likés'], ...state.library.playlists.map((p) => [p.id, p.name])];
  const res = await modal({
    title: '⏰ Réveil',
    wide: true,
    body: String(html`<div class="al-ed">
      <div class="al-top"><input type="time" class="al-time" id="al-time" value="${a.time}" required><label class="switch al-on"><input type="checkbox" id="al-on" ${a.on || !setting('alarm', null) ? 'checked' : ''}><span></span></label></div>
      <p class="muted al-next" id="al-next"></p>
      <h3>Jours</h3>
      <div class="al-week" id="al-week">${DAYS.map(([d, l, n]) => html`<button type="button" class="al-day" data-d="${d}" title="${n}" aria-label="${n}">${l}</button>`)}</div>
      <div class="al-presets"><button type="button" class="chip" data-p="all">Tous les jours</button><button type="button" class="chip" data-p="week">En semaine</button><button type="button" class="chip" data-p="weekend">Le week-end</button></div>
      <h3>Musique</h3>
      <div class="al-src"><button type="button" class="chip" data-s="track">Un son précis</button><button type="button" class="chip" data-s="list">Une playlist en aléatoire</button></div>
      <div id="al-list" class="hidden"><select class="input" id="al-pl">${playlists.map(([v, n]) => html`<option value="${v}">${n}</option>`)}</select></div>
      <div id="al-track" class="hidden">
        <div id="al-chosen"></div>
        <div class="al-search"><input class="input" id="al-q" placeholder="Rechercher un son…" autocomplete="off"><div id="al-res"></div></div>
        <div id="al-cut" class="hidden">
          <h3>Passage</h3>
          <p class="muted" style="margin:0 0 8px">Le son démarrera à <b id="al-start-l"></b></p>
          <input type="range" id="al-start" min="0" step="1" style="width:100%">
          <div class="row-flex" style="justify-content:space-between;margin-top:6px"><span class="muted" id="al-zero">0:00</span><button type="button" class="btn ghost sm" id="al-preview">${icon('play', 16)} Écouter le passage</button><span class="muted" id="al-dur"></span></div>
        </div>
      </div>
      <h3>Réveil en douceur</h3>
      ${ios ? html`<p class="muted" style="margin:0">Sur iPhone, le réveil sonne au volume du téléphone : iOS ne laisse pas une appli régler son volume.</p>` : html`
      <p class="muted" style="margin:0 0 8px">Le volume monte en</p>
      <div class="al-src" id="al-fade">${FADES.map(([v, l]) => html`<button type="button" class="chip" data-f="${v}">${l}</button>`)}</div>
      <p class="muted" style="margin:12px 0 6px">jusqu'à <b id="al-vol-l"></b></p>
      <input type="range" id="al-vol" min="30" max="100" step="5" value="${Math.round((a.volume ?? 0.8) * 100)}" style="width:100%">`}
    </div>`),
    actions: [{ label: 'Annuler' }, { label: 'Enregistrer', primary: true, value: (w) => {
      const time = w.querySelector('#al-time').value || '07:30';
      if (!days.length) return (toast('Choisis au moins un jour'), false);
      if (source === 'track' && !track) return (toast('Choisis un son (ou une playlist)'), false);
      return { on: w.querySelector('#al-on').checked, time, days: [...days].sort(), source: source === 'track' ? 'track' : w.querySelector('#al-pl').value, track: source === 'track' ? track : null, start: source === 'track' ? start : 0, fade, volume: w.querySelector('#al-vol') ? +w.querySelector('#al-vol').value / 100 : a.volume ?? 0.8 };
    } }],
    onMount: (w) => {
      const $ = (s) => w.querySelector(s);
      const conf = () => ({ ...alarmConf(), time: $('#al-time').value || '07:30', days });
      const paintNext = () => ($('#al-next').textContent = $('#al-on').checked ? nextLabel(conf()) : 'Réveil désactivé');
      const paintDays = () => {
        w.querySelectorAll('.al-day').forEach((b) => b.classList.toggle('on', days.includes(+b.dataset.d)));
        const s = [...days].sort().join();
        w.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('active', s === { all: ALL, week: WEEK, weekend: WEEKEND }[b.dataset.p].join()));
        paintNext();
      };
      w.querySelectorAll('.al-day').forEach((b) => (b.onclick = () => {
        const d = +b.dataset.d;
        days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
        paintDays();
      }));
      w.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => ((days = [...{ all: ALL, week: WEEK, weekend: WEEKEND }[b.dataset.p]]), paintDays())));
      $('#al-time').oninput = paintNext;
      // Montée du volume et volume final
      const paintFade = () => w.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', +b.dataset.f === fade));
      w.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => ((fade = +b.dataset.f), paintFade())));
      const vol = $('#al-vol');
      if (vol) (vol.oninput = () => ($('#al-vol-l').textContent = `${vol.value} %`))();
      paintFade();
      $('#al-on').onchange = paintNext;
      // Musique
      const isTrack = () => source === 'track';
      const paintSrc = () => {
        w.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('active', (b.dataset.s === 'track') === isTrack()));
        $('#al-list').classList.toggle('hidden', isTrack());
        $('#al-track').classList.toggle('hidden', !isTrack());
      };
      w.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => {
        source = b.dataset.s === 'track' ? 'track' : $('#al-pl').value;
        paintSrc();
      }));
      if (source !== 'track') $('#al-pl').value = playlists.some(([v]) => v === source) ? source : 'liked';
      const paintCut = () => {
        $('#al-start-l').textContent = fmtTime(start);
        $('#al-start').value = start;
      };
      const paintTrack = () => {
        $('#al-chosen').innerHTML = track ? String(html`<div class="al-pick">${cover(track, '', 96)}<div class="t-text"><b class="ellipsis">${track.title}</b><span class="muted ellipsis">${(track.artists || []).map((x) => x.name).join(', ')}</span></div><button type="button" class="btn ghost sm" id="al-change">Changer</button></div>`) : '';
        $('.al-search').classList.toggle('hidden', !!track);
        $('#al-cut').classList.toggle('hidden', !track);
        if (!track) return;
        $('#al-change').onclick = () => {
          track = null;
          paintTrack();
          $('#al-q').focus();
        };
        const dur = Math.max(1, (track.duration || 240) - 10);
        start = Math.min(start, dur);
        $('#al-start').max = dur;
        $('#al-dur').textContent = fmtTime(track.duration || 0);
        paintCut();
      };
      $('#al-start').oninput = (e) => {
        start = +e.target.value;
        paintCut();
      };
      $('#al-preview').onclick = () => playFrom(track, start);
      // Recherche d'un son (YouTube Music), ou dans tes titres likés tant que rien n'est tapé
      let timer = 0;
      const results = (list) => {
        $('#al-res').innerHTML = list.length ? list.slice(0, 8).map((t, i) => `<button type="button" class="al-hit" data-i="${i}">${cover(t, '', 96)}<span class="t-text"><b class="ellipsis">${esc(t.title)}</b><span class="muted ellipsis">${esc((t.artists || []).map((x) => x.name).join(', '))}</span></span></button>`).join('') : '<p class="muted">Aucun son trouvé</p>';
        w.querySelectorAll('.al-hit').forEach((b) => (b.onclick = () => {
          const t = list[+b.dataset.i];
          track = { id: t.id, title: t.title, artists: (t.artists || []).map((x) => ({ name: x.name, id: x.id || null })), thumb: t.thumb || null, duration: t.duration || 0 };
          start = 0;
          paintTrack();
        }));
      };
      $('#al-q').oninput = () => {
        clearTimeout(timer);
        const q = $('#al-q').value.trim();
        if (!q) return results((state.library.liked || []).slice(0, 8));
        timer = setTimeout(async () => {
          const r = await api(`/api/search?q=${encodeURIComponent(q)}&type=song`).catch(() => null);
          if ($('#al-q').value.trim() === q) results((r?.items || []).map(({ type: _t, ...t }) => t));
        }, 350);
      };
      results((state.library.liked || []).slice(0, 8));
      paintDays();
      paintSrc();
      paintTrack();
    },
  });
  if (!res || typeof res !== 'object') return false;
  await saveAlarm(res);
  toast(res.on ? `${nextLabel(alarmConf())}` : 'Réveil enregistré (désactivé)', { timeout: 4500 });
  return true;
}
