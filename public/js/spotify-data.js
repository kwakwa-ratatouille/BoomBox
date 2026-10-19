// Import des données personnelles Spotify (« Télécharger vos données ») : artistes suivis, titres likés
// et historique d'écoute. On lit le .zip directement dans le navigateur.
import { html, plural, toast } from './ui.js';
import { api, followMany, likeMany, saveImported, state } from './state.js';

let jszip = null;
export function loadJsZip() {
  jszip ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/jszip.min.js';
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error('Impossible de charger le lecteur de .zip (connexion ?)'));
    document.head.appendChild(s);
  });
  return jszip;
}

// Lit un .zip ou des fichiers .json et en extrait les données utiles.
export async function readSpotifyFiles(files) {
  const jsons = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const JSZip = await loadJsZip();
      const zip = await JSZip.loadAsync(f);
      for (const entry of Object.values(zip.files)) {
        if (!entry.dir && /\.json$/i.test(entry.name)) jsons.push({ name: entry.name, text: () => entry.async('string') });
      }
    } else if (/\.json$/i.test(f.name)) jsons.push({ name: f.name, text: () => f.text() });
  }
  const out = { follows: [], liked: [], plays: [] };
  for (const j of jsons) {
    const base = j.name.split('/').pop();
    if (/^YourLibrary\.json$/i.test(base)) {
      const lib = JSON.parse(await j.text());
      out.follows.push(...(lib.artists || []).map((a) => ({ name: a.name })).filter((a) => a.name));
      out.liked.push(...(lib.tracks || []).map((t) => ({ title: t.track, artist: t.artist, album: t.album })).filter((t) => t.title));
    } else if (/^StreamingHistory.*\.json$/i.test(base) && !/podcast|video/i.test(base)) {
      // Données de compte (dernière année)
      for (const p of JSON.parse(await j.text())) {
        if (p.trackName && p.artistName) out.plays.push({ title: p.trackName, artist: p.artistName, ts: Date.parse(p.endTime.replace(' ', 'T') + ':00Z'), ms: p.msPlayed || 0 });
      }
    } else if (/^Streaming_History_Audio.*\.json$/i.test(base)) {
      // Historique étendu (toutes les années)
      for (const p of JSON.parse(await j.text())) {
        if (p.master_metadata_track_name && p.master_metadata_album_artist_name) {
          out.plays.push({ title: p.master_metadata_track_name, artist: p.master_metadata_album_artist_name, album: p.master_metadata_album_album_name, ts: Date.parse(p.ts), ms: p.ms_played || 0 });
        }
      }
    }
  }
  // Comme Spotify : une écoute compte à partir de 30 secondes
  out.plays = out.plays.filter((p) => p.ts && p.ms >= 30000);
  return out;
}

async function runMatch(items, kind, onProgress) {
  if (!items.length) return [];
  const job = await api('/api/match', { method: 'POST', body: { items, kind } });
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const j = await api(`/api/import/${job.id}`);
    onProgress(j.done, j.total);
    if (j.status === 'done') return j.results;
  }
}

