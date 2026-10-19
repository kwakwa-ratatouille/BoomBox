# Boombox 🎵

Lecteur de musique perso façon Spotify, qui va chercher la musique sur YouTube / YouTube Music.

## Lancer

```
npm install
npm start
```

Ensuite ouvre **http://localhost:8787** sur le PC.
Sur ton téléphone (même Wi-Fi) : ouvre l'adresse `http://192.168.x.x:8787` affichée dans le terminal (aussi dans Paramètres), puis « Ajouter à l'écran d'accueil ».

## Fonctionnalités

- Recherche (titres, artistes, albums, playlists, clips) avec suggestions
- Lecture, file d'attente (« Ajouter à la file », « Lire ensuite »), aléatoire, répétition (tout / un titre)
- Lecture automatique de titres similaires à la fin d'une playlist, radio d'un titre / d'un artiste
- Titres likés, playlists (créer, renommer, description, image, épingler, dupliquer, glisser-déposer, réordonner)
- Recommandations en bas de chaque playlist
- Pages artiste et album, abonnement aux artistes + page **Nouveautés** (sorties marquées « nouveau »)
- Import de playlists : Spotify, Deezer, YouTube, texte « Artiste - Titre », CSV (Exportify, TuneMyMusic)
- Paroles synchronisées (lrclib.net), vue clip vidéo
- Plusieurs profils (chacun sa bibliothèque)
- Appareils connectés : piloter / transférer la lecture d'un appareil à l'autre (façon Spotify Connect), via Internet
- **Jam** : file commune, chacun ajoute des titres depuis son appareil
- Ton récap (stats d'écoute), historique, minuteur de sommeil, raccourcis clavier, contrôles système (touches média)
- Sauvegarde / restauration de la bibliothèque (JSON)

## Options

- **yt-dlp** (recommandé) : lecture audio directe au lieu du lecteur YouTube intégré.
  `winget install yt-dlp` puis relance `npm start`. (Ou mets `yt-dlp.exe` dans `bin/`.)
- **Import Spotify complet** (dates d'ajout, playlists de plus de 100 titres) : crée une app gratuite sur
  developer.spotify.com/dashboard, puis colle le Client ID et le Client Secret dans **Paramètres → Import Spotify**
  (ils sont enregistrés dans `config.json`, sur ce PC uniquement).

Les imports conservent l'ordre, la date d'ajout de chaque titre (Deezer, Spotify avec clé, CSV), l'image,
la description et l'auteur de la playlist d'origine. L'image d'une playlist se change en cliquant dessus.

## Assistant IA (Gemini, gratuit)

Page **Assistant IA** : crée une playlist à partir d'une description (« rap chill pour réviser, 30 titres »),
complète une playlist existante dans le même style, ou recommande des artistes. L'IA tient compte de tes
artistes les plus écoutés, et chaque titre proposé est retrouvé sur YouTube Music.
Clé gratuite sur aistudio.google.com/apikey, à coller dans **Paramètres → Assistant IA**.

## Synchronisation (Firebase)

La bibliothèque (profils, playlists, likes, artistes suivis, historique) est stockée dans Firebase Firestore
(gratuit) : elle se synchronise en direct entre tous les appareils liés, fonctionne hors ligne et reste
disponible même quand le PC est éteint. Le serveur local ne sert plus qu'à YouTube (recherche, audio, paroles, import).

- Config du projet : `public/js/firebase-config.js`
- Règles de sécurité : `firestore.rules` → à coller dans la console Firebase (Firestore → Règles → Publier)
- Lier un appareil : Paramètres → Lier mes appareils (QR code ou lien)

## Mode soirée partout (invités sur la 4G)

Par défaut, les invités doivent être sur le même Wi-Fi que le PC. Pour que la page invité marche partout,
mets-la en ligne une seule fois sur Firebase Hosting (gratuit) :

```
npx firebase-tools login
npx firebase-tools deploy --only hosting
```

Puis, dans la Jam, choisis « Partout (Internet) » : le QR code pointe vers https://musikal-b72d1.web.app.
Les recherches des invités passent alors par ton PC (il doit être allumé, avec Boombox ouvert).

## Appli mobile

Voir **MOBILE.md** : compilation gratuite sur GitHub, installation sur iPhone avec SideStore (et Android), écoute hors ligne.
