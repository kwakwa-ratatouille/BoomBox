// Remplace « fs » de Node dans l'appli : petits fichiers stockés dans localStorage (cache des correspondances…)
const K = (p) => 'fs:' + String(p).split(/[\\/]/).pop();
export function readFileSync(p) {
  const v = localStorage.getItem(K(p));
  if (v == null) throw new Error('ENOENT');
  return v;
}
export function writeFileSync(p, data) {
  try {
    localStorage.setItem(K(p), String(data));
  } catch {}
}
export const existsSync = (p) => localStorage.getItem(K(p)) != null;
export const mkdirSync = () => {};
export const rmSync = (p) => localStorage.removeItem(K(p));
export const readdirSync = () => [];
export const statSync = () => ({ size: 0, mtimeMs: 0 });
export const renameSync = () => {};
export default { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, renameSync };