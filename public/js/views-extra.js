// Pages annexes : import, Jam, paramètres, récap d'écoute, historique, paroles plein écran.
import { ACCENTS, html, raw, icon, plural, toast, fmtAgo, artistLinks, dominantColor, confirmBox, esc } from './ui.js';
import { state, api, ls, getShare, createPlaylist, likeMany, addReport, saveSettings, setting, updateProfile, getHistory, getStats, exportLibrary, restoreLibrary } from './state.js';
import { cloud } from './cloud.js';
import { player, ctl } from './player.js';
import { sync } from './sync.js';
import { cover, trackList } from './components.js';
import { mountLyrics } from './lyrics.js';
import { bus } from './state.js';
const onJam = (fn) => {
  const h = () => fn();
  bus.addEventListener('jam', h);
  return () => bus.removeEventListener('jam', h);
};
import { spotifyDataFlow, loadJsZip } from './spotify-data.js';
import { isNative } from './native.js';
import { offline } from './offline.js';
import { setProfilePin, removeProfilePin } from './pin.js';
import { social } from './social.js';

// ======================= IMPORT =======================
export async function importPage(el, _p, ctx) {
  el.innerHTML = String(html`<div class="page" style="max-width:760px">
    <div class="row-flex" style="justify-content:space-between;flex-wrap:wrap"><h1 style="font-size:32px;margin-bottom:8px">Importer une playlist</h1><a class="outline-btn" href="#/reports">Rapports d'import</a></div>
    <p class="muted">Colle le lien d'une playlist publique. Chaque titre est retrouvé automatiquement sur YouTube Music.</p>
    <div class="src-logos"><span>Spotify</span><span>Deezer</span><span>YouTube / YouTube Music</span><span>Liste texte « Artiste - Titre »</span><span>CSV (Exportify, TuneMyMusic…)</span></div>
    <label class="field"><span>Lien ou liste de titres</span>
      <textarea class="input" id="imp-input" rows="6" placeholder="https://open.spotify.com/playlist/…&#10;ou&#10;Daft Punk - One More Time&#10;Angèle - Balance ton quoi"></textarea></label>
    <div class="row-flex"><button class="btn primary" id="imp-go">Importer</button><label class="btn ghost" style="cursor:pointer">Charger des fichiers .csv / .txt / .zip<input type="file" accept=".txt,.csv,.zip" multiple id="imp-file" hidden></label></div>
    <p class="muted" style="font-size:13px">Tu peux sélectionner plusieurs fichiers d'un coup, ou le .zip « Export All » d'Exportify : une playlist est créée par fichier (le fichier « Liked Songs » va dans tes Titres likés).</p>
    <div id="imp-status" style="margin-top:28px"></div>
    <div class="np-card" style="margin-top:36px" id="follows-card">
      <h4>Importer mes abonnements (artistes suivis)</h4>
      <ol class="muted" style="margin:0 0 12px;padding-left:18px;font-size:14px">
        <li>Ouvre Spotify (connecté) → ton profil → clique sur <b>« … abonnements »</b>.</li>
        <li>Fais défiler jusqu'en bas, puis <b>Ctrl+A</b> et <b>Ctrl+C</b> (tout copier).</li>
        <li>Colle ci-dessous avec <b>Ctrl+V</b>. Tu peux aussi écrire un nom d'artiste par ligne.</li>
      </ol>
      <textarea class="input" id="follows-input" rows="5" placeholder="Colle ici la page Abonnements de Spotify, ou :&#10;Angèle&#10;Damso&#10;Aya Nakamura"></textarea>
      <button class="btn primary" id="follows-go" style="margin-top:10px">S'abonner à ces artistes</button>
    </div>
    <div class="np-card">
      <h4>Importer mes données Spotify (abonnements, likes, historique d'écoute)</h4>
      <p class="muted" style="margin-top:0">Demande tes données sur <b>spotify.com/account/privacy</b> → « Télécharger vos données ». Quand tu reçois le mail, télécharge le fichier <b>.zip</b> et dépose-le ici, sans le décompresser.</p>
      <label class="btn white" style="cursor:pointer;display:inline-block">Choisir le .zip Spotify<input type="file" accept=".zip,.json" multiple id="sd-file" hidden></label>
      <div id="sd-box" style="margin-top:16px"></div>
    </div>
    <details style="margin-top:32px" class="muted"><summary style="cursor:pointer">Apple Music, Tidal, Amazon Music… ?</summary>
      <p>Ces plateformes ne permettent pas de lire les playlists sans compte. Utilise un service gratuit comme <b>TuneMyMusic</b> ou <b>Exportify</b> (pour Spotify) pour exporter ta playlist en CSV / texte, puis charge le fichier ici.</p></details>
  </div>`);
  const input = el.querySelector('#imp-input');
  el.querySelector('#follows-go').onclick = async (e) => {
    const v = el.querySelector('#follows-input').value.trim();
    if (!v) return toast('Colle la liste de tes abonnements');
    e.currentTarget.disabled = true;
    const { bulkFollow } = await import('./views.js');
    await bulkFollow(() => (el.querySelector('#follows-input').value = ''), v);
    e.currentTarget.disabled = false;
  };
  el.querySelector('#sd-file').onchange = (e) => e.target.files.length && spotifyDataFlow(el.querySelector('#sd-box'), [...e.target.files]);
  let fileName = '';
  el.querySelector('#imp-file').onchange = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    // Plusieurs fichiers ou un .zip : import groupé
    if (files.length > 1 || /\.zip$/i.test(files[0].name)) return batchImport(el.querySelector('#imp-status'), files, ctx);
    input.value = await readText(files[0]);
    // Nom de la playlist d'après le fichier (Exportify : « ma_playlist.csv »)
    fileName = fileTitle(files[0].name);
  };
  el.querySelector('#imp-go').onclick = async () => {
    const v = input.value.trim();
    if (!v) return toast('Colle un lien ou une liste');
    // Code de playlist partagée par un ami (8 caractères)
    const shareCode = v.match(/(?:^|code\s*:?\s*)([A-HJ-NP-Z2-9]{8})(?:\s|$|\))/i)?.[1];
    if (shareCode && (v.length <= 12 || /boombox/i.test(v))) return importShare(el.querySelector('#imp-status'), shareCode.toUpperCase());
    const status = el.querySelector('#imp-status');
    status.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    let job;
    try {
      job = await api('/api/import', { method: 'POST', body: { input: v, name: fileName } });
    } catch (e) {
      status.innerHTML = String(html`<p style="color:var(--danger)">${e.message}</p>`);
      return;
    }
    while (ctx.alive()) {
      await new Promise((r) => setTimeout(r, 800));
      job = await api(`/api/import/${job.id}`).catch(() => job);
      if (job.status === 'error') {
        status.innerHTML = String(html`<p style="color:var(--danger)">${job.error}</p>`);
        return;
      }
      const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
      status.innerHTML = String(html`<b>${job.name || 'Lecture de la playlist…'}</b> <span class="muted">${job.source}</span>
        <div class="progress-bar"><div style="width:${pct}%"></div></div><span class="muted">${job.done} / ${job.total || '?'} titres analysés</span>`);
      if (job.status === 'done') break;
    }
    if (!ctx.alive()) return;
    status.innerHTML = String(html`
      <div class="row-flex" style="align-items:flex-end;gap:20px;margin-bottom:16px;flex-wrap:nowrap">
        ${job.cover ? html`<div class="cover" style="width:160px;height:160px;box-shadow:0 8px 24px rgba(0,0,0,.5)"><img src="${job.cover}" alt="" referrerpolicy="no-referrer"></div>` : ''}
        <div style="min-width:0"><div class="muted" style="font-size:13px">Playlist ${job.source}${job.owner ? ` · par ${job.owner}` : ''}</div>
          <h2 style="font-size:32px;margin:4px 0">${job.name}</h2>
          ${job.description ? html`<p class="muted" style="margin:0">${job.description}</p>` : ''}</div>
      </div>
      <p class="muted">${plural(job.tracks.length, 'titre')} trouvé${job.tracks.length > 1 ? 's' : ''}${job.unmatched.length ? `, ${job.unmatched.length} introuvable${job.unmatched.length > 1 ? 's' : ''}` : ''}, dans l'ordre d'origine${job.hasDates ? ', avec les dates d’ajout' : ''}.</p>
      ${job.note ? html`<p class="muted">ℹ️ ${job.note} ${!state.status.spotifyApi && job.source === 'Spotify' ? html`<a class="link" href="#/settings" style="color:var(--accent)">Ajouter une clé Spotify</a>` : ''}</p>` : ''}
      <div class="row-flex" style="margin:16px 0"><input class="input" id="imp-name" value="${job.name}" style="max-width:320px"><button class="btn primary" id="imp-save">Créer la playlist</button><button class="btn ghost" id="imp-like">Ajouter aux Titres likés</button></div>
      ${job.unmatched.length ? html`<details style="margin-bottom:16px"><summary class="muted" style="cursor:pointer">Titres non trouvés</summary><ul class="muted">${job.unmatched.map((u) => html`<li>${u}</li>`)}</ul></details>` : ''}
      ${trackList(job.tracks, { context: { type: 'import', name: job.name }, added: job.hasDates })}`);
    el.querySelector('#imp-save').onclick = async (e) => {
      e.currentTarget.disabled = true;
      const p = await createPlaylist(el.querySelector('#imp-name').value || job.name, job.tracks, job.description, {
        cover: job.cover,
        source: { platform: job.source, url: job.url, owner: job.owner },
      });
      importReport(job, p.id, p.name);
      location.hash = `#/playlist/${p.id}`;
    };
    el.querySelector('#imp-like').onclick = async (e) => {
      e.currentTarget.disabled = true;
      const n = await likeMany(job.tracks);
      toast(` ajouté${n > 1 ? 's' : ''} aux Titres likés`, { action: 'Voir', onAction: () => (location.hash = '#/liked') });
    };
  };
}

