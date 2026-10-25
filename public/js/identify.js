// « Quel est ce son ? » (Android) : ouvre la reconnaissance de son gratuite de Google (ou Shazam s'il est installé).
// Accessible par un appui long sur l'icône de Boombox, ou par le bouton de la page Recherche. Au retour dans
// Boombox, une petite fenêtre propose de chercher le son trouvé pour l'écouter ici.
import { html, toast } from './ui.js';

export const canIdentify = () => window.Capacitor?.getPlatform?.() === 'android' && !!window.Capacitor.Plugins?.BoomboxNative?.soundSearch;

let waitingSince = 0;

export async function identifySong() {
  const P = window.Capacitor?.Plugins?.BoomboxNative;
  if (!P?.soundSearch) return toast('Disponible sur l’appli Android');
  try {
    const r = await P.soundSearch();
    waitingSince = Date.now();
    toast(r?.app === 'shazam' ? 'Shazam écoute… reviens ici une fois le son trouvé' : 'Google écoute… reviens ici une fois le son trouvé', { timeout: 4000 });
  } catch {
    toast('Il faut l’appli Google (ou Shazam) sur le téléphone pour reconnaître un son', { timeout: 6000 });
  }
}

// Retour dans Boombox après la reconnaissance : on propose de chercher le son trouvé
function askFound() {
  document.querySelector('.idf-sheet')?.remove();
  const box = document.createElement('div');
  box.className = 'idf-sheet';
  box.innerHTML = String(html`<div class="idf-card">
    <b>🎵 Tu as trouvé le son ?</b>
    <p class="muted">Tape son titre (et l’artiste) pour l’écouter dans Boombox.</p>
    <form class="row-flex" id="idf-f"><input class="input" id="idf-q" placeholder="Ex : Jefe Ninho" autocomplete="off" style="flex:1"><button class="btn primary">Écouter</button></form>
    <div class="row-flex" style="justify-content:space-between;margin-top:8px"><button class="btn ghost sm" id="idf-again">Réessayer</button><button class="btn ghost sm" id="idf-no">Fermer</button></div>
  </div>`);
  document.body.appendChild(box);
  const q = box.querySelector('#idf-q');
  setTimeout(() => q.focus(), 150);
  box.querySelector('#idf-f').onsubmit = (e) => {
    e.preventDefault();
    if (!q.value.trim()) return q.focus();
    location.hash = `#/search?q=${encodeURIComponent(q.value.trim())}`;
    box.remove();
  };
  box.querySelector('#idf-no').onclick = () => box.remove();
  box.querySelector('#idf-again').onclick = () => (box.remove(), identifySong());
  box.addEventListener('click', (e) => e.target === box && box.remove());
}

window.Capacitor?.Plugins?.App?.addListener?.('appStateChange', (st) => {
  if (!st.isActive || !waitingSince) return;
  const recent = Date.now() - waitingSince < 5 * 60e3;
  waitingSince = 0;
  if (recent) setTimeout(askFound, 300);
});
