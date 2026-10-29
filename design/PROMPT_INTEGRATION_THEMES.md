# Prompt pour Claude Code : intégrer les thèmes d'événements

Copie tout le bloc ci-dessous dans Claude Code, ouvert sur le dossier BoomBox.

---

Intègre les **thèmes d'événements** dans Boombox (DA pixel). Le moteur est déjà écrit et testé : ton travail est de le **brancher** dans l'appli existante, sans réécrire ce qui marche.

## Fichiers déjà fournis

- `public/js/events-pixel.js` : module ES (`export { BBEvents }`). Ne le réécris pas ; corrige-le seulement si un vrai bug apparaît, et dis-le-moi.
  - `BBEvents.eventFor(date, { mode, muted, birthday })` renvoie `{ id, key }`. `id` vaut `noel`, `nouvel-an`, `valentin`, `paques`, `musique`, `ete`, `rentree`, `halloween`, `anniversaire` ou `base`. `key` identifie l'occurrence (ex. `halloween-2026`).
  - `BBEvents.themePainter(id)` renvoie un peintre `(img, w, h, t)` : même signature que `fieldPainter` de `public/js/pixel-bg.js` (champ tramé Bayer + particules du thème).
  - `BBEvents.logoSVG(id, size)` renvoie le logo 32×32 habillé, en SVG.
  - `BBEvents.cssTokens(id)` renvoie le bloc de tokens CSS d'un thème.
  - `BBEvents.THEMES[id]` contient le nom, les dates, l'accent, l'accent 2, la teinte de fond, les swatches et les réglages du fond.
- `design/themes-evenements/planche-themes.html` : la planche de référence. Ouvre-la pour voir le rendu attendu, les textes des bandeaux, les playlists de saison et la description image par image des cartes récap (objet `EV` dans le script).
- `design/themes-evenements/logos/logo-<id>.svg` : les 10 logos en SVG pixel.

## Ce qu'il faut brancher

1. **Activation**
   - Calcule le thème du jour au démarrage avec `eventFor(new Date(), …)`. Lis les clés localStorage `bb-events` (`auto` | `base`, défaut `auto`), `bb-event-off` (clé de l'événement coupé) et `bb-birthday` (`MM-JJ`).
   - Pose `document.documentElement.dataset.event = id`. Fais-le dans le petit script inline du `<head>` de `public/index.html` (là où `bb-da`, `bb-anim` et `bb-accent` sont déjà lus), pour éviter un flash au chargement.
   - Le thème n'existe qu'en DA pixel (`bb-da` = `pixel`). En DA Spotify, rien ne change.
2. **Tokens CSS**
   - Ajoute dans `public/css/app.css` les blocs `:root[data-event="…"]` (texte complet : `ORDER.map(cssTokens)`, ou la case « Tous les tokens CSS » de la planche).
   - Seul l'accent change : le fond reste sombre.
   - **Attention :** si l'utilisateur a choisi sa couleur à la main (`bb-accent`, posée en style inline sur `<html>`), garde sa couleur pour `--accent`. Dans ce cas, le thème ne change que le fond, le logo, le bandeau et les playlists de saison.
3. **Fonds animés**
   - Dans `pixelBackdrop()` (`public/js/pixel-bg.js`), quand un événement est actif, utilise `BBEvents.themePainter(id)` à la place de `fieldPainter(...)`. Fais-le pour l'accueil et les bannières de playlists.
   - Laisse la party, le Jam, le classement et la découverte avec leurs palettes actuelles.
   - Respecte `animationsOff()` et `prefers-reduced-motion` comme aujourd'hui.
4. **Logo**
   - Dans l'en-tête (`.brand-logo`, actuellement `/assets/logo-symbol.png`) et sur le splash (`.sp-box`), affiche `logoSVG(id)` quand un événement est actif.
   - Garde le PNG pour `base`.
   - L'animation de rebond du splash doit continuer de marcher.
5. **Accueil** (`public/js/views.js`)
   - **Bandeau** en haut de l'accueil : icône pixel, texte du thème (ex. « Joyeux Halloween, Matis ! Tes playlists qui font peur sont prêtes », prénom réel de l'utilisateur), bouton « Couper le thème » et ✕.
   - Le bandeau s'affiche une fois par jour pendant l'événement. ✕ le ferme pour la journée.
   - « Couper le thème » écrit `bb-event-off = key` puis réapplique le thème de base sans recharger si possible.
   - **Rangée « Playlists de saison »** en première position, avec les titres de la planche (objet `EV[id].playlists`).
   - Ces playlists sont des recherches ou mix générés par l'appli : réutilise le mécanisme existant le plus proche (mix, radios, recherche) plutôt que d'inventer un service. Si aucun ne convient, demande-moi avant.
   - Les pochettes sont en pixel art, générées comme dans la planche (`makeCover` + sprites `SPR`).
6. **Paramètres** (`public/js/views-extra.js`, à côté du réglage des animations `#s-anim`)
   - « Thèmes d'événements : Auto / Toujours le thème de base » (clé `bb-events`).
   - Champ facultatif « Date d'anniversaire » (clé `bb-birthday`).
   - Si un événement a été coupé par le bandeau, ajoute un lien « Réactiver ».
7. **Récap et statistiques exportés** (`public/js/story.js`, `views-wrapped.js`)
   - Quand un événement est actif, la story 1080×1920 utilise le fond du thème, le logo habillé et l'animation propre à l'événement : entrée, boucle, sortie, décrites image par image dans la planche (`EV[id].phases`). La fonction `drawCard` de la planche sert de référence.
   - Adapte-la à la vraie mise en page de `makeStory`, sans remplacer cette mise en page.
   - Garde les exports image et vidéo actuels.
8. **iPhone**
   - Vérifie que tout marche aussi dans `public/iphone.html` / Capacitor (`mobile/`). Le bandeau doit passer sur deux lignes en largeur téléphone.

## Contraintes

- Même ADN pour tous les thèmes : pixel art, coins arrondis, fond sombre. Le texte doit rester lisible (WCAG AA) : le contenu reste sur les cartes `--panel` existantes.
- Pas de nouvelle dépendance.
- Mets à jour `public/changelog.json` comme pour les autres fonctionnalités.

## Vérification attendue

- Lance l'appli et teste au moins Halloween (aujourd'hui), Noël, Nouvel An (passage du 31/12 au 1/1) et le thème de base. Simule la date en passant une date à `eventFor` le temps du test, puis retire la simulation.
- Vérifie : le réglage « Toujours le thème de base », le bouton « Couper le thème » puis « Réactiver », l'anniversaire, les animations coupées, la DA Spotify (aucun changement) et un export de story.
- Termine par la liste des fichiers modifiés et ce que tu n'as pas pu tester.