// Import d'une playlist partagée par un ami (code)
async function importShare(box, code) {
  box.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const s = await getShare(code).catch(() => null);
  if (!s) return (box.innerHTML = String(html`<p style="color:var(--danger)">Code ${code} introuvable.</p>`));
  box.innerHTML = String(html`<div class="row-flex" style="align-items:flex-end;gap:20px;margin-bottom:16px;flex-wrap:nowrap">${s.cover ? html`<div class="cover" style="width:140px;height:140px"><img src="${s.cover}" alt=""></div>` : ''}
    <div><div class="muted" style="font-size:13px">Playlist partagée par ${s.owner}</div><h2 style="font-size:30px;margin:4px 0">${s.name}</h2><p class="muted" style="margin:0">${s.description || ''}</p><p class="muted">${plural(s.tracks.length, 'titre')}</p></div></div>
    <button class="btn primary" id="sh-save">Ajouter à ma bibliothèque</button>
    <div style="margin-top:16px">${trackList(s.tracks, { context: { type: 'share', name: s.name }, added: true })}</div>`);
  box.querySelector('#sh-save').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const p = await createPlaylist(s.name, s.tracks, s.description, { cover: s.cover, source: { platform: 'Boombox', url: null, owner: s.owner } });
    location.hash = `#/playlist/${p.id}`;
  };
}

// Lit un fichier texte quel que soit son encodage (UTF-8, UTF-16 d'Excel, Windows-1252)
async function readText(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

const fileTitle = (name) => name.split('/').pop().replace(/\.(csv|txt)$/i, '').replace(/[_]+/g, ' ').trim();
const isLikedFile = (name) => /liked[ _-]?songs|titres[ _-]?lik|favori|coups? de c/i.test(name);

// Import de plusieurs playlists d'un coup (fichiers multiples ou .zip)
async function batchImport(box, files, ctx) {
  const list = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const JSZip = await loadJsZip();
      const zip = await JSZip.loadAsync(f);
      for (const z of Object.values(zip.files)) if (!z.dir && /\.(csv|txt)$/i.test(z.name)) list.push({ name: z.name, read: async () => readText(new Blob([await z.async('uint8array')])) });
    } else if (/\.(csv|txt)$/i.test(f.name)) list.push({ name: f.name, read: () => readText(f) });
  }
  if (!list.length) return (box.innerHTML = '<p style="color:var(--danger)">Aucun fichier .csv ou .txt trouvé.</p>');
  const rows = list.map((f) => ({ ...f, title: fileTitle(f.name), state: 'En attente', done: 0, total: 0 }));
  const render = () => {
    box.innerHTML = String(html`<h2 style="margin-bottom:12px">Import de ${plural(rows.length, 'fichier')}</h2>${rows.map((r) => html`<div class="batch-row"><b class="ellipsis">${isLikedFile(r.name) ? '❤ ' : ''}${r.title}</b><span class="muted">${r.state}</span><div class="progress-bar"><div style="width:${r.total ? Math.round((r.done / r.total) * 100) : r.state.startsWith('✓') ? 100 : 0}%"></div></div></div>`)}`);
  };
  render();
  // Deux fichiers à la fois (le serveur cherche déjà 6 titres en parallèle par fichier)
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length && ctx.alive()) {
      const r = rows[cursor++];
      try {
        r.state = 'Lecture…';
        render();
        let job = await api('/api/import', { method: 'POST', body: { input: await r.read(), name: r.title } });
        while (job.status === 'running' || !job.status) {
          await new Promise((res) => setTimeout(res, 1000));
          job = await api(`/api/import/${job.id}`);
          Object.assign(r, { done: job.done, total: job.total, state: `Recherche des titres… ${job.done}/${job.total}` });
          render();
        }
        if (job.status === 'error') throw new Error(job.error);
        if (isLikedFile(r.name)) {
          const n = await likeMany(job.tracks);
          importReport(job, null, 'Titres likés');
          r.state = `✓ ${plural(n, 'titre')} ajouté${n > 1 ? 's' : ''} aux Titres likés`;
        } else {
          const np = await createPlaylist(r.title, job.tracks, '', { source: { platform: 'Fichier', url: null, owner: null } });
          importReport(job, np.id, np.name);
          r.state = `✓ ${plural(job.tracks.length, 'titre')}${job.unmatched.length ? ` (${job.unmatched.length} introuvable${job.unmatched.length > 1 ? 's' : ''})` : ''}`;
        }
      } catch (e) {
        r.state = '✗ ' + e.message;
      }
      render();
    }
  };
  await Promise.all([worker(), worker()]);
  if (ctx.alive()) toast('Import terminé');
}

// Couleur d'accent affichée comme choisie (l'ancien vert par défaut compte comme le mauve)
const curAccent = () => {
  const c = setting('accent', ACCENTS.Mauve);
  return c === ACCENTS.Vert && !setting('accentChosen', false) ? ACCENTS.Mauve : c;
};

