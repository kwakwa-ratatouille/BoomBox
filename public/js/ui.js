import { PIXEL } from './icons-pixel.js';
// Petits utilitaires d'interface : échappement HTML, icônes, toasts, modales, menus contextuels.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(s);

// Template HTML avec échappement automatique des valeurs (sauf raw() et tableaux de raw()).
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v === false || v == null) out += '';
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

const P = {
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  library: 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  play: 'M6.75 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 6.75 5.14z', // triangle recentré dans les boutons ronds
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  repeat1: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
  heart: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  heartFill: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  queue: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
  lyrics: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  devices: 'M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  volumeMute: 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  more: 'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  back: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  forward: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  import: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  radio: 'M7.76 16.24C6.67 15.16 6 13.66 6 12s.67-3.16 1.76-4.24l1.42 1.42C8.45 9.9 8 10.9 8 12c0 1.1.45 2.1 1.17 2.83l-1.41 1.41zm8.48 0C17.33 15.16 18 13.66 18 12s-.67-3.16-1.76-4.24l-1.42 1.42C15.55 9.9 16 10.9 16 12c0 1.1-.45 2.1-1.17 2.83l1.41 1.41zM12 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm8 2c0 2.21-.9 4.21-2.35 5.65l1.42 1.42C20.88 17.26 22 14.76 22 12s-1.12-5.26-2.93-7.07l-1.42 1.42A7.94 7.94 0 0 1 20 12zM6.35 6.35L4.93 4.93C3.12 6.74 2 9.24 2 12s1.12 5.26 2.93 7.07l1.42-1.42C4.9 16.21 4 14.21 4 12s.9-4.21 2.35-5.65z',
  users: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  chevronDown: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
  pin: 'M16 9V4h1V2H7v2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  chart: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  phone: 'M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z',
  laptop: 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z',
  moon: 'M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10 3.71 0 6.93-2.02 8.66-5.02-7.51-.25-12.09-8.43-8.32-14.96z',
  video: 'M21 3H3c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5a2 2 0 0 0-2-2zm0 14H3V5h18v12zm-5-6l-7 4V7z',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  addQueue: 'M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  playNext: 'M2 6h12v2H2zm0 4h12v2H2zm0 4h8v2H2zm14-1v8l6-4z',
  speed: 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z',
  pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
  palette: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  down: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  car: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A2.99 2.99 0 0 0 3 12a3 3 0 0 0 5.04 2.19l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z',
  ticket: 'M22 10V6c0-1.11-.9-2-2-2H4c-1.1 0-1.99.89-1.99 2v4c1.1 0 1.99.9 1.99 2s-.89 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2s.9-2 2-2zm-9 7.5h-2v-2h2v2zm0-4.5h-2v-2h2v2zm0-4.5h-2v-2h2v2z',
  sync: 'M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z',
  keyboard: 'M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  lyricsFull: 'M4 4h16v2H4V4zm0 4h10v2H4V8zm0 4h16v2H4v-2zm0 4h10v2H4v-2zm14-2l4 3-4 3v-6z',
  sortList: 'M3 6h12v2H3V6zm0 5h9v2H3v-2zm0 5h6v2H3v-2zm15-10h2v9.17l1.59-1.58L23 15l-4 4-4-4 1.41-1.41L18 15.17V6z',
  mixer: 'M6 3h2v6h2v2H4V9h2V3zm0 10h2v8H6v-8zm5-10h2v10h2v2H9v-2h2V3zm0 14h2v4h-2v-4zm5-14h2v4h2v2h-6V7h2V3zm0 8h2v10h-2V11z',
  addCircle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-13h-2v4H7v2h4v4h2v-4h4v-2h-4V7z',
  automix: 'M7 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm10-9a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  sparkle: 'M10 2l1.9 5.6L17.5 9.5l-5.6 1.9L10 17l-1.9-5.6L2.5 9.5l5.6-1.9L10 2zm8 10l.95 2.55L21.5 15.5l-2.55.95L18 19l-.95-2.55-2.55-.95 2.55-.95L18 12z',
  chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
};

// Couleurs d'accent proposées dans les Paramètres
export const ACCENTS = { Mauve: '#b07cf7', Vert: '#2ef28b', Violet: '#8b5cf6', Rose: '#ff4d8d', Orange: '#ff9f2e', Bleu: '#3ea6ff', Jaune: '#f5d33f', Rouge: '#ff5a5a', Turquoise: '#2ee6c8' };

