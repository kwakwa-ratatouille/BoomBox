// Commandes « Dis Siri » (et Raccourcis iPhone, Google Assistant…) : des liens boombox:// que l'appli exécute.
//   boombox://play?q=Werenoi Diamant noir     → lance le son (titre et/ou artiste)
//   boombox://playlist?name=Culture G         → lance une de mes playlists (« titres likés » marche aussi)
//   boombox://artist?name=Werenoi             → lance les titres phares de l'artiste
//   boombox://jam                             → lance une party
//   boombox://control?a=pause|play|toggle|next|prev|restart
import { state, api } from './state.js';
import { player, ctl } from './player.js';
import { sync } from './sync.js';
import { toast } from './ui.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export const isVoiceLink = (url) => /^boombox:\/\/(play|playlist|artist|jam|control)\b/i.test(String(url));

export async function runVoiceLink(url) {
  const u = new URL(String(url).replace(/^boombox:\/\//i, 'https://boombox.app/'));
  const what = u.pathname.replace(/^\/+/, '').toLowerCase() || u.hostname;
  const q = (u.searchParams.get('q') || u.searchParams.get('name') || u.searchParams.get('a') || '').trim();
  toast(`🎙️ ${q || what}…`, { timeout: 2500 }); // la commande est bien arrivée
  try {
    if (what === 'control') return control(q);
    if (what === 'jam') {
      if (!sync.jam) await sync.jamCreate();
      location.hash = '#/jam';
      return;
    }
    if (what === 'playlist') return playPlaylist(q);
    if (what === 'artist') return playArtist(q);
    if (what === 'play') return playAnything(q);
  } catch (e) {
    toast(`Commande impossible : ${e.message}`);
  }
}

function control(a) {
  const act = norm(a);
  if (/pause|stop/.test(act)) return ctl.pause();
  if (/^(play|lecture|reprendre)/.test(act)) return ctl.play();
  if (/toggle/.test(act)) return ctl.toggle();
  if (/next|suivant/.test(act)) return ctl.next();
  if (/prev|precedent/.test(act)) return ctl.prev();
  if (/restart|debut|recommencer/.test(act)) return ctl.seek(0);
}

function findPlaylist(name) {
  const n = norm(name);
  if (!n) return null;
  const lists = state.library.playlists;
  return lists.find((p) => norm(p.name) === n) || lists.find((p) => norm(p.name).startsWith(n)) || lists.find((p) => norm(p.name).includes(n) || n.includes(norm(p.name)));
}

function playPlaylist(name) {
  if (/^(titres? likes?|mes likes|likes|coups? de coeur|favoris)$/.test(norm(name))) {
    if (!state.library.liked.length) return toast('Aucun titre liké');
    return ctl.playList(state.library.liked, 0, { type: 'liked', id: 'liked', name: 'Titres likés' });
  }
  const p = findPlaylist(name);
  if (!p) return toast(`Playlist « ${name} » introuvable`);
  if (!p.tracks.length) return toast(`« ${p.name} » est vide`);
  ctl.playList(p.tracks, 0, { type: 'playlist', id: p.id, name: p.name });
  toast(`▶ ${p.name}`);
}

async function playArtist(name) {
  // Artiste suivi : son id est déjà connu, pas de recherche (démarrage plus rapide)
  const fol = (state.library.follows || []).find((f) => norm(f.name) === norm(name));
  const a = fol || (await api(`/api/search?q=${encodeURIComponent(name)}&type=artist`)).items?.[0];
  if (!a) return toast(`Artiste « ${name} » introuvable`);
  const full = await api(`/api/artist/${a.id}`);
  if (!full.topTracks?.length) return toast(`Pas de titres pour ${a.name}`);
  ctl.playList(full.topTracks, 0, { type: 'artist', id: a.id, name: full.name || a.name });
  toast(`▶ ${full.name || a.name}`);
}

// « Lance <quelque chose> » : une de mes playlists si le nom correspond, sinon le meilleur résultat (son ou artiste)
async function playAnything(q) {
  if (!q) return player.paused ? ctl.play() : null;
  // Son déjà connu (liké ou écouté) : lancé tout de suite, sans recherche. « Titre|Artiste » vient de Siri.
  const [title, artist] = q.split('|');
  const known = [...(state.library.liked || []), ...(state.library.history || [])].find((t) => norm(t.title) === norm(title) && (!artist || norm((t.artists || [])[0]?.name) === norm(artist)));
  if (known) return ctl.playTrack(known), toast(`▶ ${known.title}`);
  q = q.replace('|', ' ');
  const p = findPlaylist(q);
  if (p && norm(p.name).length > 2 && norm(q) === norm(p.name)) return playPlaylist(q);
  const r = await api(`/api/search?q=${encodeURIComponent(q)}&type=all`);
  const top = r.top;
  if (top?.type === 'artist') return playArtist(top.name);
  const song = top && (top.type === 'song' || top.type === 'video') ? top : r.songs?.[0];
  if (!song) return toast(`Rien trouvé pour « ${q} »`);
  const { type: _t, ...t } = song;
  ctl.playTrack(t);
  toast(`▶ ${t.title}`);
}
