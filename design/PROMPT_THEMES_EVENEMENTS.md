# Prompt pour Claude (artefact) : thèmes d'événements pour Boombox

Copie tout le bloc ci-dessous dans une nouvelle conversation Claude.

---

Tu es directeur artistique. Crée un **artefact HTML** qui présente un système de **thèmes d'événements** pour mon appli musicale **Boombox** (façon Spotify, desktop + iPhone).

## Ce qu'est Boombox (à respecter)
- **Direction artistique actuelle : pixel art.**
  - Fond très sombre violet-noir `#131019`, accent violet `#b07cf7`, vert « en direct » `#2ef28b`.
  - Police ronde et grasse pour les titres, interface sombre façon Spotify.
- **Logo :** un **boombox (radio-cassette) en pixel art violet**, deux haut-parleurs ronds, avec le mot **BOOMBOX** en lettres pixel. Une mascotte pixel existe aussi (stickers).
- **Animations :**
  - fonds animés en pixels (dégradé tramé façon Bayer 4×4) dans les styles vagues, anneaux, plasma, pluie, étoiles, cœurs ;
  - petits pixels colorés qui flottent ;
  - logo qui rebondit au démarrage avec des ondes.
- **Écrans principaux :**
  - l'accueil, avec les rangées « Recommandé pour toi », « Conçu pour toi », « Tes mix », « En direct » (amis) et les playlists ;
  - le lecteur, avec ses paroles ;
  - le récap et les statistiques, exportés en story vidéo 1080×1920 et en image.

## Ce que je veux
Un thème pour chaque événement, qui s'active tout seul aux bonnes dates :
1. **Noël**, du 1er au 26 décembre
2. **Nouvel An**, du 27 décembre au 2 janvier
3. **Saint-Valentin**, du 7 au 14 février
4. **Pâques**, la semaine de Pâques
5. **Fête de la musique**, du 18 au 21 juin
6. **Été / vacances**, du 1er juillet au 31 août
7. **Rentrée**, du 1er au 15 septembre
8. **Halloween**, du 20 au 31 octobre
9. **Anniversaire de l'utilisateur**, le jour de son anniversaire (bonus)

## Pour CHAQUE événement, montre
1. **Le logo décliné en pixel art.** C'est le même boombox, habillé pour l'événement : bonnet et guirlande pour Noël, citrouille et toiles pour Halloween, cœurs pour la Saint-Valentin, lunettes de soleil et bouée pour l'été… Il doit rester reconnaissable et lisible en petit (32 px) comme en grand.
2. **La palette** : 4 à 6 couleurs. L'appli reste sombre et lisible, seul l'accent change.
3. **Le décor animé du fond**, dans le même style pixel tramé : neige qui tombe, feux d'artifice, cœurs qui montent, chauves-souris et brume, bulles et soleil, confettis de notes de musique… Décris précisément l'animation : vitesse, densité, couleurs. Elle doit rester discrète derrière le contenu.
4. **Une maquette de l'accueil** avec le thème appliqué, incluant une rangée **« Playlists de saison »** :
   - Noël : « Noël au chaud », « Classiques de Noël », « Noël rap FR » ;
   - Halloween : « Halloween », « Sons qui font peur » ;
   - été : « Vacances d'été », « Road trip », « Apéro au soleil », « Hits de l'été » ;
   - Saint-Valentin : « Love songs », « Cœur brisé » ;
   - et ainsi de suite pour chaque événement, chacune avec une pochette pixel art cohérente avec le thème.
5. **Le récap et les statistiques exportés** : une carte story 1080×1920 avec l'animation propre à l'événement. Par exemple, la neige qui recouvre le top artistes pour Noël, les chiffres qui sortent d'une citrouille pour Halloween, des cœurs qui éclatent autour du son le plus écouté pour la Saint-Valentin. Montre un exemple statique de chaque carte et décris l'animation image par image (entrée, boucle, sortie).
6. **Un petit bandeau d'accueil** : « 🎄 Joyeux Noël, Matis ! Tes playlists de saison sont prêtes », avec un bouton pour couper le thème.

## Contraintes
- **Même ADN pour tous les thèmes :** pixel art, coins arrondis, fond sombre. Le logo garde sa silhouette.
- **Lisible :** contraste suffisant (WCAG AA) pour le texte sur le fond animé.
- **Réglable :** prévois un réglage « Thèmes d'événements : Auto / Toujours le thème de base » dans les Paramètres.
- **Intégrable :** donne pour chaque thème les **tokens CSS** (`--accent`, `--accent-2`, `--bg-tint`, `--particles: …`) et la **description de l'animation**, pour que je puisse l'intégrer dans le code existant, qui dessine déjà ses fonds pixel sur un canvas (styles vagues, anneaux, plasma, pluie, étoiles, cœurs).
- **Logos utilisables :** les logos en **SVG pixel** (rectangles), téléchargeables depuis l'artefact.

Présente tout ça dans un seul artefact : un sélecteur d'événement en haut, et pour chaque événement le logo, la palette, l'aperçu du fond animé, l'accueil, la carte de récap et les tokens.