// Direction artistique, propre à l'appareil : « pixel » (nouvelle, par défaut) ou « spotify » (l'ancienne)
let da = 'pixel';
try { da = localStorage.getItem('bb-da') || 'pixel'; } catch {}
export const DA = () => da;
export function setDA(v) {
  try { localStorage.setItem('bb-da', v); } catch {}
  location.reload();
}
document.documentElement.classList.toggle('da-pixel', da === 'pixel');
// Icônes écrites en dur dans la page : on retrouve leur nom par leur dessin et on met la version pixel
if (da === 'pixel') {
  const swap = () => {
    const byPath = Object.fromEntries(Object.entries(P).map(([k, d]) => [d, k]));
    document.querySelectorAll('svg.ic:not(.px) > path').forEach((p) => {
      const d = p.getAttribute('d') || '';
      const k = byPath[d] || (d.startsWith('M12 2a10 10 0 1 0 0 20') ? 'discover' : d.startsWith('M12 22c1.1') ? 'bell' : d.startsWith('M7 21H3v-8h4v8') ? 'leaderboard' : null);
      if (!k || !PIXEL[k]) return;
      p.setAttribute('d', PIXEL[k]);
      p.parentNode.classList.add('px');
      p.parentNode.setAttribute('shape-rendering', 'crispEdges');
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', swap);
  else setTimeout(swap);
}

export const icon = (name, size = 24) => {
  const px = da === 'pixel' && PIXEL[name];
  return raw(`<svg class="ic${px ? ' px' : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"${px ? ' shape-rendering="crispEdges"' : ''}><path d="${px || P[name] || ''}"/></svg>`);
};

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fmtTotal(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function fmtAgo(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "à l'instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 7) return `il y a ${Math.floor(d / 86400)} j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// « 2 titres likés », « 3 nouvelles sorties » : chaque mot prend le pluriel
export const plural = (n, word) => `${n.toLocaleString('fr-FR')} ${n > 1 ? word.split(' ').map((w) => (/[sx]$/.test(w) ? w : w + 's')).join(' ') : word}`;

export function artistLinks(t) {
  const list = t?.artists?.length ? t.artists : [{ name: 'Artiste inconnu' }];
  return raw(
    list
      .map((a) => (a.id ? `<a href="#/artist/${esc(a.id)}" class="link">${esc(a.name)}</a>` : `<span>${esc(a.name)}</span>`))
      .join(', '),
  );
}

export const artistNames = (t) => (t?.artists || []).map((a) => a.name).join(', ');

// ---------- Toasts ----------
export function toast(message, { action, onAction, timeout = action ? 4500 : 2800 } = {}) {
  const root = document.getElementById('toasts');
  // Deux messages à l'écran au plus : les plus anciens partent
  [...root.children].slice(0, -1).forEach((old) => old.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => (onAction?.(), el.remove());
  root.appendChild(el);
  setTimeout(() => el.classList.add('out'), timeout);
  setTimeout(() => el.remove(), timeout + 400);
}

// ---------- Modales ----------
export function modal({ title, body, actions = [], wide = false, onMount }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Fermer">${icon('close')}</button></header>
      <div class="modal-body">${body || ''}</div>
      ${actions.length ? `<footer>${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : a.danger ? 'danger' : 'ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</footer>` : ''}
    </div>`;
    const close = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const p = actions.findIndex((a) => a.primary);
        if (p >= 0) wrap.querySelector(`[data-i="${p}"]`).click();
      }
    };
    wrap.addEventListener('mousedown', (e) => e.target === wrap && close(null));
    wrap.querySelector('[data-close]').onclick = () => close(null);
    wrap.querySelectorAll('footer [data-i]').forEach((b) => {
      b.onclick = async () => {
        const a = actions[b.dataset.i];
        const v = a.value ? await a.value(wrap) : a.label;
        if (v !== false) close(v);
      };
    });
    document.addEventListener('keydown', onKey);
    root.appendChild(wrap);
    onMount?.(wrap, close);
    wrap.querySelector('input,textarea')?.focus();
  });
}

export async function promptText(title, { value = '', placeholder = '', label = 'Enregistrer', multiline = false, hint = '' } = {}) {
  const field = multiline
    ? `<textarea class="input" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="100">`;
  return modal({
    title,
    body: (hint ? `<p class="muted" style="margin:0 0 10px;font-size:13px">${esc(hint)}</p>` : '') + field,
    actions: [
      { label: 'Annuler' },
      { label, primary: true, value: (w) => w.querySelector('input,textarea').value.trim() || false },
    ],
  }).then((v) => (v === 'Annuler' ? null : v));
}

export async function confirmBox(title, text, label = 'Supprimer') {
  const v = await modal({ title, body: `<p class="muted">${esc(text)}</p>`, actions: [{ label: 'Annuler' }, { label, danger: true, value: () => 'ok' }] });
  return v === 'ok';
}

// ---------- Menu contextuel ----------
let openMenu = null;
export function closeMenu() {
  openMenu?._backdrop?.remove();
  openMenu?.remove();
  openMenu = null;
}
document.addEventListener('mousedown', (e) => openMenu && !openMenu.contains(e.target) && closeMenu());
document.addEventListener('touchstart', (e) => openMenu && !openMenu.contains(e.target) && closeMenu(), { passive: true });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());

// Sur téléphone, les menus montent du bas de l'écran (comme Spotify) ; les sous-menus remplacent le menu.
export function contextMenu(x, y, items) {
  closeMenu();
  const el = buildMenu(items);
  if (isMobile()) {
    el.classList.add('sheet');
    const bd = document.createElement('div');
    bd.className = 'ctx-backdrop';
    document.body.appendChild(bd);
    el._backdrop = bd;
    document.body.appendChild(el);
    openMenu = el;
    sheetDrag(el);
    return;
  }
  document.body.appendChild(el);
  openMenu = el;
  place(el, x, y);
}

// Téléphone : le menu (feuille du bas) se ferme en le glissant vers le bas, depuis sa poignée ou quand il est
// déjà défilé tout en haut ; il suit le doigt puis part en bas avec une animation
function sheetDrag(el) {
  let y0 = null;
  let dy = 0;
  let t0 = 0;
  const ease = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
  el.addEventListener('touchstart', (e) => {
    if (el.scrollTop > 0) return (y0 = null);
    y0 = e.touches[0].clientY;
    dy = 0;
    t0 = performance.now();
    el.style.transition = 'none';
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) return (el.style.transform = '');
    if (e.cancelable) e.preventDefault(); // pas de défilement de la liste pendant qu'on la descend
    el.style.transform = `translateY(${dy}px)`;
    if (el._backdrop) el._backdrop.style.opacity = String(Math.max(0, 1 - dy / 400));
  }, { passive: false });
  el.addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    const fast = dy > 40 && dy / (performance.now() - t0) > 0.5;
    if (dy > Math.min(140, el.offsetHeight * 0.35) || fast) {
      el.style.transition = `transform 0.55s ${ease}`;
      el.style.transform = 'translateY(105%)';
      if (el._backdrop) (el._backdrop.style.transition = 'opacity 0.55s'), (el._backdrop.style.opacity = '0');
      setTimeout(() => openMenu === el && closeMenu(), 550);
    } else {
      el.style.transition = `transform 0.25s ${ease}`;
      el.style.transform = '';
      if (el._backdrop) el._backdrop.style.opacity = '';
    }
  });
}

function buildMenu(items) {
  const el = document.createElement('div');
  el.className = 'ctx';
  // Espace d'icône seulement si au moins une ligne du menu a une icône (sinon le texte serait décalé)
  const withIcons = items.some((it) => it?.icon);
  for (const it of items) {
    if (!it) continue;
    if (it.sep) {
      el.appendChild(Object.assign(document.createElement('hr'), {}));
      continue;
    }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.icon === 'check' || it.on ? ' on' : '');
    b.innerHTML = `${it.icon ? icon(it.icon, 18) : withIcons ? '<i class="ic-space"></i>' : ''}<span>${esc(it.label)}${it.hint ? `<small class="ctx-hint">${esc(it.hint)}</small>` : ''}</span>${it.submenu ? icon('forward', 18) : ''}`;
    if (it.submenu) {
      let sub = null;
      const openSub = () => {
        if (isMobile()) return contextMenu(0, 0, typeof it.submenu === 'function' ? it.submenu() : it.submenu);
        el.querySelectorAll('.ctx.sub').forEach((s) => s.remove());
        sub = buildMenu(typeof it.submenu === 'function' ? it.submenu() : it.submenu);
        sub.classList.add('sub');
        el.appendChild(sub);
        const r = b.getBoundingClientRect();
        place(sub, r.right - 4, r.top - 6, r.left);
      };
      if (!isMobile()) b.onmouseenter = openSub;
      b.onclick = (e) => (e.stopPropagation(), openSub());
    } else {
      b.onmouseenter = () => el.querySelectorAll(':scope > .ctx.sub').forEach((s) => s.remove());
      b.onclick = () => {
        closeMenu();
        it.action?.();
      };
    }
    el.appendChild(b);
  }
  return el;
}

function place(el, x, y, altX) {
  el.style.position = 'fixed';
  el.style.left = '0px';
  el.style.top = '0px';
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  if (left + r.width > vw - 8) left = altX != null ? altX - r.width + 4 : vw - r.width - 8;
  let top = Math.min(y, vh - r.height - 8);
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = Math.max(8, top) + 'px';
}

// Couleur dominante d'une image (pour les dégradés d'en-tête façon Spotify).
const colorCache = new Map();
export function dominantColor(url) {
  if (!url) return Promise.resolve(null);
  if (colorCache.has(url)) return Promise.resolve(colorCache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          const w = 1 + (max - min) / 32; // privilégie les couleurs saturées
          r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
        }
        const k = 0.75;
        const col = `rgb(${Math.round((r / n) * k)}, ${Math.round((g / n) * k)}, ${Math.round((b / n) * k)})`;
        colorCache.set(url, col);
        resolve(col);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    if (url.startsWith('data:') || url.startsWith('/')) img.src = url;
    else if (window.Capacitor?.isNativePlatform?.()) import('./native.js').then((n) => n.localApi()).then((l) => l.media.imageBlobUrl(url)).then((u) => (img.src = u)).catch(() => resolve(null));
    else img.src = `/api/img?u=${encodeURIComponent(url)}`;
  });
}

export const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
