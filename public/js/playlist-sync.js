// Synchronisation continue des playlists importées (Spotify, Deezer, YouTube).
// Quand elle est activée sur une playlist, Boombox relit la playlist d'origine au démarrage puis toutes les
// 30 minutes (tant que l'appli est ouverte) et ajoute les nouveaux titres, avec leur date d'ajout d'origine.
// Seuls les ajouts sont repris : un titre retiré côté Boombox ne revient pas, et rien n'est supprimé.
// La playlist d'origine doit être publique (ou accessible par lien) : Boombox n'a pas accès à ton compte.
import { state, api, addToPlaylist, updatePlaylist, addReport } from './state.js';
import { toast, plural, promptText } from './ui.js';

const EVERY = 30 * 60e3;
let running = false;

export const canSync = (p) => !!p?.source?.url && /spotify|deezer|youtu/i.test(p.source.url);

export async function syncPlaylistNow(p, { quiet = false } = {}) {
  const have = p.tracks.map((t) => ({ title: t.title, artist: t.artists?.[0]?.name || '' }));
  const r = await api('/api/sync', { method: 'POST', body: { url: p.source.url, seen: p.syncSeen || null, have } });
  const ids = new Set(p.tracks.map((t) => t.id));
  const fresh = (r.added || []).filter((t) => !ids.has(t.id) && ids.add(t.id));
  if (fresh.length) await addToPlaylist(p.id, fresh);
  const missing = (r.unmatched || []).length;
  // Rapport détaillé (consultable depuis la playlist et dans « Rapports d'import »)
  addReport({
    type: 'sync', playlistId: p.id, name: p.name, source: p.source.platform || 'Source', url: p.source.url,
    sourceCount: r.sourceCount ?? (r.keys || []).length, hereCount: p.tracks.length + fresh.length, alreadyThere: r.alreadyThere ?? null,
    added: fresh.map((t) => `${(t.artists || []).map((a) => a.name).join(', ')} - ${t.title}${t.addedBy ? ` (ajouté par ${t.addedBy})` : ''}`),
    missing: (r.unmatched || []).map((m) => `${m} — introuvable sur YouTube`),
    skipped: r.skipped || 0,
  }).catch(() => {});
  await updatePlaylist(p.id, { syncSeen: r.keys || [], syncedAt: Date.now(), syncSourceCount: (r.keys || []).length, syncAdded: fresh.length, syncMissing: r.unmatched || [] });
  const src = p.source.platform || 'la playlist d’origine';
  if (fresh.length) toast(`« ${p.name} » : ${plural(fresh.length, 'nouveau titre')} ajouté${fresh.length > 1 ? 's' : ''} depuis ${src}${missing ? ` (${missing} introuvable${missing > 1 ? 's' : ''} sur YouTube)` : ''}`, { timeout: 6000 });
  else if (!quiet) toast(`« ${p.name} » est à jour avec ${src} (${(r.keys || []).length} titres là-bas)${missing ? ` · ${missing} introuvable${missing > 1 ? 's' : ''} sur YouTube` : ''}`, { timeout: 6000 });
  return fresh.length;
}

export async function setPlaylistSync(p, on) {
  await updatePlaylist(p.id, { sync: on, ...(on ? {} : { syncSeen: null }) });
  if (!on) return toast('Synchronisation désactivée');
  toast(`Synchronisation activée : les nouveaux titres ajoutés sur ${p.source.platform || 'la playlist d’origine'} arriveront tout seuls`);
  try {
    await syncPlaylistNow({ ...p, syncSeen: null }, { quiet: false });
  } catch (e) {
    toast('Synchronisation impossible pour le moment : ' + e.message);
  }
}

// Playlist importée d'un fichier (CSV…) ou créée à la main : on la relie à une playlist Spotify / Deezer / YouTube
// (lien collé), puis on active la synchro. Les titres déjà présents ne sont pas ajoutés en double.
export async function linkSource(p) {
  const url = await promptText('Lier à une playlist en ligne', { placeholder: 'Colle ici le lien de la playlist Spotify, Deezer ou YouTube', value: p.source?.url || '', label: 'Lier et mettre à jour', multiline: true });
  if (!url || url === 'Annuler') return;
  const m = url.match(/spotify|deezer|youtu/i);
  if (!/^https?:\/\//.test(url.trim()) || !m) return toast('Colle le lien d’une playlist Spotify, Deezer ou YouTube');
  const platform = { spotify: 'Spotify', deezer: 'Deezer', youtu: 'YouTube' }[m[0].toLowerCase()];
  const source = { ...(p.source || {}), platform, url: url.trim() };
  await updatePlaylist(p.id, { source, syncSeen: null });
  await setPlaylistSync({ ...p, source }, true);
}

async function syncAll() {
  if (running || !state.library?.playlists) return;
  running = true;
  try {
    for (const p of state.library.playlists) {
      if (!p.sync || !canSync(p) || Date.now() - (p.syncedAt || 0) < EVERY - 60e3) continue;
      await syncPlaylistNow(p, { quiet: true }).catch(() => {});
    }
  } finally {
    running = false;
  }
}

export function startPlaylistSync() {
  setTimeout(syncAll, 20e3);
  setInterval(syncAll, EVERY / 3);
}
