// randomBytes(n).toString('base64url') pour les identifiants de tâches
export function randomBytes(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return { toString: () => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
}
export default { randomBytes };