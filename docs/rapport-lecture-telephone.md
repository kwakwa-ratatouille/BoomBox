# Rapport : fluidité de la lecture (téléphones surtout)

À l'attention d'une autre conversation Claude chargée d'optimiser la lecture dans Boombox.
Dépôt : `C:\Users\Perri\Desktop\Projets Claude\Boombox\BoomBox` (GitHub kwakwa-ratatouille/BoomBox, branche main).
Publication web : `npm run -s publish:web` puis commit + push. Les téléphones prennent la mise à jour web au redémarrage de l'appli.
Ne pas committer le travail Android Auto non suivi dans `mobile/plugins/boombox-native/android/...`.

## Symptômes rapportés (iPhone, Android et PC)
- On lance un son (même **déjà téléchargé**), on avance ou on recule dedans : ça bloque, puis ça se met en pause tout seul.
- Le démarrage d'un son n'est pas rapide, même téléchargé.
- Le problème existe depuis longtemps (pas lié à une mise à jour récente).

## Déjà corrigé (24/11/2026)
1. `public/js/player.js`, `_tick()` : la sécurité « lecture automatique bloquée » (`_loadAt`) mettait en pause après un retour au
   début du son (bouton précédent → `seek(0)` → événement `waiting`) ou un chargement lent, car `_loadAt` n'était jamais remis à 0.
   Maintenant remis à 0 dans `onPlaying`, et pour l'audio direct, la sécurité ne joue que si l'élément est vraiment arrêté.
   Reproduit puis vérifié sur PC (profil « Test Claude » créé dans le navigateur de prévisualisation).
2. `sysPause()` (player.js) : une « pause » envoyée par la notification Android / l'écran verrouillé iPhone moins de 2,5 s après
   une action dans l'appli (`_actAt` : seek, prev, next, `_load`) avec l'appli visible est ignorée et signalée dans les rapports
   (« Pause système ignorée … »). Hypothèse non vérifiée sur appareil.
3. Commit 7933efe (autre session) : `mobile/local-api.js` `warmAudio()` met les sons téléchargés en mémoire (blob, 4 max) ;
   le son suivant est préparé pendant l'écoute du précédent (player.js ~l.801).

## Pistes restantes, par priorité
1. **Premier son lancé directement** : lu depuis le fichier (`convertFileSrc`) tant que la mise en mémoire n'est pas finie ;
   une avance pendant ce temps relit le fichier (grosse pause). Correctif en cours dans cette conversation : à l'avance, attendre
   la mise en mémoire (2 s max) puis recharger le son depuis la mémoire au bon endroit.
2. **Cache mémoire limité à 4 sons** (`blobSrc`) : revenir sur un son plus ancien = cas 1. Évaluer une taille selon la mémoire,
   ou garder le son en cours + 2 suivants + 2 précédents.
3. **Démarrage** : mesurer le temps entre `_load` et `onPlaying` sur téléphone (journaliser dans les rapports `errors` avec
   la plateforme) pour savoir si la lenteur vient du fichier, du réseau ou de `wakeAudio()`.
4. **Pauses système** : les rapports Firestore (`errors`, lecture via inscription anonyme, voir mémoire « crash-reports »)
   montrent ~179 « Pause imprévue : commande de la notification » (Android) et ~152 « … écran verrouillé ou des écouteurs »
   (iOS). Une partie sont de vraies pauses. Vérifier si les « Pause système ignorée » apparaissent après la mise à jour.
   Côté Android natif : `BoomboxNativePlugin.java` `MediaSession.Callback.onPause` → `emit("pause")`.
5. **iOS `onPaused` auto-relances** (player.js `handlers.onPaused`) : 3 relances max par minute ; voir si un saut déclenche
   un `pause` de l'élément sur iOS et compte comme pause imprévue.

## Limites
- Aucun téléphone pour tester : il faut faire confirmer par les utilisateurs.
- Le navigateur de prévisualisation ne reproduit que la partie web (PC), pas le stockage natif des téléphones.
