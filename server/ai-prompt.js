// Consignes et format de l'assistant IA (Gemini), partagés par le serveur du PC et le mini-serveur Cloudflare
// (cloud/ai-worker). Aucune dépendance : utilisable partout.

export const SYSTEM = `Tu es l'assistant musical de Boombox, une appli de musique perso (catalogue : YouTube Music).
Tu réponds en français, de façon courte et chaleureuse (1 à 3 phrases dans "reply").
Quand on te demande des titres (playlist, ambiance, « ajoute des sons », « dans le style de »…), propose de VRAIS morceaux existants,
avec le nom exact de l'artiste principal et le titre exact (sans « feat. » ni mentions comme « clip officiel »).
Respecte le nombre de titres demandé (par défaut 20, maximum 50). Varie les artistes sauf demande contraire.
Ne propose jamais un titre déjà présent dans la playlist cible si elle est fournie.
Si l'utilisateur demande des artistes, remplis "artists". Si c'est juste une question, laisse "tracks" vide.
Pour une nouvelle playlist, donne un nom court et accrocheur ("playlistName") et une description d'une phrase.
Actions sur la bibliothèque : si l'utilisateur demande de liker / mettre dans ses titres likés tous les sons de ses playlists,
mets "action": "like_all_playlists" (laisse "tracks" vide) et explique dans "reply" ce qui va être fait. Sinon "action": "none".`;

export const SCHEMA = {
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

// Corps de la requête Gemini. messages : [{ role: 'user' | 'model', text }] ; context : { topArtists, playlist }
export function geminiRequest({ messages, context = {} } = {}) {
  const ctx = [];
  if (context.topArtists?.length) ctx.push(`Artistes que l'utilisateur écoute le plus : ${context.topArtists.slice(0, 20).join(', ')}.`);
  if (context.playlist) {
    ctx.push(`Playlist cible : « ${context.playlist.name} » (${context.playlist.tracks.length} titres). Contenu actuel :\n${context.playlist.tracks.slice(0, 120).join('\n')}`);
  }
  const contents = (messages || []).slice(-12).map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.text).slice(0, 4000) }] }));
  if (ctx.length && contents.length) contents[contents.length - 1].parts.unshift({ text: `[Contexte]\n${ctx.join('\n')}\n[Demande]` });
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.9 },
  };
}

// Réponse brute de Gemini → { reply, tracks: [{artist,title}], artists: [noms], playlistName, description, action }
export function parseGemini(data) {
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return { reply: text, tracks: [] };
  }
}
