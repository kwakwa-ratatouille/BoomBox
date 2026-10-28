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
// Question de secours (code oublié) : même principe, la question et la réponse remplacent le code
export const QUESTIONS = [
  'Le nom de ton premier animal',
  'Ta ville de naissance',
  'Le prénom de ton meilleur ami d’enfance',
  'Ton premier album acheté ou écouté en boucle',
  'Le nom de ton école primaire',
  'Le surnom que te donnait ta famille',
];
const answerSecret = (q, answer) => `question:${QUESTIONS.indexOf(q)}|${norm(answer)}`;

async function derive(name, code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(`${norm(name)}|${String(code).trim()}`), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const params = (salt) => ({ name: 'PBKDF2', hash: 'SHA-256', iterations: 200000, salt: enc.encode(salt) });
  const id = hex(await crypto.subtle.deriveBits(params('boombox-recovery-id-v1'), base, 256));
  const key = await crypto.subtle.deriveKey(params('boombox-recovery-key-v1'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { id, key };
}

// Un accès chiffré : (nom, secret) → document « recovery/<adresse> ». slot : 'recoveryId' (code) ou 'recoveryQ' (question)
async function storeAccess(name, secretText, slot) {
  const sid = cloud.spaceId;
  const secret = (await getDoc(doc(db, 'spaces', sid, 'private', 'secret'))).data()?.value;
  if (!secret) throw new Error('Espace introuvable');
  const { id, key } = await derive(name, secretText);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ sid, secret })));
  const old = localStorage.getItem(`boombox.${slot}`);
  await setDoc(doc(db, 'recovery', id), { data: b64(data), iv: b64(iv), by: cloud.uid, at: Date.now() });
  if (old && old !== id) deleteDoc(doc(db, 'recovery', old)).catch(() => {});
  localStorage.setItem(`boombox.${slot}`, id);
}

// Enregistre (ou remplace) le code de récupération, et la question de secours si elle est remplie
export async function saveRecovery(name, code, question = null, answer = '') {
  if (!norm(name)) throw new Error('Indique ton nom');
  if (String(code).trim().length < MIN_CODE) throw new Error(`Le code doit faire au moins ${MIN_CODE} caractères`);
  if (question && norm(answer).length < 3) throw new Error('Réponse trop courte (3 lettres minimum)');
  await storeAccess(name, code, 'recoveryId');
  if (question) await storeAccess(name, answerSecret(question, answer), 'recoveryQ');
}
export const hasQuestion = () => !!localStorage.getItem('boombox.recoveryQ');

export const hasRecovery = () => !!localStorage.getItem('boombox.recoveryId');

// Code oublié : nom + question + réponse (majuscules, accents et espaces ignorés dans la réponse)
export const recoverByQuestion = (name, question, answer, deviceName) => recover(name, answerSecret(question, answer), deviceName, 'Nom, question ou réponse incorrects');

// Nouvel appareil : nom + code → on rejoint l'espace
export async function recover(name, code, deviceName, wrongMsg = 'Nom ou code incorrect') {
  const { id, key } = await derive(name, code);
  const snap = await getDoc(doc(db, 'recovery', id)).catch(() => null);
  if (!snap?.exists()) throw new Error(wrongMsg);
  const r = snap.data();
  let inv;
  try {
    inv = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, key, unb64(r.data))));
  } catch {
    throw new Error(wrongMsg);
  }
  await cloud.joinSpace(inv.sid, inv.secret, deviceName);
}

// ---------- Code de sécurité (généré par Boombox, montré à la création de la bibliothèque) ----------
// Même principe que le nom + code ci-dessus, avec un nom fixe : le code seul retrouve la bibliothèque. Une copie
// lisible est gardée dans la bibliothèque (lisible seulement par ses appareils) pour pouvoir le revoir.
const CODE_NAME = 'code de securite boombox';
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function newSecurityCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const s = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => A[b % A.length]).join('');
  return s.match(/.{4}/g).join('-');
}
export async function saveSecurityCode(code) {
  await storeAccess(CODE_NAME, normCode(code), 'recoveryCode');
  await setDoc(doc(db, 'spaces', cloud.spaceId, 'private', 'code'), { value: code, at: Date.now() });
}
export async function readSecurityCode() {
  return (await getDoc(doc(db, 'spaces', cloud.spaceId, 'private', 'code'))).data()?.value || null;
}
export const recoverByCode = (code, deviceName) => recover(CODE_NAME, normCode(code), deviceName, 'Code de sécurité incorrect');
