// Assistant IA (Google Gemini, offre gratuite) : crée des playlists, complète une playlist, recommande des artistes.
// Gemini propose des titres (artiste + titre), puis on les retrouve sur YouTube Music.
// Consignes et format communs avec le mini-serveur Cloudflare : voir ai-prompt.js.
import { matchTrack, search } from './yt.js';
import { geminiRequest, parseGemini } from './ai-prompt.js';

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
  // Les modèles « lite » répondent en quelques secondes (les « flash » récents réfléchissent parfois plus d'une minute)
  const lite = usable
    .filter((n) => /^gemini-\d+(\.\d+)?-flash-lite$/.test(n))
    .sort((a, b) => parseFloat(b.match(/\d+(\.\d+)?/)[0]) - parseFloat(a.match(/\d+(\.\d+)?/)[0]));
  if (lite[0]) return lite[0];
  const versioned = usable
    .filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n))
    .sort((a, b) => parseFloat(b.match(/\d+(\.\d+)?/)[0]) - parseFloat(a.match(/\d+(\.\d+)?/)[0]));
  return versioned[0] || usable.find((n) => n === 'gemini-flash-latest') || usable.find((n) => /flash/.test(n) && !/lite|image|tts|audio|live/.test(n)) || usable[0];
}

// messages : [{ role: 'user' | 'model', text }] ; context : { topArtists, playlist: { name, tracks: ["Artiste - Titre"] } }
export async function askAi(cfg, { messages, context = {} }) {
  if (!cfg.geminiApiKey) throw new Error("Ajoute ta clé Gemini dans Paramètres → Assistant IA.");
  const model = cfg.geminiModel || 'gemini-flash-latest';
  const r = await fetch(`${API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.geminiApiKey },
    body: JSON.stringify(geminiRequest({ messages, context })),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) throw new Error('Limite gratuite de Gemini atteinte pour le moment : réessaie dans une minute.');
    throw new Error(j.error?.message || `Erreur Gemini (${r.status})`);
  }
  return resolveAiResult(parseGemini(await r.json()));
}

// Titres et artistes proposés par l'IA → retrouvés sur YouTube Music (dans l'ordre proposé)
export async function resolveAiResult(out) {
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