// Interface : résumé des données trouvées, choix, import avec progression.
export async function spotifyDataFlow(box, files) {
  box.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  let data;
  try {
    data = await readSpotifyFiles(files);
  } catch (e) {
    box.innerHTML = String(html`<p style="color:var(--danger)">${e.message}</p>`);
    return;
  }
  if (!data.follows.length && !data.liked.length && !data.plays.length) {
    box.innerHTML = String(html`<p style="color:var(--danger)">Aucune donnée Spotify reconnue. Dépose le fichier .zip reçu par mail (ou YourLibrary.json / StreamingHistory*.json).</p>`);
    return;
  }
  const first = data.plays.length ? new Date(data.plays.reduce((m, p) => Math.min(m, p.ts), Infinity)) : null;
  const last = data.plays.length ? new Date(data.plays.reduce((m, p) => Math.max(m, p.ts), 0)) : null;
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  box.innerHTML = String(html`<div class="np-card">
    <h4>Données Spotify trouvées</h4>
    <label class="row-flex" style="margin:10px 0"><input type="checkbox" id="sd-follows" ${data.follows.length ? 'checked' : 'disabled'}> <b>${plural(data.follows.length, 'artiste suivi')}</b><span class="muted">→ abonnements Boombox</span></label>
    <label class="row-flex" style="margin:10px 0"><input type="checkbox" id="sd-liked" ${data.liked.length ? '' : 'disabled'}> <b>${plural(data.liked.length, 'titre liké')}</b><span class="muted">→ Titres likés (inutile si tu les as déjà importés avec Exportify)</span></label>
    <label class="row-flex" style="margin:10px 0"><input type="checkbox" id="sd-plays" ${data.plays.length ? 'checked' : 'disabled'}> <b>${plural(data.plays.length, 'écoute')}</b><span class="muted">${first ? `du ${fmt(first)} au ${fmt(last)} → ton récap` : ''}</span></label>
    <button class="btn primary" id="sd-go" style="margin-top:8px">Importer</button>
    <div id="sd-progress" style="margin-top:16px"></div>
  </div>`);

  box.querySelector('#sd-go').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const prog = box.querySelector('#sd-progress');
    const step = (label, done, total) => {
      const pct = total ? Math.round((done / total) * 100) : 100;
      prog.innerHTML = String(html`<b>${label}</b><div class="progress-bar"><div style="width:${pct}%"></div></div><span class="muted">${done} / ${total}</span>`);
    };
    const report = [];
    try {
      if (box.querySelector('#sd-follows').checked) {
        const found = await runMatch(data.follows, 'artist', (d, t) => step('Recherche de tes artistes…', d, t));
        const n = await followMany(found.filter(Boolean));
        report.push(`${plural(n, 'artiste')} suivi${n > 1 ? 's' : ''}`);
      }
      if (box.querySelector('#sd-liked').checked) {
        const found = await runMatch(data.liked, 'track', (d, t) => step('Recherche de tes titres likés…', d, t));
        const n = await likeMany(found.filter(Boolean));
        report.push(`${plural(n, 'titre liké')}`);
      }
      if (box.querySelector('#sd-plays').checked) {
        const entries = await buildHistory(data.plays, (d, t) => step('Analyse de ton historique…', d, t));
        await saveImported(entries);
        report.push(`${plural(data.plays.length, 'écoute')} ajoutée${data.plays.length > 1 ? 's' : ''} à ton récap`);
      }
      prog.innerHTML = String(html`<p><b>C'est fait !</b> ${report.join(' · ')}.</p><div class="row-flex"><a class="btn white" href="#/stats?days=365">Voir mon récap</a><a class="btn ghost" href="#/releases">Nouveautés de mes artistes</a></div>`);
    } catch (err) {
      prog.innerHTML = String(html`<p style="color:var(--danger)">${err.message}</p>`);
      e.currentTarget.disabled = false;
    }
  };
}

// Regroupe les écoutes par titre et par période. Seuls les 600 titres les plus écoutés sont
// recherchés sur YouTube (pour pouvoir les lire depuis le récap) : c'est bien plus rapide.
async function buildHistory(plays, onProgress) {
  const monthAgo = Date.now() - 31 * 86400e3;
  const pad = (n) => String(n).padStart(2, '0');
  const byTrack = new Map();
  for (const p of plays) {
    const key = `${p.artist.toLowerCase()}|${p.title.toLowerCase()}`;
    let e = byTrack.get(key);
    if (!e) {
      e = { title: p.title, artist: p.artist, album: p.album || null, total: 0, b: {}, s: {} };
      byTrack.set(key, e);
    }
    const d = new Date(p.ts);
    const bucket = p.ts >= monthAgo ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    e.b[bucket] = (e.b[bucket] || 0) + 1;
    e.s[bucket] = (e.s[bucket] || 0) + Math.round(p.ms / 1000);
    e.total++;
  }
  const list = [...byTrack.values()].sort((a, b) => b.total - a.total);
  const top = list.slice(0, 600);
  const found = await runMatch(top.map((e) => ({ title: e.title, artist: e.artist })), 'track', onProgress);
  return list.map((e, i) => {
    const t = found[i];
    return {
      id: t?.id || null,
      title: t?.title || e.title,
      artists: t?.artists?.length ? t.artists : [{ name: e.artist, id: null }],
      album: t?.album || (e.album ? { id: null, name: e.album } : null),
      thumb: t?.thumb || null,
      duration: t?.duration || 0,
      b: e.b,
      s: e.s,
    };
  });
}
