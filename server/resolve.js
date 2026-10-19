// Transforme ce qu'un invité envoie (lien Spotify / Deezer / YouTube / Apple Music, ou texte « artiste titre »)
// en titre YouTube Music jouable.
import { matchTrack, radio, search } from './yt.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { text: await r.text(), url: r.url };
}

export async function resolveInput(input) {
  let s = String(input || '').trim().slice(0, 500);
  if (!s) throw new Error('Rien à chercher');
  // Un lien peut être noyé dans un texte partagé (« Écoute ce son sur Spotify : https://… »)
  const link = s.match(/https?:\/\/\S+/)?.[0];
  if (link) {
    let url = link;
    if (/spotify\.link|page\.link|link\.deezer|dzr\.page|youtu\.be/i.test(url) && !/youtu\.be\/[\w-]{11}/.test(url)) url = (await fetchText(url)).url;
    const u = new URL(url);

    if (/spotify\.com$/.test(u.hostname)) {
      const id = u.pathname.match(/track\/([A-Za-z0-9]+)/)?.[1];
      if (!id) throw new Error('Envoie un lien de titre Spotify (pas une playlist)');
      const { text } = await fetchText(`https://open.spotify.com/embed/track/${id}`);
      const e = JSON.parse(text.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)[1]).props.pageProps.state.data.entity;
      return matchTrack({ title: e.name || e.title, artist: (e.artists || []).map((a) => a.name).join(' '), duration: Math.round((e.duration || 0) / 1000) });
    }
    if (/deezer\.com$/.test(u.hostname)) {
      const id = u.pathname.match(/track\/(\d+)/)?.[1];
      if (!id) throw new Error('Envoie un lien de titre Deezer');
      const t = await fetch(`https://api.deezer.com/track/${id}`).then((r) => r.json());
      if (t.error) throw new Error('Titre Deezer introuvable');
      return matchTrack({ title: t.title, artist: t.artist?.name, duration: t.duration });
    }
    if (/youtube\.com$|youtu\.be$/.test(u.hostname)) {
      const id = u.searchParams.get('v') || (u.hostname === 'youtu.be' ? u.pathname.slice(1, 12) : u.pathname.match(/shorts\/([\w-]{11})/)?.[1]);
      if (!id) throw new Error('Lien YouTube non reconnu');
      // Le premier élément de la « radio » d'une vidéo est la vidéo elle-même, avec ses infos
      const list = await radio(id);
      return list.find((t) => t.id === id) || { id, title: 'Titre YouTube', artists: [], album: null, duration: 0, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
    }
    if (/music\.apple\.com$/.test(u.hostname)) {
      const { text } = await fetchText(url);
      const og = text.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || '';
      // « Titre par Artiste sur Apple Music » / « Titre by Artist on Apple Music »
      const m = og.replace(/&amp;/g, '&').match(/^(.*?)\s+(?:par|by|de)\s+(.*?)(?:\s+(?:sur|on)\s+Apple Music)?$/i);
      if (m) return matchTrack({ title: m[1], artist: m[2] });
      throw new Error('Lien Apple Music non reconnu');
    }
    throw new Error('Lien non reconnu : Spotify, Deezer, YouTube ou Apple Music');
  }
  // Texte libre : on prend le meilleur résultat de recherche
  const { items } = await search(s, 'song');
  const best = items.find((i) => i.type === 'song') || items[0];
  if (!best) return null;
  const { type, ...track } = best;
  return track;
}
