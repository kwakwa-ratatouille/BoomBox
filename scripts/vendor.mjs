// Copie locale des bibliothèques chargées depuis Internet (Firebase, QR code, JSZip) :
// l'appli mobile doit démarrer même sans réseau. Les imports entre fichiers Firebase sont rendus relatifs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'vendor');
fs.mkdirSync(path.join(out, 'firebase'), { recursive: true });
const FB = 'https://www.gstatic.com/firebasejs/12.4.0/';
for (const f of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js']) {
  let code = await (await fetch(FB + f)).text();
  code = code.split(FB).join('./');
  fs.writeFileSync(path.join(out, 'firebase', f), code);
  console.log('firebase/' + f, Math.round(code.length / 1024), 'Ko');
}
for (const [url, name] of [
  ['https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'qrcode.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'jszip.min.js'],
]) {
  const code = await (await fetch(url)).text();
  fs.writeFileSync(path.join(out, name), code);
  console.log(name, Math.round(code.length / 1024), 'Ko');
}