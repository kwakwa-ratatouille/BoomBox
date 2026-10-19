// Compile le « serveur embarqué » de l'appli mobile (mobile/local-api.js + server/*.js) en un seul fichier
// pour le navigateur du téléphone : public/js/local-api.bundle.js
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shim = (f) => path.join(root, 'mobile', 'shims', f);

await build({
  entryPoints: [path.join(root, 'mobile', 'local-api.js')],
  outfile: path.join(root, 'public', 'js', 'local-api.bundle.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['safari15', 'chrome100'],
  minify: true,
  sourcemap: false,
  // youtubei.js : version navigateur (condition « browser » de son package.json)
  conditions: ['browser'],
  alias: {
    'node:fs': shim('fs.js'),
    'node:path': shim('path.js'),
    'node:url': shim('url.js'),
    'node:crypto': shim('crypto.js'),
    'node:child_process': shim('child_process.js'),
  },
  // Dans ce fichier, « fetch » et « Buffer » désignent les versions natives/minimales
  inject: [shim('native-fetch.js'), shim('buffer.js')],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});