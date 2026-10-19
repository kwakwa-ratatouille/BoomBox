# Brief Claude Design — identité visuelle de Boombox

> Copie tout le bloc « Prompt » ci-dessous dans Claude Design. Une fois les fichiers exportés,
> dépose-les dans `public/assets/` en gardant **exactement** les noms indiqués : l'appli les utilisera
> automatiquement (icône d'appli, écran d'accueil, pochettes par défaut…).

---

## Prompt

Tu es directeur artistique. Crée l'identité visuelle complète de **Boombox**, une application de musique
personnelle (façon Spotify) pour iPhone, Android et PC : on y cherche des titres, on crée des playlists,
on écoute à plusieurs (« Jam »), et un assistant IA compose des playlists sur mesure.

### Personnalité
- Jeune, énergique, chaleureux, un peu rétro-cool : le **boombox** (radio-cassette des années 80) revisité
  de façon moderne et minimaliste.
- Ça doit rester lisible et simple à 16 px, et iconique à 1024 px.
- Interface sombre : fond `#121212` / `#000000`, texte blanc, couleur principale **vert néon `#1ED760`**.
  Couleurs d'accompagnement possibles : violet `#7C4DFF` (utilisé pour l'IA) et rose `#FF4D8D` (touches festives).
- Typographie de l'interface : **Figtree** (Google Fonts). Le logotype peut utiliser Figtree Black ou une
  typo géométrique arrondie compatible.

### Logo
1. **Symbole** : un boombox stylisé et géométrique (deux haut-parleurs ronds + poignée), réduit à
   l'essentiel. Les haut-parleurs peuvent évoquer des ondes sonores ou un bouton lecture ▶.
   Aucun texte dans le symbole.
2. **Logotype** « Boombox » (minuscules ou capitale initiale), à côté du symbole (version horizontale)
   et en dessous (version verticale).
3. Déclinaisons : sur fond sombre, sur fond clair, monochrome blanc, monochrome noir.

### Fichiers à livrer (PNG, fond transparent sauf mention contraire)

| Fichier | Taille | Contenu |
|---|---|---|
| `logo-symbol.png` | 1024×1024 | Symbole seul, transparent |
| `logo-horizontal.png` | 2000×600 | Symbole + « Boombox », pour fond sombre |
| `logo-horizontal-light.png` | 2000×600 | Idem, pour fond clair |
| `logo-vertical.png` | 1200×1400 | Symbole au-dessus du nom |
| `app-icon-1024.png` | 1024×1024 | **Icône iOS** : fond plein (pas de transparence), sans coins arrondis (iOS les ajoute), symbole centré dans ~70 % de la surface |
| `app-icon-512.png` | 512×512 | Icône PWA / Android |
| `app-icon-192.png` | 192×192 | Icône PWA |
| `app-icon-maskable-512.png` | 512×512 | Icône Android « maskable » : symbole dans le cercle central de 80 %, fond plein jusqu'aux bords |
| `android-foreground-432.png` | 432×432 | Avant-plan icône adaptative Android (symbole dans la zone sûre centrale de 264 px), transparent |
| `android-background-432.png` | 432×432 | Arrière-plan icône adaptative (couleur ou dégradé plein) |
| `favicon-32.png` / `favicon-16.png` | 32×32 / 16×16 | Favicon simplifié (lisible en tout petit) |
| `splash-1242x2688.png` | 1242×2688 | Écran de démarrage mobile : fond `#121212`, symbole centré (~25 % de la largeur), nom discret dessous |
| `cover-liked.png` | 640×640 | Pochette des « Titres likés » : dégradé violet→bleu (`#450AF5` → `#8E8EE5`) avec un cœur blanc |
| `cover-default.png` | 640×640 | Pochette par défaut d'une playlist vide : fond `#282828`, note de musique gris clair |
| `cover-ai-mix.png` | 640×640 | Pochette des playlists créées par l'IA : dégradé violet→vert avec une étincelle ✦ |
| `cover-jam.png` | 640×640 | Visuel de la Jam (écoute à plusieurs) : plusieurs ondes / silhouettes, couleurs vives |
| `empty-library.png` | 800×600 | Illustration « bibliothèque vide » (boombox posé, petites notes qui s'envolent), transparent |
| `empty-search.png` | 800×600 | Illustration « aucun résultat » (boombox avec un point d'interrogation), transparent |
| `onboarding.png` | 1200×900 | Illustration d'accueil : un PC et un téléphone reliés par des ondes musicales, transparent |
| `og-image.png` | 1200×630 | Image de partage : logo horizontal sur fond sombre avec un léger dégradé vert |

### Contraintes
- Style **flat / légèrement dimensionnel**, formes arrondies, pas de photo réaliste, pas de dégradés criards.
- Les illustrations reprennent les mêmes couleurs et le même trait que le logo.
- Aucun logo de marque existante (pas de Spotify, YouTube, Apple…).
- Fournis aussi une **planche récapitulative** (`brand-board.png`, 2400×1600) montrant le logo, les couleurs
  (codes hex), la typo et toutes les déclinaisons.
