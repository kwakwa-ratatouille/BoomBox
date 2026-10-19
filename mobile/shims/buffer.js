// Buffer minimal (utilisé pour l'authentification Spotify)
export const Buffer = { from: (s) => ({ toString: () => btoa(unescape(encodeURIComponent(s))) }) };