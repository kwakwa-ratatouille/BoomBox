// Mix du jour : jusqu'à 6 playlists générées chaque jour à partir de tes artistes les plus écoutés,
// likés et suivis. Chaque mix mélange tes titres de l'artiste et des titres similaires (radio).
// Le résultat est gardé pour la journée (un nouveau tirage chaque jour).
import { state, api, ls, getStats } from './state.js';

const COLORS = ['#e13300', '#1e3264', '#8d67ab', '#148a08', '#bc5900', '#e8115b'];
const today = () => new Date().toISOString().slice(0, 10);

// Petit générateur pseudo-aléatoire déterministe (même tirage toute la journée)
function seeded(seed) {
  let s = 0;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export let lastMixes = [];
export async function dailyMixes() {
  const key = `boombox.dailymix.${state.profile.id}.${today()}`;
  const cached = ls.get(key);
  if (cached) return (lastMixes = cached);
  // Ménage : on supprime les mix des jours précédents
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('boombox.dailymix.') && k !== key).forEach((k) => localStorage.removeItem(k));
  } catch {}

  // Artistes de référence, pondérés : écoutes récentes > likes > abonnements
  const weight = new Map();
  const add = (a, w, track) => {
    if (!a?.name) return;
    const k = a.name.toLowerCase();
    const e = weight.get(k) || { artist: a, w: 0, tracks: [] };
    e.w += w;
    if (track && !e.tracks.some((t) => t.id === track.id)) e.tracks.push(track);
    if (!e.artist.id && a.id) e.artist = a;
    weight.set(k, e);
  };
  const stats = await getStats(60).catch(() => null);
  stats?.topArtists.forEach((x) => add(x.artist, x.count * 2));
  stats?.topTracks.forEach((x) => add(x.track.artists?.[0], 1, x.track));
  state.library.liked.forEach((t) => add(t.artists?.[0], 1, t));
  state.library.follows.forEach((f) => add({ name: f.name, id: f.id }, 3));
  const rnd = seeded(today() + state.profile.id);
  const ranked = [...weight.values()].sort((a, b) => b.w - a.w).slice(0, 12);
  // On garde 6 artistes « têtes de mix », en variant d'un jour à l'autre parmi les 12 premiers
  const heads = ranked.map((e) => ({ e, r: e.w * (0.6 + rnd()) })).sort((a, b) => b.r - a.r).slice(0, 6).map((x) => x.e);

  const mixes = [];
  await Promise.all(
    heads.map(async (h, i) => {
      try {
        let seedTrack = h.tracks[Math.floor(rnd() * h.tracks.length)];
        if (!seedTrack && h.artist.id) seedTrack = (await api(`/api/artist/${h.artist.id}`)).topTracks[0];
        if (!seedTrack) return;
        const radio = await api(`/api/radio/${seedTrack.id}`);
        const own = h.tracks.slice(0, 6);
        const pool = [...own, ...radio.filter((t) => !own.some((o) => o.id === t.id))];
        // Mélange léger (les titres de l'artiste restent répartis dans le mix)
        const tracks = pool.map((t) => ({ t, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.t).slice(0, 30);
        const names = [...new Set(tracks.flatMap((t) => t.artists?.[0]?.name ? [t.artists[0].name] : []))];
        mixes[i] = {
          id: `mix-${i + 1}`,
          name: `Mix du jour ${i + 1}`,
          desc: `${[h.artist.name, ...names.filter((n) => n !== h.artist.name)].slice(0, 3).join(', ')} et plus`,
          color: COLORS[i % COLORS.length],
          thumb: seedTrack.thumb,
          tracks,
        };
      } catch {}
    }),
  );
  const out = mixes.filter(Boolean).map((m, i) => ({ ...m, name: `Mix du jour ${i + 1}` }));
  if (out.length) ls.set(key, out);
  return (lastMixes = out);
}
