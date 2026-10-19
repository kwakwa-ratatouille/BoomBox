// Détection de l'appli mobile (Capacitor) et accès au « serveur embarqué » (local-api.bundle.js).
// Sur PC (navigateur), rien de tout ça n'est utilisé : l'interface parle au serveur Node.
export const isNative = !!window.Capacitor?.isNativePlatform?.();
export const platform = window.Capacitor?.getPlatform?.() || 'web';

let local = null;
export function localApi() {
  local ??= import('./local-api.bundle.js');
  return local;
}

// Plugin natif Boombox (iOS) : date d'expiration de la signature SideStore, version de l'appli
export async function nativeInfo() {
  try {
    return (await window.Capacitor?.Plugins?.BoomboxNative?.getInfo?.()) || null;
  } catch {
    return null;
  }
}
