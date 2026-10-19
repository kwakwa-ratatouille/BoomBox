// Découverte : nouveaux artistes et nouveaux sons, en évitant ce que l'utilisateur connaît déjà.
// - « Pour toi » : artistes similaires à tes artistes de référence + radios de leurs titres phares
// - Par style : titres tirés de playlists YouTube Music du style choisi
import { artist, radio, search, ytPlaylist } from './yt.js';

// Requêtes précises par style (évite les résultats hors sujet)
const GENRE_QUERIES = {
  'Rap français': 'rap français hits du moment', 'Rap US': 'hip hop us hits', Pop: 'pop hits internationaux', 'R&B': 'r&b hits',
  Afro: 'afrobeats hits', 'Électro': 'electro dance hits', House: 'house music hits', Rock: 'rock hits', 'Indé': 'indie pop hits',
  Drill: 'drill hits', Reggaeton: 'reggaeton hits', 'K-pop': 'k-pop hits', 'Lo-fi': 'lofi hip hop', Jazz: 'jazz essentials',
  'Variété française': 'variété française hits', 'Années 2000': 'hits années 2000',
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const settle = (promises) => Promise.allSettled(promises).then((r) => r.filter((x) => x.status === 'fulfilled').map((x) => x.value));

// seeds : [{ id, name }] artistes de référence ; known : noms d'artistes déjà connus ; genre : style choisi (ou vide)
export async function discover({ seeds = [], known = [], genre = '' }) {
  const knownSet = new Set([...known, ...seeds.map((s) => s.name)].map(norm));
  const isNew = (t) => t?.artists?.length && !t.artists.some((a) => knownSet.has(norm(a.name)));
  const tracks = [];
  const artists = new Map();
  const addTrack = (t) => {
    if (isNew(t) && !tracks.some((x) => x.id === t.id || (norm(x.title) === norm(t.title) && norm(x.artists[0]?.name) === norm(t.artists[0]?.name)))) tracks.push(t);
  };

  if (genre) {
    const query = GENRE_QUERIES[genre] || `${genre} hits`;
    const { items } = await search(query, 'playlist');
    // Les playlists officielles YouTube Music (RDCLAK…) d'abord : plus fiables que celles des utilisateurs
    const lists = await settle(items.sort((a, b) => /^RDCLAK/.test(b.id) - /^RDCLAK/.test(a.id)).slice(0, 4).map((p) => ytPlaylist(p.id, 60)));
    for (const pl of lists) for (const t of pl.tracks) addTrack(t);
    // Nouveaux artistes : ceux qui reviennent le plus dans ces titres
    const count = new Map();
    for (const t of tracks) {
      const a = t.artists[0];
      if (a?.id) count.set(a.id, { a, n: (count.get(a.id)?.n || 0) + 1 });
    }
    const top = [...count.values()].sort((x, y) => y.n - x.n).slice(0, 16);
    const pages = await settle(top.map((x) => artist(x.a.id, { light: true })));
    for (const p of pages) artists.set(p.id, { type: 'artist', id: p.id, name: p.name, thumb: p.thumb, subscribers: p.subscribers });
  } else {
    const picked = shuffle(seeds.filter((s) => s.id)).slice(0, 8);
    const pages = await settle(picked.map((s) => artist(s.id, { light: true })));
    // Artistes similaires (section « Vous aimerez peut-être aussi »)
    for (const p of pages) {
      for (const s of p.sections) for (const it of s.items) if (it.type === 'artist' && !knownSet.has(norm(it.name)) && !artists.has(it.id)) artists.set(it.id, it);
    }
    // Sons : radios des titres phares des artistes de référence et de quelques artistes similaires
    const similar = shuffle([...artists.values()]).slice(0, 6);
    const simPages = await settle(similar.map((a) => artist(a.id, { light: true })));
    const seedTracks = [...pages, ...simPages].map((p) => p.topTracks[Math.floor(Math.random() * Math.min(3, p.topTracks.length))]).filter(Boolean);
    for (const p of simPages) p.topTracks.slice(0, 3).forEach(addTrack);
    const radios = await settle(seedTracks.slice(0, 10).map((t) => radio(t.id)));
    for (const r of radios) r.forEach(addTrack);
  }
  return { artists: shuffle([...artists.values()]).slice(0, 18), tracks: shuffle(tracks).slice(0, 60) };
}