// Rapport d'un import (titres ajoutés / introuvables), consultable dans « Rapports d'import »
const importReport = (job, playlistId, name, extra = {}) => addReport({ type: "import", playlistId, name, source: job.source || "Fichier", url: job.url || null, sourceCount: job.total || job.tracks.length + job.unmatched.length, hereCount: job.tracks.length, added: job.tracks.map((t) => `${(t.artists || []).map((a) => a.name).join(", ")} - ${t.title}`), missing: job.unmatched.map((m) => `${m} — introuvable sur YouTube`), ...extra }).catch(() => {});

// ======================= JAM =======================
export async function jam(el, params) {
  if (params.code && !sync.jam) setTimeout(() => sync.jamJoin(params.code), 300);
  // Anciens liens « #/jam?party » : on arrive juste sur la page (plus de party lancée sans le vouloir)
  if (params.code || 'party' in params) history.replaceState(null, '', '#/jam');
  const render = () => {
    const room = sync.jam;
    if (!room) {
      el.innerHTML = String(html`<div class="page party-page" style="max-width:820px">
        <div class="row-flex" style="gap:20px;margin-bottom:8px;flex-wrap:nowrap"><img src="/assets/cover-jam.png" alt="" class="jam-art"><div><h1 style="font-size:40px;margin:0">Mode party</h1><p class="muted" style="margin:4px 0 0">Une file commune : chacun ajoute ses sons, cet appareil les joue.</p></div></div>
        <div class="party-start">
          <div class="np-card"><h4>${icon('play', 18)} Lancer une party</h4><p class="muted">Branche cet appareil sur l'enceinte. Tes invités scannent un QR code avec leur téléphone (sans compte ni appli) ; tes amis Boombox entrent le code.</p><button class="btn primary" id="jam-create">Lancer la party</button></div>
          <div class="np-card"><h4>${icon('users', 18)} Rejoindre une party</h4><p class="muted">Un ami lance la party sur son appareil : entre son code pour ajouter tes sons depuis ton profil.</p><div class="row-flex"><input class="input" id="jam-code" placeholder="Code (ex : K7P2Q)" maxlength="5" style="max-width:180px;text-transform:uppercase;letter-spacing:.12em"><button class="btn white" id="jam-join">Rejoindre</button></div></div>
        </div>
      </div>`);
      el.querySelector('#jam-create').onclick = () => sync.jamCreate();
      el.querySelector('#jam-join').onclick = () => sync.jamJoin(el.querySelector('#jam-code').value);
      el.querySelector('#jam-code').onkeydown = (e) => e.key === 'Enter' && sync.jamJoin(e.target.value);
      return;
    }
    const host = sync.isJamHost();
    const st = room.state;
    // Un seul QR code : la page invité (même Wi-Fi : servie par ce PC ; partout : en ligne sur Firebase Hosting)
    const partyWide = ls.get('boombox.partyWide', false);
    const partyUrl = partyWide ? `https://musikal-b72d1.web.app/party.html?code=${room.code}` : `${state.status.lan[0] || location.origin}/party.html?code=${room.code}`;
    el.innerHTML = String(html`<div class="page party-page" style="max-width:900px">
      <div class="row-flex" style="justify-content:space-between;flex-wrap:nowrap"><h1 style="font-size:36px;margin:0">${host ? 'Ta party' : `Party de ${room.hostName}`}</h1><button class="btn ghost" id="jam-leave">${host ? 'Terminer la party' : 'Quitter'}</button></div>
      <div class="np-card party-invite">
        <div class="pi-qr" id="party-qr"></div>
        <div class="pi-info">
          <div class="muted pi-label">Code de la party</div>
          <div class="jam-code">${room.code}</div>
          <p class="muted pi-help">Les invités <b>scannent le QR code</b> avec l'appareil photo de leur téléphone : ils cherchent un son ou collent un lien Spotify, Deezer, YouTube. Tes amis Boombox entrent le <b>code</b> dans Mode party → Rejoindre.</p>
          ${host ? html`<div class="chips pi-chips"><button class="chip ${partyWide ? '' : 'active'}" data-wide="0">Même Wi-Fi</button><button class="chip ${partyWide ? 'active' : ''}" data-wide="1">Partout (4G)</button></div>
          <div class="row-flex pi-actions"><button class="btn white" id="party-tv">${icon('fullscreen', 16)} Écran géant</button><button class="btn ghost" id="party-copy">${icon('copy', 16)} Copier le lien</button></div>` : ''}
        </div>
      </div>
      <div class="jam-members">${room.members.map((m) => html`<span class="jam-member">${m.id === room.host ? '👑 ' : ''}${m.name}</span>`)}</div>
      ${host ? html`<label class="row-flex" style="margin-bottom:16px"><span class="switch"><input type="checkbox" id="jam-ctrl" ${room.everyoneControls ? 'checked' : ''}><span></span></span> Tout le monde peut mettre en pause / passer</label>` : html`<label class="row-flex" style="margin-bottom:16px"><span class="switch"><input type="checkbox" id="jam-along" ${sync.listenAlong ? 'checked' : ''}><span></span></span> Écouter aussi sur cet appareil (synchronisé)</label>`}
      ${st?.track ? html`<div class="np-card" style="display:flex;gap:16px;align-items:center">${cover(st.track)}<div style="flex:1;min-width:0"><div class="muted" style="font-size:12px">EN COURS</div><b class="ellipsis" style="display:block;font-size:18px">${st.track.title}</b><span class="muted">${artistLinks(st.track)}</span></div>
        ${host || room.everyoneControls ? html`<button class="play-btn" id="jam-toggle">${icon(st.paused ? 'play' : 'pause')}</button><button class="ctrl" id="jam-next">${icon('next')}</button>` : ''}</div>` : html`<p class="muted">Rien en cours. Ajoutez des sons : ${host ? 'la lecture démarre toute seule.' : "l'hôte les jouera."}</p>`}
      <div class="section-head" style="margin-top:24px"><h2>File de la party</h2><a href="#/search" class="outline-btn">+ Ajouter des sons</a></div>
      <p class="muted" style="margin-top:-6px">Depuis la recherche, double-clique sur un son (ou « ⋯ → Ajouter à la party »).</p>
      ${room.queue.length ? html`<div>${room.queue.map((t) => html`<div class="q-item">${cover(t)}<div class="t-text" style="flex:1"><span class="t-title">${t.title}</span><span class="t-artists muted">${artistLinks(t)} · ajouté par ${t.addedBy}</span></div>${host ? html`<button class="q-x icon-btn" data-rm="${t.qid}" style="opacity:1">${icon('close')}</button>` : ''}</div>`)}</div>` : html`<p class="muted">La file est vide.</p>`}
    </div>`);
    el.querySelector('#jam-leave').onclick = () => sync.jamLeave();
    el.querySelector('#jam-ctrl')?.addEventListener('change', (e) => sync.jamSettings({ everyoneControls: e.target.checked }));
    el.querySelector('#jam-along')?.addEventListener('change', (e) => sync.setListenAlong(e.target.checked));
    el.querySelector('#jam-toggle')?.addEventListener('click', () => sync.jamCommand('toggle'));
    el.querySelector('#jam-next')?.addEventListener('click', () => sync.jamCommand('next'));
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => sync.jamRemove(b.dataset.rm)));
    renderQr(el.querySelector('#party-qr'), partyUrl, 184);
    if (host) {
      el.querySelector('#party-copy').onclick = () => navigator.clipboard.writeText(partyUrl).then(() => toast('Lien invité copié'));
      el.querySelector('#party-tv').onclick = () => partyScreen(partyUrl);
      el.querySelectorAll('[data-wide]').forEach((b) => (b.onclick = () => (ls.set('boombox.partyWide', b.dataset.wide === '1'), render())));
    }
  };
  render();
  return { onJam: render };
}

