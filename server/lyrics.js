// Paroles depuis plusieurs sources, de la plus précise à la plus large :
// 1. lrclib.net (synchronisées)  2. NetEase Cloud Music (synchronisées, gros catalogue international)
// 3. YouTube Music / Musixmatch (liées à la vidéo exacte : idéal pour les sons peu connus)  4. lyrics.ovh
import { ytLyrics } from './yt.js';

const UA = 'Boombox/1.0 (usage personnel)';
const cache = new Map();

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/feat\.?.*$|ft\..*$/g, '')
    .replace(/[^a-z0-9]/g, '');

const cleanTitle = (t) =>
  String(t || '')
    .replace(/\s*[\(\[](official|clip|lyrics?|audio|video|visuali[sz]er|paroles|remaster(ed)?|radio edit|feat\.?|ft\.?)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+(official|clip).*$/i, '')
    .trim();

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(8000) });
  return r.ok ? r.json() : null;
}

async function fromLrclib({ title, artist, album, duration }) {
  const qs = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) qs.set('album_name', album);
  if (duration) qs.set('duration', String(duration));
  let d = await getJson(`https://lrclib.net/api/get?${qs}`).catch(() => null);
  if (!d?.syncedLyrics && !d?.plainLyrics) {
    const list = (await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`).catch(() => null)) || [];
    d = list.find((x) => x.syncedLyrics && (!duration || Math.abs(x.duration - duration) < 6)) || list.find((x) => x.syncedLyrics) || list[0] || null;
  }
  if (!d) return null;
  if (d.instrumental) return { instrumental: true, source: 'lrclib' };
  return { synced: d.syncedLyrics || null, plain: d.plainLyrics || null, source: 'lrclib' };
}

async function fromNetease({ title, artist, duration }) {
  const headers = { referer: 'https://music.163.com', 'user-agent': 'Mozilla/5.0' };
  const s = await getJson(`https://music.163.com/api/search/get?type=1&limit=10&s=${encodeURIComponent(`${artist} ${title}`)}`, headers);
  const songs = s?.result?.songs || [];
  const song = songs.find((x) => norm(x.name) === norm(title) && x.artists?.some((a) => norm(a.name) === norm(artist)) && (!duration || Math.abs(x.duration / 1000 - duration) < 8));
  if (!song) return null;
  const ly = await getJson(`https://music.163.com/api/song/lyric?id=${song.id}&lv=1`, headers);
  const lrc = (ly?.lrc?.lyric || '')
    .split('\n')
    .filter((l) => !/作词|作曲|编曲|制作人|混音|母带|和声|吉他|贝斯|鼓|录音|监制|出品|发行/.test(l))
    .join('\n');
  if (!/\[\d+:\d+/.test(lrc)) return null;
  return { synced: lrc, plain: null, source: 'NetEase' };
}

async function fromLyricsOvh({ title, artist }) {
  const d = await getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`).catch(() => null);
  return d?.lyrics ? { plain: d.lyrics.replace(/\r/g, '').trim(), source: 'lyrics.ovh' } : null;
}

export async function findLyrics({ videoId, title, artist, album, duration }) {
  const key = videoId || `${norm(artist)}|${norm(title)}`;
  if (cache.has(key)) return cache.get(key);
  const q = { title: cleanTitle(title), artist: String(artist || '').split(/,|&| x /i)[0].trim(), album, duration: Number(duration) || 0 };

  // Sources synchronisées en parallèle, puis repli sur les paroles simples
  const [lrclib, netease] = await Promise.all([fromLrclib(q).catch(() => null), fromNetease(q).catch(() => null)]);
  let result = null;
  if (lrclib?.instrumental) result = { instrumental: true, source: 'lrclib' };
  else if (lrclib?.synced) result = lrclib;
  else if (netease?.synced) result = { ...netease, plain: lrclib?.plain || null };
  else if (lrclib?.plain) result = lrclib;
  else {
    result = (videoId && (await ytLyrics(videoId))) || (await fromLyricsOvh(q).catch(() => null));
  }
  cache.set(key, result);
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
  return result;
}

// ---------- Recherche par paroles ----------
// On cherche la phrase sur YouTube Music (qui indexe souvent les paroles), puis on vérifie dans les vraies paroles
// des meilleurs résultats : on renvoie ceux qui contiennent bien la phrase, avec la ligne trouvée.
const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
export async function searchByLyrics(phrase, searchFn) {
  const qw = words(phrase);
  if (qw.length < 3) return [];
  const res = await searchFn(phrase);
  const cands = (res.songs || []).slice(0, 8);
  const timeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
  const checked = await Promise.all(cands.map(async (t) => {
    const ly = await timeout(findLyrics({ videoId: t.id, title: t.title, artist: t.artists?.[0]?.name || '', duration: t.duration }).catch(() => null), 9000);
    const text = ly?.synced ? ly.synced.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '') : ly?.plain || '';
    if (!text) return null;
    // Meilleure ligne (ou paire de lignes consécutives) : part des mots de la phrase qu'elle contient
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    // D'abord une ligne seule ; si la phrase est à cheval sur deux lignes, la paire de lignes
    const scoreOf = (chunk) => {
      const lw = new Set(words(chunk));
      return qw.filter((w) => lw.has(w)).length / qw.length;
    };
    let best = { score: 0, line: '' };
    for (const line of lines) {
      const score = scoreOf(line);
      if (score > best.score) best = { score, line };
    }
    if (best.score < 0.7) {
      for (let i = 0; i + 1 < lines.length; i++) {
        const score = scoreOf(`${lines[i]} ${lines[i + 1]}`);
        if (score > best.score) best = { score, line: `${lines[i]} / ${lines[i + 1]}` };
      }
    }
    return best.score >= 0.7 ? { track: t, line: best.line, score: best.score } : null;
  }));
  return checked.filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 5);
}