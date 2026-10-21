# DA pixel : icônes et images (pour Claude Code)

Les deux DA coexistent : `localStorage['bb-da']` = `pixel` (défaut) ou `spotify` (ancienne).
Rien de l'ancienne DA n'a été supprimé.

## Icônes
- `public/js/icons-pixel.js` : objet `PIXEL`, 66 icônes pixel **24×24** (1 pixel = 1 unité du viewBox 24),
  mêmes noms que le dictionnaire `P` de `ui.js` (+ `discover`, `leaderboard`, `info`).
  Branché tel quel sur `icon()` et sur le remplacement des icônes en dur de `index.html` (`ui.js`).
- L'ancienne version 12×12 est sauvegardée dans `design/backup-icones-12x12/icons-pixel.js`.
- Fichiers séparés si besoin : `public/assets/pixel/icons/<nom>.svg` et sprite `public/assets/pixel/icons-pixel.svg`
  (`<symbol id="<nom>">`, `fill="currentColor"`, `shape-rendering="crispEdges"`).
- Nettes à 24 px (et multiples : 48, 72). À 16 px la grille est rééchantillonnée (léger flou).
- `icon('info')` est appelé dans l'appli mais `P.info` n'existe pas : en DA Spotify l'icône reste vide.

## Images (DA pixel)
Dossier `public/assets/pixel/`, mêmes noms que les originales de `public/assets/` :
cover-liked, cover-default, cover-ai-mix, cover-jam, empty-library, empty-search, onboarding,
og-image, splash-1242x2688, android-foreground-432, android-background-432, logo-horizontal-light.

Branchement : en fin de `public/css/app.css`, bloc « Images de la DA pixel » :
`.da-pixel img[src^="/assets/<nom>.png"] { content: url('/assets/pixel/<nom>.png'); }`
→ aucun chemin à changer dans le JS, et les pochettes déjà enregistrées (ex. `/assets/cover-ai-mix.png`) suivent aussi.
`og:image` de `index.html` pointe vers `/assets/pixel/og-image.png`.
Non branchés (pas de thème possible) : splash et icônes Android de `public/assets/pixel/` ;
les ressources natives de `resources/` sont déjà en pixel.