// QR code (librairie chargée à la demande depuis un CDN)
let qrLib = null;
async function renderQr(box, text, size = 128) {
  if (!box) return;
  try {
    qrLib ??= new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = '/vendor/qrcode.min.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    await qrLib;
    box.innerHTML = '<div class="qr"></div>';
    new window.QRCode(box.firstChild, { text, width: size, height: size });
  } catch {}
}

// Écran soirée plein écran (à afficher sur la télé / l'ordi branché à l'enceinte) : QR code géant + en cours + file
function partyScreen(url) {
  const ov = document.createElement('div');
  ov.className = 'party-screen';
  document.body.appendChild(ov);
  ov.requestFullscreen?.().catch(() => {});
  let shownId = null;
  let lyricsOff = null;
  // Clip du son en cours en fond (muet : le son vient du lecteur), repris à la bonne position ; paroles par-dessus
  const setTrack = (t, pos) => {
    if ((t?.id || null) === shownId) return;
    shownId = t?.id || null;
    const vid = ov.querySelector('.ps-video');
    vid.innerHTML = t ? `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.id)}?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&loop=1&playlist=${encodeURIComponent(t.id)}&start=${Math.max(0, Math.floor(pos || 0))}" allow="autoplay; encrypted-media" tabindex="-1" title=""></iframe>` : '';
    lyricsOff?.();
    lyricsOff = null;
    const ly = ov.querySelector('.ps-lyrics');
    ly.innerHTML = '';
    if (t) lyricsOff = mountLyrics(ly, t);
  };
  const draw = () => {
    const room = sync.jam;
    if (!room) return close();
    const st = room.state;
    // Hôte : piste et position du lecteur local (plus précises que l'état publié)
    const t = sync.isJamHost() ? player.track : st?.track;
    setTrack(t, sync.isJamHost() ? player.time() : sync.position(st));
    ov.querySelector('.ps-now').innerHTML = t
      ? String(html`${cover(t, '', 544)}<div><small>EN COURS</small><h2>${t.title}</h2><p>${(t.artists || []).map((a) => a.name).join(', ')}</p></div>`)
      : String(html`<h2>La musique va commencer…</h2>`);
    ov.querySelector('.ps-queue').innerHTML = String(html`<h3>À suivre</h3>${(room.queue || []).slice(0, 4).map((x) => html`<div class="ps-q">${cover(x, '', 96)}<div><b>${x.title}</b><span>${(x.artists || []).map((a) => a.name).join(', ')} · ${x.addedBy}</span></div></div>`)}${(room.queue || []).length ? '' : html`<p class="muted">Personne n'a encore ajouté de son : scanne le QR code !</p>`}`);
  };
  const close = () => {
    off();
    offTrack();
    lyricsOff?.();
    document.removeEventListener('fullscreenchange', onFs);
    document.removeEventListener('keydown', onEsc);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    ov.remove();
  };
  // Échap (sortie du plein écran) ferme aussi l'écran soirée, au lieu de le laisser par-dessus l'appli
  let wasFs = false;
  const onFs = () => (document.fullscreenElement ? (wasFs = true) : wasFs && close());
  document.addEventListener('fullscreenchange', onFs);
  // Plein écran refusé par le navigateur : Échap ferme quand même
  const onEsc = (e) => e.key === 'Escape' && !document.fullscreenElement && close();
  document.addEventListener('keydown', onEsc);
  ov.innerHTML = String(html`<div class="ps-bg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
    <div class="ps-video" aria-hidden="true"></div><div class="ps-shade" aria-hidden="true"></div>
    <button class="icon-btn ps-close" aria-label="Fermer">${icon('close')}</button>
    <div class="ps-left"><img src="/assets/logo-symbol.png" alt="" style="width:80px"><h1>Ajoute tes sons !</h1><p>Scanne avec l'appareil photo de ton téléphone</p><div id="ps-qr"></div><p class="ps-code">Code ${sync.jam.code}</p></div>
    <div class="ps-right"><div class="ps-now"></div><div class="ps-lyrics"></div><div class="ps-queue"></div></div>`);
  ov.querySelector('.ps-close').onclick = close;
  renderQr(ov.querySelector('#ps-qr'), url, 260);
  const off = onJam(draw);
  const onTrackChange = () => draw();
  bus.addEventListener('player:track', onTrackChange);
  const offTrack = () => bus.removeEventListener('player:track', onTrackChange);
  draw();
}

// ======================= PARAMÈTRES =======================
export async function settings(el) {
  const st = state.status;
  const p = state.profile;
  el.innerHTML = String(html`<div class="page" style="max-width:820px">
    <h1 style="font-size:32px;margin-bottom:16px">Paramètres</h1>

    <h2 style="font-size:20px;margin-top:24px">Profil</h2>
    <div class="settings-row"><div><b>Nom du profil</b></div><input class="input" id="s-pname" value="${p.name}" maxlength="40"></div>
    <div class="settings-row"><div><b>Couleur</b></div><input type="color" id="s-pcolor" value="${p.color}"></div>
    <div class="settings-row"><div><b>Changer de profil</b><p>Chaque profil a ses propres playlists, likes et artistes suivis.</p></div><button class="btn ghost" id="s-switch">Changer</button></div>
    <div class="settings-row"><div><b>Code du profil</b><p>${state.profile.pin ? 'Un code à 4 chiffres protège ce profil : il est demandé quand on le choisit sur un appareil ou qu’on change de profil.' : 'Protège ce profil par un code à 4 chiffres, demandé quand quelqu’un le choisit ou change de profil.'}</p></div><div class="row-flex">${state.profile.pin ? html`<button class="btn ghost" id="s-pin">Changer</button><button class="btn ghost" id="s-pin-off">Retirer</button>` : html`<button class="btn ghost" id="s-pin">Choisir un code</button>`}</div></div>

    <h2 style="font-size:20px;margin-top:24px">Amis</h2>
    <div class="settings-row"><div><b>Partager mon activité d'écoute</b><p>Tes amis Boombox voient le son que tu écoutes en ce moment, ou le dernier écouté (« il y a 8 h »). Désactivé : ils ne voient rien.</p></div><label class="switch"><input type="checkbox" id="s-share" ${social.sharing ? 'checked' : ''}><span></span></label></div>
    <div class="settings-row"><div><b>Mon code ami</b><p>Donne-le à tes amis pour qu'ils t'ajoutent (activité, messages, envoi de sons et de playlists).</p></div><div class="row-flex" style="flex-wrap:nowrap;gap:10px;flex:none"><span class="code big">${social.code || '…'}</span><button class="btn ghost" id="s-fcode" style="white-space:nowrap">${icon('copy', 16)} Copier</button></div></div>
    <div class="settings-row"><div><b>Mes amis</b><p>${plural(social.friends.length, 'ami')}${social.unread ? ` · ${plural(social.unread, 'message non lu')}` : ''}</p></div><a class="btn ghost" href="#/friends">Amis et messages</a></div>

    <div class="settings-row"><div><b>Couleur de l'appli</b><p>Couleur d'accent des boutons et de la lecture, pour ce profil. « Auto » : la couleur suit la pochette du son en cours.</p></div>
      <div class="swatches">${Object.entries(ACCENTS).map(([n, c]) => html`<button class="swatch ${curAccent() === c ? 'on' : ''}" data-accent="${c}" title="${n}" style="background:${c}"></button>`)}<button class="swatch swatch-auto ${curAccent() === 'auto' ? 'on' : ''}" data-accent="auto" title="Auto (couleur de la pochette)">A</button></div></div>

    <h2 style="font-size:20px;margin-top:32px">Lecture</h2>
    <div class="settings-row"><div><b>Lecture automatique</b><p>À la fin d'une playlist, continue avec des titres similaires.</p></div><label class="switch"><input type="checkbox" id="s-autoplay" ${setting('autoplay', true) ? 'checked' : ''}><span></span></label></div>
    <div class="settings-row"><div><b>Liker les titres ajoutés aux playlists</b><p>Dès qu'un titre entre dans une de tes playlists, il est aussi ajouté à tes Titres likés.</p></div><label class="switch"><input type="checkbox" id="s-autolike" ${setting('autoLike', true) ? 'checked' : ''}><span></span></label></div>
    <div class="settings-row"><div><b>Fondu enchaîné</b><p>${st.ytdlp ? 'Les titres se chevauchent en fondu : la fin du titre s’éteint pendant que le suivant démarre.' : 'Nécessite la lecture audio directe (yt-dlp).'}</p></div>
      <div class="xf-control"><div class="slider xf-slider" id="s-xf" role="slider" aria-label="Durée du fondu" aria-valuemin="0" aria-valuemax="12" tabindex="0"><div class="fill"></div><div class="knob"></div></div><span class="xf-value" id="s-xf-val"></span></div></div>
    <div class="settings-row"><div><b>Automix (enchaînements façon DJ)</b><p>Analyse le tempo et la tonalité de chaque titre : les transitions démarrent sur un temps fort, le tempo est calé, les basses sont échangées et les volumes égalisés. En lecture aléatoire, le titre suivant est choisi pour bien s'enchaîner. ${st.ytdlp ? '' : 'Nécessite la lecture audio directe (yt-dlp).'}</p></div><label class="switch"><input type="checkbox" id="s-automix" ${setting('automix', false) ? 'checked' : ''} ${st.ytdlp ? '' : 'disabled'}><span></span></label></div>
    <div class="settings-row"><div><b>Normaliser le volume</b><p>Tous les sons sont joués au même niveau sonore : fini les titres beaucoup plus forts ou plus faibles que les autres. ${isNative ? 'Sur téléphone, peut couper le son écran verrouillé : à activer seulement si tu écoutes appli ouverte.' : ''}</p></div><label class="switch"><input type="checkbox" id="s-normalize" ${setting('normalize', !isNative) ? 'checked' : ''} ${st.ytdlp || isNative ? '' : 'disabled'}><span></span></label></div>
    ${isNative ? '' : html`<div class="settings-row"><div><b>Lancer Boombox au démarrage de Windows</b><p>Le serveur démarre tout seul avec le PC : ton téléphone peut lire et télécommander dès que le PC est allumé, et l'appli s'ouvre instantanément.</p><label class="row-flex" style="font-size:13px;gap:8px;margin-top:6px"><input type="checkbox" id="s-autostart-win"> Ouvrir aussi la fenêtre Boombox</label></div><label class="switch"><input type="checkbox" id="s-autostart"><span></span></label></div>`}
    ${isNative ? '' : html`<div class="settings-row"><div><b>Pré-télécharger mes titres likés</b><p>En arrière-plan, quand rien ne joue : tes likes démarrent instantanément et Boombox sollicite beaucoup moins YouTube. Utilise jusqu'à 4 Go sur ce PC.</p><p class="muted" id="s-pre-status" style="font-size:12px"></p></div><label class="switch"><input type="checkbox" id="s-predownload" ${setting('predownload', true) ? 'checked' : ''}><span></span></label></div>`}
    ${isNative ? '' : html`<div class="settings-row"><div><b>Alertes nouvelles sorties</b><p>Une notification discrète quand un artiste que tu suis sort un son (regroupées, au plus une toutes les 6 heures).</p></div><label class="switch"><input type="checkbox" id="s-alerts" ${setting('releaseAlerts', true) && typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'checked' : ''}><span></span></label></div>`}
    <div class="settings-row"><div><b>Titres masqués</b><p>${plural(setting('banned', []).length, 'titre')} que tu as choisi de ne plus entendre (menu ⋯ → « Ne plus proposer »).</p></div>${setting('banned', []).length ? html`<button class="btn ghost" id="s-unban">Tout réautoriser</button>` : ''}</div>
    <div class="settings-row"><div><b>Moteur de lecture</b><p>${st.ytdlp ? '✅ yt-dlp détecté : lecture audio directe disponible (écran éteint sur mobile, contrôles sur l’écran de verrouillage).' : 'Lecteur YouTube intégré. Installe yt-dlp pour l’audio direct (lecture écran éteint sur téléphone) — voir README.'}</p></div>
      <select class="input" id="s-engine"><option value="auto">Automatique</option><option value="youtube">Lecteur YouTube</option><option value="audio" ${st.ytdlp ? '' : 'disabled'}>Audio direct (yt-dlp)</option></select></div>

    <h2 style="font-size:20px;margin-top:32px">Appareils</h2>
    <div class="settings-row"><div><b>Nom de cet appareil</b><p>Affiché dans la liste des appareils et dans les Jams.</p></div><input class="input" id="s-dname" value="${state.device.name}" maxlength="40"></div>
    <div class="settings-row"><div><b>Ouvrir Boombox sur ton téléphone</b><p>Connecte ton téléphone au même Wi-Fi et ouvre l'une de ces adresses, puis « Ajouter à l'écran d'accueil » pour l'avoir comme une appli.</p>
      ${st.lan.map((u) => html`<div style="margin-top:6px"><span class="code">${u}</span></div>`)}</div><div id="s-qr"></div></div>

    ${isNative && offline.ready ? html`<h2 style="font-size:20px;margin-top:32px">Hors ligne</h2>
    <div class="settings-row" style="align-items:flex-start"><div style="flex:1"><b>Espace utilisé sur le téléphone</b><p>${(offline.media.storageUsed() / 1024 ** 3).toFixed(2).replace('.', ',')} Go sur ${ls.get('boombox.storageLimitGB', 1)} Go · ${plural(offline.downloaded.size, 'titre')}</p>
      <div class="storage-bar"><div style="width:${Math.min(100, (offline.media.storageUsed() / offline.limitBytes()) * 100)}%"></div></div></div></div>
    <div class="settings-row"><div style="flex:1"><b>Limite d'espace : <span id="s-lim-v">${ls.get('boombox.storageLimitGB', 1)}</span> Go</b><p>Au-delà, les titres écoutés il y a le plus longtemps (et non téléchargés volontairement) sont supprimés.</p><input type="range" class="range" id="s-lim" min="1" max="64" step="1" value="${ls.get('boombox.storageLimitGB', 1)}"></div></div>
    <div class="settings-row"><div><b>Télécharger seulement en Wi-Fi</b><p>Pour ne pas consommer ton forfait.</p></div><label class="switch"><input type="checkbox" id="s-wifi" ${setting('offlineWifiOnly', true) ? 'checked' : ''}><span></span></label></div>
    <div class="settings-row"><div><b>Télécharger mes titres likés</b><p>Tous tes likes disponibles hors ligne, y compris les prochains.</p></div><label class="switch"><input type="checkbox" id="s-offliked" ${setting('offlineLiked', false) ? 'checked' : ''}><span></span></label></div>
    <div class="settings-row"><div><b>Supprimer tous les téléchargements</b><p>Libère l'espace (les playlists restent marquées et se re-téléchargeront en Wi-Fi).</p></div><button class="btn ghost" id="s-dlclear">Tout supprimer</button></div>` : ''}

    <h2 style="font-size:20px;margin-top:32px">Assistant IA</h2>
    <div class="settings-row" style="align-items:flex-start"><div><b>Clé Gemini (Google) ${st.ai ? '✅' : ''}</b>
      <p>${st.ai ? `Active (modèle ${st.aiModel}). L'assistant crée et complète tes playlists.` : 'Gratuite, nécessaire pour l’assistant IA.'}</p>
      <details style="margin-top:6px"><summary class="muted" style="cursor:pointer;font-size:13px">Comment obtenir une clé (1 min)</summary>
        <ol class="muted" style="font-size:13px;padding-left:18px">
          <li>Va sur <b>aistudio.google.com/apikey</b> et connecte-toi avec ton compte Google.</li>
          <li>Clique sur <b>Créer une clé API</b> (choisis le projet « musikal » s'il est proposé).</li>
          <li>Copie la clé (elle commence par <span class="code">AIza</span>) et colle-la ici.</li>
        </ol>
        <p class="muted" style="font-size:12px">Offre gratuite : aucune carte bancaire, quelques requêtes par minute. Google peut utiliser les demandes de l'offre gratuite pour améliorer ses produits.</p></details></div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:240px">
        <input class="input" id="s-gemini" placeholder="Clé API Gemini" type="password" autocomplete="off">
        <div class="row-flex"><button class="btn primary" id="s-gsave">Enregistrer</button>${st.ai ? html`<button class="btn ghost" id="s-gdel">Retirer</button>` : ''}</div>
      </div></div>

    <h2 style="font-size:20px;margin-top:32px">Import Spotify</h2>
    <div class="settings-row" style="align-items:flex-start"><div><b>Clé API Spotify ${st.spotifyApi ? '✅' : ''}</b>
      <p>${st.spotifyApi ? 'Active : utilisée pour les profils Spotify (Blend) et en secours pour les imports.' : 'Facultatif, gratuit. Les playlists sont lues en entier même sans clé ; elle sert pour faire un Blend avec un profil Spotify.'}</p>
      <details style="margin-top:6px"><summary class="muted" style="cursor:pointer;font-size:13px">Comment obtenir une clé (2 min)</summary>
        <ol class="muted" style="font-size:13px;padding-left:18px">
          <li>Va sur <b>developer.spotify.com/dashboard</b> et connecte-toi avec ton compte Spotify.</li>
          <li><b>Create app</b> : nom « Boombox », description au choix, Redirect URI : <span class="code">http://127.0.0.1:8787</span>, coche <b>Web API</b>, accepte les conditions, <b>Save</b>.</li>
          <li>Dans l'app : <b>Settings</b> → copie le <b>Client ID</b>, puis <b>View client secret</b> et copie-le.</li>
        </ol></details></div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:240px">
        <input class="input" id="s-spid" placeholder="Client ID" autocomplete="off">
        <input class="input" id="s-spsecret" placeholder="Client Secret" type="password" autocomplete="off">
        <div class="row-flex"><button class="btn primary" id="s-spsave">Enregistrer</button>${st.spotifyApi ? html`<button class="btn ghost" id="s-spdel">Retirer</button>` : ''}</div>
      </div></div>

    <h2 style="font-size:20px;margin-top:32px">Lier mes appareils</h2>
    <div class="settings-row"><div style="flex:1"><b>Ajouter un appareil</b><p>Sur ton téléphone ou un autre PC, scanne un de ces QR codes (ou colle le lien). Tes playlists, likes et artistes seront synchronisés en direct, même si ce PC est éteint.</p>
      <div class="qr-pair">
        <figure><div id="s-appqr" class="qr-slot"></div><figcaption><b>Appli mobile Boombox</b>Avec l'appareil photo : ouvre directement l'appli</figcaption></figure>
        <figure><div id="s-linkqr" class="qr-slot"></div><figcaption><b>Navigateur / autre PC</b>Ouvre Boombox dans le navigateur</figcaption></figure>
      </div>
      <div class="row-flex"><button class="btn ghost" id="s-copylink">Copier le lien</button><span class="muted" style="font-size:12px">⚠️ Ce lien donne accès à ta bibliothèque : ne le partage qu'avec tes appareils.</span></div></div></div>
    <div class="settings-row" style="align-items:flex-start"><div style="flex:1"><b>Appareils liés</b><p>Tous les appareils qui partagent ta bibliothèque. Retire un appareil perdu ou vendu : il n'aura plus accès à rien.</p><div id="s-members" class="members"><p class="muted">Chargement…</p></div></div></div>
    <div class="settings-row"><div><b>Version</b><p id="s-version">…</p></div></div>

    <h2 style="font-size:20px;margin-top:32px">Données</h2>
    <div class="settings-row"><div><b>Sauvegarder ma bibliothèque</b><p>Télécharge un fichier JSON avec playlists, likes, artistes suivis.</p></div><button class="btn ghost" id="s-export">Exporter</button></div>
    <div class="settings-row"><div><b>Restaurer une sauvegarde</b><p>Remplace la bibliothèque de ce profil.</p></div><label class="btn ghost" style="cursor:pointer">Importer<input type="file" accept=".json" id="s-restore" hidden></label></div>
    <div class="settings-row"><div><b>Raccourcis clavier</b><p>Espace : lecture/pause · Ctrl+→ / Ctrl+← : suivant/précédent · Maj+→ / Maj+← : ±10 s · Ctrl+↑/↓ : volume · L : liker · / : rechercher</p></div></div>
  </div>`);
  el.querySelector('#s-engine').value = setting('engine', 'auto');
  el.querySelector('#s-engine').onchange = async (e) => {
    await saveSettings({ engine: e.target.value });
    player.setEnginePreference();
    toast('Moteur de lecture mis à jour');
  };
  el.querySelector('#s-autoplay').onchange = (e) => saveSettings({ autoplay: e.target.checked });
  el.querySelector('#s-autolike').onchange = (e) => saveSettings({ autoLike: e.target.checked });
  el.querySelector('#s-lim')?.addEventListener('input', (e) => (el.querySelector('#s-lim-v').textContent = e.target.value));
  el.querySelector('#s-lim')?.addEventListener('change', (e) => {
    ls.set('boombox.storageLimitGB', Number(e.target.value));
    localStorage.setItem('boombox.storageLimit', String(offline.limitBytes()));
    offline.media.pruneCache(offline.limitBytes());
    offline.sync();
  });
  el.querySelector('#s-wifi')?.addEventListener('change', async (e) => (await saveSettings({ offlineWifiOnly: e.target.checked }), offline.sync()));
  el.querySelector('#s-offliked')?.addEventListener('change', async (e) => (await saveSettings({ offlineLiked: e.target.checked }), offline.sync()));
  el.querySelector('#s-dlclear')?.addEventListener('click', async () => {
    if (!(await confirmBox('Supprimer les téléchargements ?', 'Les fichiers audio seront effacés du téléphone.'))) return;
    await offline.media.deleteAll();
    offline.refreshSet();
    toast('Téléchargements supprimés');
    settings(el);
  });
  el.querySelector('#s-alerts')?.addEventListener('change', async (e) => {
    if (e.target.checked && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') {
        e.target.checked = false;
        return toast('Notifications refusées par le navigateur');
      }
    }
    await saveSettings({ releaseAlerts: e.target.checked });
    toast(e.target.checked ? 'Tu seras prévenu des nouvelles sorties' : 'Alertes de sorties désactivées');
  });
  // Pré-téléchargement des likes : état (nombre de titres prêts, place utilisée) et interrupteur
  if (!isNative) {
    const st = el.querySelector('#s-pre-status');
    const show = () => api('/api/predownload').then((p) => st && (st.textContent = `${p.cached} titre${p.cached > 1 ? 's' : ''} prêts sur l'ordinateur · ${(p.sizeMB / 1024).toFixed(1).replace('.', ',')} Go / ${Math.round(p.maxMB / 1024)} Go${p.queued ? ` · ${p.queued} en attente` : ''}`)).catch(() => {});
    show();
    el.querySelector('#s-predownload').onchange = async (e) => {
      await saveSettings({ predownload: e.target.checked });
      if (e.target.checked) await api('/api/predownload', { method: 'POST', body: { ids: state.library.liked.map((t) => t.id) } }).catch(() => {});
      else await api('/api/predownload', { method: 'POST', body: { ids: [] } }).catch(() => {});
      toast(e.target.checked ? 'Pré-téléchargement des likes activé' : 'Pré-téléchargement arrêté');
      show();
    };
  }
  // Démarrage automatique avec Windows (raccourci dans le dossier Démarrage, créé par le serveur)
  if (!isNative) {
    const sw = el.querySelector('#s-autostart');
    const win = el.querySelector('#s-autostart-win');
    api('/api/autostart').then((st) => {
      if (!st.supported) return sw.closest('.settings-row').remove();
      sw.checked = st.on;
      win.checked = st.openWindow;
    }).catch(() => {});
    const apply = async () => {
      try {
        const st = await api('/api/autostart', { method: 'POST', body: { on: sw.checked, openWindow: win.checked } });
        toast(st.on ? (st.openWindow ? 'Boombox s’ouvrira au démarrage de Windows' : 'Le serveur Boombox démarrera avec Windows') : 'Démarrage automatique désactivé');
      } catch (err) {
        toast('Impossible : ' + err.message);
      }
    };
    sw.onchange = apply;
    win.onchange = () => sw.checked && apply();
  }
  el.querySelector('#s-normalize').onchange = async (e) => {
    await saveSettings({ normalize: e.target.checked });
    player.setNormalize(e.target.checked);
    toast(e.target.checked ? 'Volume normalisé : tous les sons au même niveau' : 'Normalisation du volume désactivée');
  };
  el.querySelector('#s-automix').onchange = async (e) => {
    if (e.target.checked && player.engine?.name !== 'audio') {
      e.target.checked = false;
      return toast('L’automix nécessite la lecture audio directe (yt-dlp)');
    }
    await saveSettings({ automix: e.target.checked }); // le point du bouton ⋯ suit (événement « settings »)
    player.setAutomix(e.target.checked);
  };
  // Barre glissante du fondu (0 à 12 s, par pas d'une seconde)
  {
    const bar = el.querySelector('#s-xf');
    const label = el.querySelector('#s-xf-val');
    let val = Number(setting('crossfade', 0));
    const show = (v) => {
      bar.style.setProperty('--v', (v / 12) * 100 + '%');
      bar.setAttribute('aria-valuenow', v);
      label.textContent = v ? `${v} s` : 'Désactivé';
    };
    const fromEvent = (e) => {
      const r = bar.getBoundingClientRect();
      return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 12);
    };
    const commit = () => saveSettings({ crossfade: val });
    let drag = false;
    bar.addEventListener('pointerdown', (e) => {
      drag = true;
      bar.classList.add('drag');
      bar.setPointerCapture(e.pointerId);
      show((val = fromEvent(e)));
    });
    bar.addEventListener('pointermove', (e) => drag && show((val = fromEvent(e))));
    bar.addEventListener('pointerup', () => {
      drag = false;
      bar.classList.remove('drag');
      commit();
    });
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      show((val = Math.min(12, Math.max(0, val + (e.key === 'ArrowRight' ? 1 : -1)))));
      commit();
    });
    show(val);
  }
  el.querySelectorAll('[data-accent]').forEach((b) => (b.onclick = async () => {
    await saveSettings({ accent: b.dataset.accent, accentChosen: true });
    el.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === b));
  }));
  el.querySelector('#s-unban')?.addEventListener('click', async () => {
    await saveSettings({ banned: [] });
    toast('Tous les titres peuvent de nouveau être proposés');
    settings(el);
  });
  el.querySelector('#s-pname').onchange = async (e) => {
    await updateProfile(p.id, { name: e.target.value.trim().slice(0, 40) || p.name });
    document.dispatchEvent(new Event('profile-updated'));
    toast('Profil mis à jour');
  };
  el.querySelector('#s-pcolor').onchange = async (e) => {
    await updateProfile(p.id, { color: e.target.value });
    document.dispatchEvent(new Event('profile-updated'));
  };
  // Appareils liés à la bibliothèque (membres de l'espace) : liste et retrait
  const drawMembers = async () => {
    const box = el.querySelector('#s-members');
    if (!box) return;
    const list = await cloud.members().catch(() => []);
    box.innerHTML = list.length ? list.map((m) => String(html`<div class="member"><span class="member-ic">${icon(/iphone|android|téléphone|mobile/i.test(m.deviceName || '') ? 'phone' : 'devices', 20)}</span><div class="t-text"><b>${m.deviceName || 'Appareil'}${m.id === cloud.uid ? ' (cet appareil)' : ''}</b><span class="muted">${m.joinedAt ? `lié le ${m.joinedAt.toLocaleDateString('fr-FR')}` : ''}</span></div>${m.id === cloud.uid ? '' : html`<button class="outline-btn" data-unlink="${m.id}">Retirer</button>`}</div>`)).join('') : '<p class="muted">Aucun appareil</p>';
    box.querySelectorAll('[data-unlink]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('Retirer cet appareil ?', 'Il n’aura plus accès à ta bibliothèque. Pour le relier plus tard, il faudra rescanner le QR code.', 'Retirer'))) return;
      await cloud.removeMember(b.dataset.unlink);
      toast('Appareil retiré');
      drawMembers();
    }));
  };
  drawMembers();
  // Version de l'interface (mise à jour en ligne) et, dans l'appli, version installée
  (async () => {
    const v = await fetch('version.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    const app = isNative ? await window.Capacitor?.Plugins?.App?.getInfo?.().catch(() => null) : null;
    const box = el.querySelector('#s-version');
    if (box) box.textContent = `Interface ${v.version || 'inconnue'}${app ? ` · appli ${app.version} (${app.build})` : ''}`;
  })();
  el.querySelector('#s-switch').onclick = () => document.dispatchEvent(new Event('pick-profile'));
  el.querySelector('#s-pin').onclick = async () => (await setProfilePin(state.profile)) && settings(el);
  el.querySelector('#s-pin-off')?.addEventListener('click', async () => (await removeProfilePin(state.profile)) && settings(el));
  el.querySelector('#s-share').onchange = (e) =>
    social.setSharing(e.target.checked)
      .then(() => toast(e.target.checked ? 'Ton activité est visible par tes amis' : "Ton activité n'est plus partagée"))
      .catch((er) => ((e.target.checked = !e.target.checked), toast(/permission/i.test(er.code || er.message) ? 'Mets à jour les règles Firebase pour activer les amis' : er.message)));
  el.querySelector('#s-fcode').onclick = () => navigator.clipboard?.writeText(social.code || '').then(() => toast('Code ami copié'));
  el.querySelector('#s-dname').onchange = (e) => {
    state.device.name = e.target.value.trim() || state.device.name;
    ls.set('boombox.deviceName', state.device.name);
    sync.reconnect();
    toast('Nom de l’appareil enregistré');
  };
  el.querySelector('#s-export').onclick = async () => {
    const blob = new Blob([JSON.stringify(await exportLibrary())], { type: 'application/json' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `boombox-${state.profile.name}.json` }).click();
  };
  el.querySelector('#s-restore').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f || !(await confirmBox('Restaurer la sauvegarde ?', 'La bibliothèque actuelle de ce profil sera remplacée.', 'Restaurer'))) return;
    try {
      await restoreLibrary(JSON.parse(await f.text()));
      toast('Bibliothèque restaurée');
    } catch (err) {
      toast(err.message);
    }
  };
  const saveSpotify = async (clientId, clientSecret) => {
    try {
      const r = await api('/api/config/spotify', { method: 'POST', body: { clientId, clientSecret } });
      state.status.spotifyApi = r.spotifyApi;
      toast(r.spotifyApi ? 'Clé Spotify enregistrée' : 'Clé Spotify retirée');
      settings(el);
    } catch (e) {
      toast(e.message);
    }
  };
  el.querySelector('#s-spsave').onclick = () => {
    const id = el.querySelector('#s-spid').value.trim();
    const secret = el.querySelector('#s-spsecret').value.trim();
    if (!id || !secret) return toast('Renseigne le Client ID et le Client Secret');
    saveSpotify(id, secret);
  };
  el.querySelector('#s-spdel')?.addEventListener('click', () => saveSpotify('', ''));
  const saveGemini = async (key) => {
    try {
      const r = await api('/api/config/gemini', { method: 'POST', body: { key } });
      Object.assign(state.status, { ai: r.ai, aiModel: r.model });
      toast(r.ai ? 'Assistant IA activé' : 'Clé Gemini retirée');
      settings(el);
    } catch (e) {
      toast(e.message);
    }
  };
  el.querySelector('#s-gsave').onclick = () => {
    const k = el.querySelector('#s-gemini').value.trim();
    if (!k) return toast('Colle ta clé Gemini');
    saveGemini(k);
  };
  el.querySelector('#s-gdel')?.addEventListener('click', () => saveGemini(''));
  if (st.lan[0]) renderQr(el.querySelector('#s-qr'), st.lan[0]);
  cloud
    .inviteLink(st.lan[0] || location.origin)
    .then((link) => {
      renderQr(el.querySelector('#s-linkqr'), link);
      // QR pour l'appli mobile : ouvre directement Boombox (lien boombox://)
      const appLink = link.replace(/^https?:\/\/[^/]+\/#\/join/, 'boombox://join');
      const box = el.querySelector('#s-appqr');
      if (box) renderQr(box, appLink);
      el.querySelector('#s-copylink').onclick = () => navigator.clipboard.writeText(link).then(() => toast('Lien copié'));
    })
    .catch(() => (el.querySelector('#s-linkqr').innerHTML = '<p class="muted">Connexion Internet nécessaire</p>'));
}

