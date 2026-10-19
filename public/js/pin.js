// Code à 4 chiffres d'un profil Boombox. Demandé quand on choisit un profil sur un appareil (pas à chaque
// ouverture : le profil choisi reste) et quand on change de profil.
// Réinitialisation cachée : taper six fois « 4 » d'affilée sur le clavier du code.
import { html, icon, toast } from './ui.js';
import { updateProfile } from './state.js';

// Empreinte du code (le code lui-même n'est jamais enregistré). Simple et sans crypto.subtle, qui n'existe pas
// sur une adresse http locale (téléphone sur le Wi-Fi) : c'est un verrou de confort, pas un coffre-fort.
export function hashPin(profileId, pin) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = `boombox|${profileId}|${pin}`;
  for (let round = 0; round < 500; round++) {
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (s.charCodeAt(i) + round), 0x5bd1e995) >>> 0;
    }
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// Clavier du code. mode 'check' : vérifie le code de `profile` ; mode 'set' : demande un nouveau code (deux fois).
// Résout avec true / le code choisi, ou false si annulé.
export function pinPad(profile, { mode = 'check', title = null } = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'pin-ov';
    let digits = '';
    let first = null;
    let fours = 0;
    const heading = () => (mode === 'set' ? (first ? 'Confirme le code' : 'Choisis un code à 4 chiffres') : title || `Code de ${profile.name}`);
    ov.innerHTML = String(html`<div class="pin-box">
      ${profile.photo ? html`<div class="pin-pic" style="background:center/cover url('${profile.photo}')"></div>` : html`<div class="pin-pic" style="background:${profile.color || 'var(--accent)'}">${(profile.name || '?')[0].toUpperCase()}</div>`}
      <h2 class="pin-title"></h2>
      <div class="pin-dots"><i></i><i></i><i></i><i></i></div>
      <p class="pin-msg muted"></p>
      <div class="pin-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button data-k="${n}">${n}</button>`)}<button data-k="cancel" class="pin-sm">Annuler</button><button data-k="0">0</button><button data-k="del" class="pin-sm" aria-label="Effacer">${icon('back', 22)}</button></div>
    </div>`);
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    const paint = () => {
      $('.pin-title').textContent = heading();
      ov.querySelectorAll('.pin-dots i').forEach((d, i) => d.classList.toggle('on', i < digits.length));
    };
    const fail = (msg) => {
      $('.pin-box').classList.remove('shake');
      void $('.pin-box').offsetWidth;
      $('.pin-box').classList.add('shake');
      $('.pin-msg').textContent = msg;
      digits = '';
      paint();
    };
    const done = (v) => {
      document.removeEventListener('keydown', onKey);
      ov.remove();
      resolve(v);
    };
    const resetFlow = async () => {
      // Easter egg : six « 4 » d'affilée → réinitialisation du code de ce profil
      $('.pin-msg').textContent = '';
      if (!confirm(`Réinitialiser le code de ${profile.name} ? Le profil s'ouvrira sans code ; tu pourras en choisir un nouveau dans les paramètres.`)) return (fours = 0);
      await updateProfile(profile.id, { pin: null });
      profile.pin = null;
      toast('Code réinitialisé');
      done(true);
    };
    const press = async (k) => {
      if (k === 'cancel') return done(false);
      if (k === 'del') return ((digits = digits.slice(0, -1)), paint());
      fours = k === '4' ? fours + 1 : 0;
      if (mode === 'check' && fours >= 6) return resetFlow();
      if (digits.length >= 4) digits = '';
      digits += k;
      paint();
      if (digits.length < 4) return;
      await new Promise((r) => setTimeout(r, 120));
      if (mode === 'check') {
        if (hashPin(profile.id, digits) === profile.pin) return done(true);
        // Un 4444 raté fait partie d'une suite de 4 : on laisse continuer l'easter egg sans effacer le compteur
        return fail(fours >= 4 ? '' : 'Code incorrect');
      }
      if (!first) {
        first = digits;
        digits = '';
        $('.pin-msg').textContent = '';
        return paint();
      }
      if (digits !== first) {
        first = null;
        return fail('Les deux codes ne correspondent pas, recommence');
      }
      done(digits);
    };
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (b) press(b.dataset.k);
    });
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape') press('cancel');
    };
    document.addEventListener('keydown', onKey);
    paint();
  });
}

// Définir / changer / retirer le code du profil (depuis les paramètres)
export async function setProfilePin(profile) {
  if (profile.pin && !(await pinPad(profile, { title: 'Code actuel' }))) return false;
  const pin = await pinPad(profile, { mode: 'set' });
  if (!pin) return false;
  const h = hashPin(profile.id, pin);
  await updateProfile(profile.id, { pin: h });
  profile.pin = h;
  toast('Code du profil enregistré');
  return true;
}
export async function removeProfilePin(profile) {
  if (profile.pin && !(await pinPad(profile, { title: 'Code actuel' }))) return false;
  await updateProfile(profile.id, { pin: null });
  profile.pin = null;
  toast('Code retiré : le profil s’ouvre sans code');
  return true;
}
