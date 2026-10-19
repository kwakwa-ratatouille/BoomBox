export const join = (...a) => a.filter(Boolean).join('/').replace(/\/+/g, '/');
export const dirname = (p) => String(p).replace(/[\\/][^\\/]*$/, '') || '/';
export const basename = (p) => String(p).split(/[\\/]/).pop();
export const resolve = (...a) => join(...a);
export default { join, dirname, basename, resolve };