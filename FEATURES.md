# Boombox : fonctionnalités

## Fait
- [x] Recherche vocale, vitesse de lecture, couleur d'accent, gestes mobiles, « Ne plus proposer », mini-lecteur flottant (aléatoire + ajout à une playlist)
- [x] **Fondu enchaîné** réglable de 0 à 12 s (audio direct)
- [x] **Import CSV fiable** (Exportify, TuneMyMusic, Soundiiz, Excel ; virgule/point-virgule, tous encodages) et **import de plusieurs fichiers / d'un .zip d'un coup**
- [x] Import des **données Spotify** (abonnements, likes, historique d'écoute)
- [x] **Like automatique** des titres ajoutés à une playlist (désactivable)
- [x] Pages d'artiste : **top 10** du moment avec **nombre de lectures** + **auditeurs mensuels**
- [x] **Photo et page de profil** façon Spotify (tops du mois, playlists, abonnements)
- [x] **Dossiers de playlists**
- [x] **Découverte** : nouveaux artistes et sons, par style ou « pour toi » (artistes de référence modifiables), sons aléatoires, ajout rapide à une playlist
- [x] **Récap complet** : minutes, écoutes, évolution vs période précédente, écoutes par jour/mois, heures et jours d'écoute, séries de jours, top artistes/titres/albums, découvertes
- [x] IA : « mets tous les sons de mes playlists dans mes titres likés » (+ bouton direct sur Titres likés)
- [x] Paroles multi-sources (lrclib, NetEase, YouTube Music/Musixmatch, lyrics.ovh), soulignées au survol
- [x] Panneau de droite élargi et redimensionnable

- [x] **Mode soirée** : QR code → page invité sans compte ; recherche ou lien Spotify / Deezer / YouTube / Apple Music → la file de la soirée ; écran soirée plein écran pour la télé
- [x] **Automix** : analyse du tempo, des temps forts, de la tonalité (Camelot), du volume et de l'outro ; aléatoire harmonique ; transitions calées sur le temps fort avec tempo ajusté, échange des basses et volumes égalisés

- [x] File d'attente réordonnable, Mix du jour, récap annuel animé (Wrapped), partage de playlist avec un ami (code)
- [x] Mode soirée hors Wi-Fi : recherche des invités via l'hôte + page invité hébergeable sur Firebase Hosting

## Appli mobile (SideStore / Android)
- [x] Même interface, « serveur » embarqué dans le téléphone (fonctionne PC éteint)
- [x] Écoute hors ligne : playlists et likes téléchargés, limite d'espace, cache intelligent, Wi-Fi uniquement
- [x] Lecture en veille (iOS), lien direct depuis le PC (QR boombox://), alerte avant expiration SideStore
- [x] Compilation automatique sur GitHub (IPA + APK) et source SideStore pour les mises à jour
- [ ] À valider sur ton iPhone (installation via SideStore)
- [ ] Widgets écran d'accueil, lecture en veille fiable sur Android (service natif)
