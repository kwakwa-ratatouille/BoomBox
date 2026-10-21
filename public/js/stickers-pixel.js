// Stickers de la mascotte Boombox (pixel art, même DA que le logo) : une boombox avec un visage, une émotion par
// sticker. Grille 24×24 ; le sticker est dessiné en image (PNG) au moment de l'envoi, comme les stickers emoji.
const COLORS = { O: '#2b1a4a', P: '#b07cf7', L: '#d9c2ff', D: '#8a55d8', W: '#ffffff', K: '#1a1026', G: '#2ef28b', Y: '#ffd34d', R: '#ff4d8d', B: '#3ea6ff' };
const BODY = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........OOOOOOOO........',
  '........OLLLLLLO........',
  '........OO....OO........',
  '..OOOOOOOOOOOOOOOOOOOO..',
  '..OLLLLLLLLLLLLLLLLLLO..',
  '..OPPPPPPPPPPPPPPPPGGO..',
  '..OPPPPPPPPPPPPPPPPPPO..',
  '..OPPPPPPPPPPPPPPPPPPO..',
  '..OPPPPPPPPPPPPPPPPPPO..',
  '..OPPPPPPPPPPPPPPPPPPO..',
  '..OPPPPPPPPPPPPPPPPPPO..',
  '..OPPPPPPPPPPPPPPPPPPO..',
  '..OPPPPPPPPPPPPPPPPPPO..',
  '..OPPPPPPPPPPPPPPPPPPO..',
  '..ODDDDDDDDDDDDDDDDDDO..',
  '..OOOOOOOOOOOOOOOOOOOO..',
  '...OO..............OO...',
  '........................',
  '........................',
  '........................'];

// Petits morceaux posés sur le corps : [x, y, lignes]
const HEART = ['R.R', 'RRR', '.R.'];
const SMILE = ['K....K', '.KKKK.'];
const OPEN = ['KKKKKK', 'KRRRRK', '.KKKK.'];
const HAPPY_EYE = ['.K.', 'K.K'];
const CHEEKS = [[4, 14, ['RR']], [18, 14, ['RR']]];
const NOTE = (c) => ['..' + c + c, '..' + c + '.', '.' + c + c + '.', c + c + '..'];
const Z = ['LLL', '.L.', 'LLL'];

export const PIXEL_STICKERS = [
  { id: 'happy', label: 'Content', parts: [[6, 12, HAPPY_EYE], [15, 12, HAPPY_EYE], [9, 14, SMILE], ...CHEEKS] },
  { id: 'love', label: 'Amoureux', parts: [[6, 11, HEART], [15, 11, HEART], [9, 14, SMILE], [0, 1, HEART], [20, 0, HEART], [21, 4, HEART]] },
  { id: 'lol', label: 'MDR', parts: [[6, 11, ['K..', '.K.', 'K..']], [15, 11, ['..K', '.K.', '..K']], [9, 14, OPEN], [4, 12, ['B', 'B']], [19, 12, ['B', 'B']]] },
  { id: 'sad', label: 'Triste', parts: [[7, 12, ['KK', 'KK']], [15, 12, ['KK', 'KK']], [7, 14, ['B', 'B', 'B']], [9, 15, ['.KKKK.', 'K....K']]] },
  { id: 'angry', label: 'Énervé', parts: [[6, 10, ['KK.', '..K']], [15, 10, ['.KK', 'K..']], [7, 12, ['KK']], [15, 12, ['KK']], [9, 15, ['KKKKKK']], [20, 1, ['R.R', '.R.', 'R.R']]] },
  { id: 'wow', label: 'Choqué', parts: [[6, 11, ['KKK', 'KWK', 'KKK']], [15, 11, ['KKK', 'KWK', 'KKK']], [10, 14, ['.KK.', 'K..K', '.KK.']]] },
  { id: 'cool', label: 'Stylé', parts: [[5, 11, ['KKKKKKKKKKKKKK', '.KWKK....KWKK.']], [9, 15, ['....KK', 'KKKK..']], [0, 3, ['Y', '.']], [22, 2, ['Y']]] },
  { id: 'sleep', label: 'Dodo', parts: [[6, 13, ['KKK']], [15, 13, ['KKK']], [11, 15, ['KK']], [18, 2, Z], [21, 0, ['LL', 'LL']]] },
  { id: 'party', label: 'Ambiance', parts: [[6, 12, HAPPY_EYE], [15, 12, HAPPY_EYE], [9, 14, OPEN], [0, 1, NOTE('Y')], [20, 0, NOTE('G')], [1, 10, ['R']], [22, 12, ['G']], [0, 16, ['Y']], [23, 8, ['R']], [21, 17, ['Y']]] },
  { id: 'dead', label: 'Mort de rire', parts: [[6, 11, ['K.K', '.K.', 'K.K']], [15, 11, ['K.K', '.K.', 'K.K']], [9, 14, ['KKKKKK', '...RR.', '...RR.']]] },
];

const grid = (st) => {
  const g = BODY.map((r) => [...r]);
  for (const [x, y, rows] of st.parts) rows.forEach((row, dy) => [...row].forEach((c, dx) => c !== '.' && g[y + dy]?.[x + dx] !== undefined && (g[y + dy][x + dx] = c)));
  return g;
};

// Image PNG du sticker (fond transparent, pixels nets)
export function renderPixelSticker(id, size = 168) {
  const st = PIXEL_STICKERS.find((s) => s.id === id);
  if (!st) return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const x = cv.getContext('2d');
  const u = size / 24;
  grid(st).forEach((row, j) => row.forEach((c, i) => {
    if (c === '.') return;
    x.fillStyle = COLORS[c];
    x.fillRect(Math.round(i * u), Math.round(j * u), Math.ceil(u), Math.ceil(u));
  }));
  return cv.toDataURL('image/png');
}