// ======================= RÉCAP =======================
export async function stats(el, params, ctx) {
  const days = Number(params.days) || 30;
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const s = await getStats(days);
  if (!ctx.alive()) return;
  const maxA = s.topArtists[0]?.count || 1;
  el.innerHTML = String(html`<div class="page" style="max-width:960px">
    <h1 style="font-size:36px;margin-bottom:12px">Ton récap</h1>
    <div class="search-tabs">${[[7, '7 jours'], [30, '30 jours'], [365, '1 an'], [3650, 'Tout']].map(([d, l]) => html`<a class="chip ${d === days ? 'active' : ''}" href="#/stats?days=${d}">${l}</a>`)}</div>
    ${s.hasImported ? '' : html`<p class="muted" style="margin-top:-8px">Astuce : importe ton historique Spotify (Importer une playlist → Données Spotify) pour que ton récap inclue tes écoutes passées.</p>`}
    <div class="stat-grid"><div class="stat"><b>${s.minutes.toLocaleString('fr-FR')}</b>minutes d'écoute</div><div class="stat"><b>${s.plays}</b>écoutes</div><div class="stat"><b>${s.topArtists.length}</b>artistes dans ton top</div></div>
    ${s.plays ? html`<div class="search-grid" style="grid-template-columns:1fr 1fr">
      <div><div class="section-head"><h2>Top artistes</h2></div>${s.topArtists.map((a, i) => html`<a class="rank" href="${a.artist.id ? `#/artist/${a.artist.id}` : '#/stats'}"><span class="n">${i + 1}</span>${cover({ thumb: a.thumb }, 'round')}<div style="flex:1;min-width:0"><b class="ellipsis" style="display:block">${a.artist.name}</b><div class="muted" style="font-size:12px">${plural(a.count, 'écoute')}</div><div class="bar" style="width:${(a.count / maxA) * 100}%"></div></div></a>`)}</div>
      <div><div class="section-head"><h2>Top titres</h2></div>${trackList(s.topTracks.map((t) => t.track), { context: { type: 'top', name: 'Ton top' }, album: false })}</div>
    </div>` : html`<div class="empty"><p>Écoute un peu de musique, tes statistiques apparaîtront ici.</p></div>`}
  </div>`);
}

// ======================= HISTORIQUE =======================
export async function historyPage(el, _p, ctx) {
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const h = await getHistory(300);
  if (!ctx.alive()) return;
  el.innerHTML = String(html`<div class="page"><h1 style="font-size:32px;margin-bottom:16px">Écoutés récemment</h1>
    ${h.length ? trackList(h.map((t) => ({ ...t, addedAt: t.playedAt })), { context: { type: 'history', name: 'Historique' }, added: true }) : html`<p class="muted">Aucune écoute pour l'instant.</p>`}</div>`);
  el.querySelectorAll('.track-head .h-date').forEach((x) => (x.textContent = 'Écouté'));
}

// ======================= PAROLES =======================
export async function lyricsPage(el) {
  let cleanup = null;
  const render = async () => {
    cleanup?.();
    const t = player.track;
    if (!t) {
      el.innerHTML = '<div class="page"><div class="empty"><h2>Rien en cours de lecture</h2></div></div>';
      return;
    }
    el.innerHTML = String(html`<div class="lyrics-page"><div class="row-flex" style="margin-bottom:24px">${cover(t)}<div><b style="font-size:20px">${t.title}</b><div class="muted">${artistLinks(t)}</div></div></div><div id="lyr"></div></div>`);
    const c = await dominantColor(t.thumb);
    if (c) el.querySelector('.lyrics-page')?.style.setProperty('--lyr', c);
    cleanup = mountLyrics(el.querySelector('#lyr'), t);
  };
  render();
  return { onTrack: render, cleanup: () => cleanup?.() };
}
