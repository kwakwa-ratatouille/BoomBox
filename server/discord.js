// Statut Discord « Écoute Boombox » (Rich Presence) : le serveur parle à l'appli Discord ouverte sur ce PC
// par son canal local (\\.\pipe\discord-ipc-N), comme les jeux. Titre, artiste, pochette, barre de progression.
// L'identifiant ci-dessous est celui de l'application Discord « Boombox » (public, le même pour tout le monde).
import net from 'node:net';

const CLIENT_ID = '1562096568318955540';
let sock = null;
let ready = false;
let connecting = null;
let last = null; // dernière activité demandée (renvoyée après une reconnexion)
let lastSentKey = '';

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function tryPipe(i) {
  return new Promise((resolve, reject) => {
    const path = process.platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${i}` : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'}/discord-ipc-${i}`;
    const s = net.createConnection(path, () => resolve(s));
    s.once('error', reject);
  });
}

async function connect() {
  if (ready) return true;
  if (connecting) return connecting;
  connecting = (async () => {
    for (let i = 0; i < 10; i++) {
      try {
        const s = await tryPipe(i);
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Discord ne répond pas')), 4000);
          let buf = Buffer.alloc(0);
          s.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 8) {
              const len = buf.readInt32LE(4);
              if (buf.length < 8 + len) break;
              const msg = JSON.parse(buf.subarray(8, 8 + len).toString() || '{}');
              buf = buf.subarray(8 + len);
              if (msg.evt === 'READY') (clearTimeout(t), resolve());
              if (msg.evt === 'ERROR') console.warn('Discord :', msg.data?.message);
            }
          });
          s.once('error', reject);
          s.write(frame(0, { v: 1, client_id: CLIENT_ID }));
        });
        sock = s;
        ready = true;
        lastSentKey = '';
        s.on('close', () => ((ready = false), (sock = null)));
        s.on('error', () => ((ready = false), (sock = null)));
        return true;
      } catch {}
    }
    return false;
  })().finally(() => (connecting = null));
  return connecting;
}

// p : { title, artist, album, cover, duration (s), position (s), playing, url } — ou null pour effacer
export async function setPresence(p) {
  last = p;
  if (!(await connect())) return { ok: false, reason: 'Discord (application ordinateur) n’est pas ouvert sur ce PC' };
  let activity = null;
  if (p?.title && p.playing) {
    const now = Date.now();
    const start = now - Math.max(0, p.position || 0) * 1000;
    activity = {
      type: 2, // « Écoute … »
      details: String(p.title).slice(0, 128),
      state: String(p.artist || 'Boombox').slice(0, 128),
      timestamps: p.duration ? { start, end: start + p.duration * 1000 } : { start },
      assets: {
        large_image: p.cover && /^https:\/\//.test(p.cover) ? p.cover : 'boombox',
        large_text: String(p.album || p.title).slice(0, 128),
        small_image: 'boombox',
        small_text: 'Boombox',
      },
      ...(p.url ? { buttons: [{ label: 'Écouter sur Boombox', url: p.url }] } : {}),
    };
  }
  // Rien de nouveau (même son, même état, position cohérente) : on n'inonde pas Discord
  const key = JSON.stringify(activity && { ...activity, timestamps: activity.timestamps && Math.round(activity.timestamps.start / 3000) });
  if (key === lastSentKey) return { ok: true };
  lastSentKey = key;
  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(Date.now()) }));
  return { ok: true };
}

// Discord ouvert après Boombox : on retente de temps en temps et on renvoie le dernier statut
setInterval(() => { if (!ready && last?.playing) setPresence(last).catch(() => {}); }, 30e3).unref?.();
