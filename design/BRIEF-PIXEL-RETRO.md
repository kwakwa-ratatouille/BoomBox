# Brief Claude Design — direction artistique « pixel art rétro » de Boombox

> Colle tout le bloc **Prompt** ci-dessous dans Claude Design. Demande d'abord la maquette (étape 1),
> valide-la, puis demande les fichiers (étape 2). Dépose les fichiers exportés dans `public/assets/`
> en gardant **exactement** les noms indiqués : l'appli les reprendra automatiquement.

---

## Prompt

Tu es directeur artistique et designer d'interface. Refais la **direction artistique complète** de
**Boombox**, une appli de musique perso façon Spotify (iPhone, Android, PC) : recherche de titres,
playlists, lecteur plein écran avec paroles, amis et messages, classement entre utilisateurs, mode party
(écran géant avec QR code), récap annuel animé, assistant IA.

### L'univers : pixel art rétro, mais stylé et moderne
- Inspiration : jeux 8/16 bits, borne d'arcade, radio-cassette des années 80, écran CRT — **revisités
  proprement** : beaucoup d'espace, contrastes nets, pas de fouillis. On doit sentir « jeu vidéo rétro
  premium », pas « site amateur des années 2000 ».
- Interface **sombre**. Fond principal violet très profond `#131019`, panneaux `#1B1626`, cartes `#241D33`.
- Couleur principale : **violet `#B07CF7`** (déjà la couleur de marque, garde-la).
  Couleurs d'appoint façon palette 16 bits : jaune or `#FFD34D` (récompenses, « Ton top », podium),
  cyan `#3FD0FF`, rose `#FF4FA3`, vert `#2EF28B`. Texte blanc `#FFFFFF`, texte secondaire `#A7A3B3`.
- Le **logo actuel** (boombox violet aux deux haut-parleurs ronds, l'un avec un ▶) doit être
  **redessiné en pixel art** sur une grille de 16×16 (lisible en icône) et décliné en 32×32 et 64×64.

### Typographie
- Titres et logotype : une police pixel lisible (ex. **Press Start 2P** ou **Silkscreen**, Google Fonts),
  utilisée avec parcimonie (titres de page, chiffres du récap, boutons importants).
- Texte courant : **Figtree** (déjà utilisée), pour que les listes de titres restent très lisibles.
- Montre les tailles : titre de page, titre de section, ligne de titre (titre + artiste), petit texte.

### Composants à dessiner (desktop 1440 px ET mobile 390 px)
1. **Boutons** (principal, secondaire, icône rond) : coins « en escalier » pixel (pas d'arrondi lisse),
   ombre portée pixel de 2–4 px décalée, état survol et appui (le bouton « s'enfonce » de 2 px).
2. **Cartes** (album, playlist, artiste rond) et **ligne de titre** dans une liste.
3. **Barre de lecture** en bas (pochette, titre, contrôles, barre de progression et de volume en
   segments pixel), et **lecteur plein écran mobile** (grande pochette, paroles dessous).
4. **Icônes** : jeu complet en pixel art 24×24 (accueil, recherche, bibliothèque, découverte, IA ✦,
   lecture, pause, suivant, précédent, aléatoire, répéter, cœur vide/plein, plus, ⋯, amis, message,
   classement, party, paramètres, téléchargement, volume, micro).
5. **Champ de recherche**, **onglets / puces** de filtre, **interrupteur** (on/off) des paramètres.
6. **Notification toast** (bandeau en bas), **menu contextuel** et **feuille du bas** sur mobile.
7. **Écrans** : Accueil, Recherche, Page playlist, Page artiste, Profil (avec bannière), Classement
   (podium or / argent / bronze), Messages, Paramètres, Lecteur plein écran mobile, Écran géant party.

### Animation (décris-la précisément, l'appli la code en CSS)
- **Fond de l'appli** : de petits cubes pixel dispersés, très transparents, qui **se retournent
  verticalement** (rotation sur l'axe horizontal) l'un après l'autre, comme une vague qui descend de haut
  en bas de l'écran. Discret, jamais gênant pour lire.
- **Écran de lancement** : garder l'idée actuelle — la boombox (en version pixel) **saute** en rythme,
  s'écrase un peu en touchant le sol, et envoie une **onde circulaire** à chaque atterrissage.
- Micro-animations : bouton qui s'enfonce, cœur qui « pixel-explose » quand on like, égaliseur 3 barres
  pixel quand un son joue. Indique durées et courbes (ex. `steps(4)` pour un effet saccadé rétro).
- Tout doit rester léger : uniquement des déplacements, rotations et opacité.

### Étape 1 — maquette à valider
Une planche `pixel-ui-board.png` (2400×1600) avec : palette (codes hex), typos, logo pixel, boutons,
cartes, icônes, et 3 écrans clés (Accueil desktop, Lecteur plein écran mobile, Classement).

### Étape 2 — fichiers à livrer (PNG, fond transparent sauf mention)
| Fichier | Taille | Contenu |
|---|---|---|
| `logo-symbol.png` | 1024×1024 | Boombox pixel art seule (pixels nets, pas de lissage) |
| `logo-horizontal.png` | 2000×600 | Symbole + « BOOMBOX » en police pixel, pour fond sombre |
| `logo-vertical.png` | 1200×1400 | Symbole au-dessus du nom |
| `app-icon-1024.png` | 1024×1024 | Icône iOS, fond plein `#131019`, sans coins arrondis |
| `app-icon-512.png` / `app-icon-192.png` | 512 / 192 | Icônes PWA / Android |
| `app-icon-maskable-512.png` | 512×512 | Symbole dans le cercle central de 80 %, fond plein |
| `favicon-32.png` / `favicon-16.png` | 32 / 16 | Version 16×16 pixel parfaite |
| `cover-liked.png` | 640×640 | « Titres likés » : cœur pixel sur dégradé violet |
| `cover-default.png` | 640×640 | Playlist vide : note de musique pixel |
| `cover-ai-mix.png` | 640×640 | Playlists de l'IA : étincelle ✦ pixel |
| `cover-jam.png` | 640×640 | Mode party : boombox + ondes pixel, couleurs vives |
| `empty-library.png` / `empty-search.png` | 800×600 | Illustrations pixel « bibliothèque vide » / « aucun résultat » |
| `icons-pixel.svg` | — | Toutes les icônes 24×24 en un seul fichier SVG (une `<symbol id="…">` par icône, mêmes noms que la liste ci-dessus) |
| `design-tokens.json` | — | Couleurs, polices, tailles, rayons/ombres pixel, durées d'animation |

### Contraintes
- Pixels **nets** (pas d'anticrénelage), grille cohérente : tout aligné sur des multiples de 2 px.
- Lisibilité d'abord : contraste AA minimum pour le texte, la police pixel jamais en dessous de 12 px.
- Aucun logo de marque existante (Spotify, YouTube, Apple…).
