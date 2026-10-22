// Mode bourré (caché) : le son n'est jamais constant — vitesse et hauteur qui tanguent, filtres qui balayent,
// écho qui part en vrille, bégaiements… — et l'appli tangue avec. Effets légers pour ne pas faire ramer :
// transformations CSS (carte graphique) et une couche de couleur, pas de flou sur toute la page.
// Activation : 5 appuis rapides sur le logo (PC) ou sur la pochette du lecteur plein écran (téléphone).
import { player } from './player.js';
import { toast } from './ui.js';

let on = false;
let wobble = 0;
let events = 0;
let pill = null;
let ev = null; // effet en cours : { kind, until }

const audio = () => player.engines?.audio;
const els = () => audio()?.els || [];
const nodes = () => audio()?.graph?.nodes || [];
const rnd = (a, b) => a + Math.random() * (b - a);

function setRate(r) {
  for (const el of els()) {
    el.preservesPitch = el.webkitPreservesPitch = el.mozPreservesPitch = false; // la hauteur suit la vitesse
    el.playbackRate = Math.max(0.5, Math.min(1.9, r));
  }
}
// Filtres et écho (PC : traitement audio du lecteur ; téléphone : seulement vitesse/hauteur)
function setFx({ lp = 20000, hp = 20, echo = 0 } = {}) {
  const ctx = audio()?.graph?.ctx;
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const n of nodes()) {
    n.lp.frequency.setTargetAtTime(lp, t, 0.12);
    n.hp.frequency.setTargetAtTime(hp, t, 0.12);
    n.send.gain.setTargetAtTime(echo, t, 0.1);
    n.fb.gain.setTargetAtTime(echo ? 0.62 : 0.45, t, 0.1);
  }
}
function stutter() {
  const ctx = audio()?.graph?.ctx;
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const n of nodes()) {
    const g = n.gain.gain;
    const v = g.value || 1;
    for (let k = 0; k < 10; k++) {
      g.setValueAtTime(k % 2 ? v : 0.0001, t + k * 0.06);
    }
    g.setValueAtTime(v, t + 0.62);
  }
}

// Un nouvel effet au hasard toutes les 0,6 à 1,8 s
const EFFECTS = [
  () => (ev = { kind: 'slow', until: Date.now() + rnd(700, 1600) }),
  () => (ev = { kind: 'fast', until: Date.now() + rnd(500, 1200) }),
  () => (setFx({ lp: rnd(300, 900) }), (ev = { kind: 'muffled', until: Date.now() + rnd(900, 2000) })),
  () => (setFx({ hp: rnd(900, 1800), lp: rnd(2500, 4000) }), (ev = { kind: 'phone', until: Date.now() + rnd(800, 1600) })),
  () => (setFx({ echo: 0.7 }), (ev = { kind: 'echo', until: Date.now() + rnd(1200, 2400) })),
  () => (stutter(), (ev = { kind: 'stutter', until: Date.now() + 650 })),
  () => (ev = { kind: 'wave', until: Date.now() + rnd(1500, 2500) }),
  () => (ev = { kind: 'drop', until: Date.now() + 900 }),
];

function frame() {
  if (!on) return;
  wobble += 0.11;
  let r = 1 + Math.sin(wobble) * 0.06 + Math.sin(wobble * 2.7) * 0.03; // tangage permanent
  if (ev && Date.now() < ev.until) {
    if (ev.kind === 'slow') r *= 0.72;
    if (ev.kind === 'fast') r *= 1.32;
    if (ev.kind === 'wave') r *= 1 + Math.sin(wobble * 3) * 0.22;
    if (ev.kind === 'drop') r *= Math.max(0.55, 1 - (1 - (ev.until - Date.now()) / 900) * 0.45); // descend comme un disque qui ralentit
  } else if (ev) {
    ev = null;
    setFx();
  }
  setRate(r);
  setTimeout(frame, 90);
}
function nextEvent() {
  if (!on) return;
  if (!player.paused) EFFECTS[Math.floor(Math.random() * EFFECTS.length)]();
  events = setTimeout(nextEvent, rnd(600, 1800));
  // L'appli a le hoquet de temps en temps
  if (Math.random() < 0.25) {
    document.documentElement.classList.add('drunk-hic');
    setTimeout(() => document.documentElement.classList.remove('drunk-hic'), 420);
  }
}

export function startDrunk() {
  if (on) return;
  on = true;
  document.documentElement.classList.add('drunk');
  pill = document.createElement('button');
  pill.className = 'drunk-pill';
  pill.textContent = '🍺 Mode bourré · toucher pour arrêter';
  pill.onclick = stopDrunk;
  document.body.appendChild(pill);
  const veil = document.createElement('div');
  veil.className = 'drunk-veil';
  document.body.appendChild(veil);
  toast('🍺 Santé ! Mode bourré activé');
  frame();
  nextEvent();
}

export function stopDrunk() {
  if (!on) return;
  on = false;
  clearTimeout(events);
  ev = null;
  setFx();
  for (const el of els()) {
    el.playbackRate = player.rate || 1;
    el.preservesPitch = el.webkitPreservesPitch = el.mozPreservesPitch = true;
  }
  audio()?.els?.forEach((_, i) => audio()._apply?.(i)); // volume normal
  document.documentElement.classList.remove('drunk', 'drunk-hic');
  pill?.remove();
  document.querySelector('.drunk-veil')?.remove();
  toast('Mode bourré terminé, bois de l’eau 💧');
}

// 5 appuis en moins de 2,5 s sur le logo ou la pochette du lecteur plein écran
export function setupDrunkTrigger() {
  let taps = [];
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.brand-link, .brand-logo, #fullplayer .fp-art')) return;
    const now = Date.now();
    taps = taps.filter((t) => now - t < 2500);
    taps.push(now);
    if (taps.length >= 5) {
      taps = [];
      on ? stopDrunk() : startDrunk();
    }
  }, true);
}
