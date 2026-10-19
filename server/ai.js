// Assistant IA (Google Gemini, offre gratuite) : crée des playlists, complète une playlist, recommande des artistes.
// Gemini propose des titres (artiste + titre), puis on les retrouve sur YouTube Music.
import { matchTrack, search } from './yt.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

// Choisit le meilleur modèle « flash » disponible pour cette clé (rapide et inclus dans l'offre gratuite).
export async function pickModel(key) {
  const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(/key not valid|API_KEY_INVALID/i.test(j.error?.message || '') ? 'Clé Gemini invalide : vérifie que tu l’as copiée en entier.' : j.error?.message || `Clé refusée par Google (${r.status})`);
  }
  const { models = [] } = await r.json();
  const usable = models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  const versioned = usable
    .filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n))
    .sort((a, b) => parseFloat(b.match(/\d+(\.\d+)?/)[0]) - parseFloat(a.match(/\d+(\.\d+)?/)[0]));
  return versioned[0] || usable.find((n) => n === 'gemini-flash-latest') || usable.find((n) => /flash/.test(n) && !/lite|image|tts|audio|live/.test(n)) || usable[0];
}

const SYSTEM = `Tu es l'assistant musical de Boombox, une appli de musique perso (catalogue : YouTube Music).
Tu réponds en français, de façon courte et chaleureuse (1 à 3 phrases dans "reply").
Quand on te demande des titres (playlist, ambiance, « ajoute des sons », « dans le style de »…), propose de VRAIS morceaux existants,
avec le nom exact de l'artiste principal et le titre exact (sans « feat. » ni mentions comme « clip officiel »).
Respecte le nombre de titres demandé (par défaut 20, maximum 50). Varie les artistes sauf demande contraire.
Ne propose jamais un titre déjà présent dans la playlist cible si elle est fournie.
Si l'utilisateur demande des artistes, remplis "artists". Si c'est juste une question, laisse "tracks" vide.
Pour une nouvelle playlist, donne un nom court et accrocheur ("playlistName") et une description d'une phrase.
Actions sur la bibliothèque : si l'utilisateur demande de liker / mettre dans ses titres likés tous les sons de ses playlists,
mets "action": "like_all_playlists" (laisse "tracks" vide) et explique dans "reply" ce qui va être fait. Sinon "action": "none".`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    playlistName: { type: 'STRING' },
    description: { type: 'STRING' },
    tracks: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { artist: { type: 'STRING' }, title: { type: 'STRING' } }, required: ['artist', 'title'] },
    },
    artists: { type: 'ARRAY', items: { type: 'STRING' } },
    action: { type: 'STRING', enum: ['none', 'like_all_playlists'] },
  },
  required: ['reply', 'tracks'],
};

// messages : [{ role: 'user' | 'model', text }] ; context : { topArtists, playlist: { name, tracks: ["Artiste - Titre"] } }
export async function askAi(cfg, { messages, context = {} }) {
  if (!cfg.geminiApiKey) throw new Error("Ajoute ta clé Gemini dans Paramètres → Assistant IA.");
  const model = cfg.geminiModel || 'gemini-flash-latest';
  const ctx = [];
  if (context.topArtists?.length) ctx.push(`Artistes que l'utilisateur écoute le plus : ${context.topArtists.slice(0, 20).join(', ')}.`);
  if (context.playlist) {
    ctx.push(`Playlist cible : « ${context.playlist.name} » (${context.playlist.tracks.length} titres). Contenu actuel :\n${context.playlist.tracks.slice(0, 120).join('\n')}`);
  }
  const contents = (messages || []).slice(-12).map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.text).slice(0, 4000) }] }));
  if (ctx.length && contents.length) contents[contents.length - 1].parts.unshift({ text: `[Contexte]\n${ctx.join('\n')}\n[Demande]` });

  const r = await fetch(`${API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.geminiApiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.9 },
    }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) throw new Error('Limite gratuite de Gemini atteinte pour le moment : réessaie dans une minute.');
    throw new Error(j.error?.message || `Erreur Gemini (${r.status})`);
  }
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    out = { reply: text, tracks: [] };
  }

  // Recherche de chaque titre proposé sur YouTube Music (dans l'ordre proposé)
  const wanted = (out.tracks || []).slice(0, 50);
  const found = new Array(wanted.length);
  const missing = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < wanted.length) {
        const i = cursor++;
        const w = wanted[i];
        try {
          found[i] = await matchTrack({ title: w.title, artist: w.artist });
        } catch {}
        if (!found[i]) missing.push(`${w.artist} - ${w.title}`);
      }
    }),
  );
  // Artistes recommandés : on retrouve leur page YouTube Music
  const artists = (
    await Promise.all(
      (out.artists || []).slice(0, 12).map(async (name) => {
        try {
          const { items } = await search(name, 'artist');
          return items[0] || null;
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);

  const seen = new Set();
  return {
    reply: out.reply || '',
    action: out.action || 'none',
    playlistName: out.playlistName || '',
    description: out.description || '',
    artists,
    tracks: found.filter((t) => t && !seen.has(t.id) && seen.add(t.id)),
    missing,
  };
}
