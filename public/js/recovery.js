// Récupération sans lien : ton nom + un code secret que tu choisis retrouvent ta bibliothèque sur un nouvel appareil.
// Rien n'est lisible en clair chez Firebase : le nom et le code donnent (après 200 000 tours de calcul, pour ralentir
// les essais au hasard) l'adresse du document ET la clé qui chiffre les identifiants de l'espace. Sans le bon nom
// et le bon code, on ne trouve rien, et même avec le document on ne peut pas le lire.
import { db, doc, getDoc, setDoc, deleteDoc, cloud } from './cloud.js';

const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const MIN_CODE = 6;

async function derive(name, code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(`${norm(name)}|${String(code).trim()}`), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const params = (salt) => ({ name: 'PBKDF2', hash: 'SHA-256', iterations: 200000, salt: enc.encode(salt) });
  const id = hex(await crypto.subtle.deriveBits(params('boombox-recovery-id-v1'), base, 256));
  const key = await crypto.subtle.deriveKey(params('boombox-recovery-key-v1'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { id, key };
}

// Enregistre (ou remplace) le code de récupération de cet espace
export async function saveRecovery(name, code) {
  if (!norm(name)) throw new Error('Indique ton nom');
  if (String(code).trim().length < MIN_CODE) throw new Error(`Le code doit faire au moins ${MIN_CODE} caractères`);
  const sid = cloud.spaceId;
  const secret = (await getDoc(doc(db, 'spaces', sid, 'private', 'secret'))).data()?.value;
  if (!secret) throw new Error('Espace introuvable');
  const { id, key } = await derive(name, code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ sid, secret })));
  const old = localStorage.getItem('boombox.recoveryId');
  await setDoc(doc(db, 'recovery', id), { data: b64(data), iv: b64(iv), by: cloud.uid, at: Date.now() });
  if (old && old !== id) deleteDoc(doc(db, 'recovery', old)).catch(() => {});
  localStorage.setItem('boombox.recoveryId', id);
}

export const hasRecovery = () => !!localStorage.getItem('boombox.recoveryId');

// Nouvel appareil : nom + code → on rejoint l'espace
export async function recover(name, code, deviceName) {
  const { id, key } = await derive(name, code);
  const snap = await getDoc(doc(db, 'recovery', id)).catch(() => null);
  if (!snap?.exists()) throw new Error('Nom ou code incorrect');
  const r = snap.data();
  let inv;
  try {
    inv = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, key, unb64(r.data))));
  } catch {
    throw new Error('Nom ou code incorrect');
  }
  await cloud.joinSpace(inv.sid, inv.secret, deviceName);
  localStorage.setItem('boombox.recoveryId', id);
}
