# Boombox sur iPhone (SideStore, gratuit) et Android

L'appli mobile reprend toute l'interface de Boombox, mais **sans le PC** : la recherche YouTube, les paroles,
l'import, la Découverte et l'IA tournent directement dans le téléphone. Tes playlists et likes sont ceux de
Firebase (les mêmes que sur le PC), et la musique continue écran verrouillé.

Chaque titre est téléchargé sur le téléphone avant d'être joué (le suivant est préparé pendant l'écoute) :
c'est ce qui permet le fondu, l'automix et l'**écoute hors ligne**, dans la limite d'espace que tu choisis
(Paramètres → Hors ligne).

---

## 1. Mettre le projet sur GitHub (une fois, ~10 min)

GitHub fabrique l'appli pour toi sur ses Mac, gratuitement.

1. Crée un compte sur https://github.com
2. Installe **GitHub Desktop** :
   ```
   winget install GitHub.GitHubDesktop
   ```
3. Ouvre GitHub Desktop → connecte-toi → **File → Add local repository** → choisis
   `C:\Users\Perri\Desktop\BoomBox` → il propose de **créer un dépôt** : accepte.
4. Écris un message (« Première version ») → **Commit to main** → **Publish repository**.
   - **Décoche « Keep this code private »** : SideStore doit pouvoir télécharger l'appli.
   - Rien de secret n'est publié : tes clés (Spotify, Gemini) restent dans `config.json`, exclu du dépôt.
5. Sur github.com, ouvre ton dépôt → onglet **Actions** : la compilation « Appli mobile » démarre (~15 min).
6. Quand elle est verte : onglet **Releases** → tu y trouves `Boombox.ipa` (iPhone) et `Boombox.apk` (Android).

Tu n'as **pas** besoin de recompiler ni de réinstaller à chaque modification : voir « Mises à jour sans réinstaller »
plus bas. Un nouveau Push (et une réinstallation via SideStore) ne sert que si un plugin natif change.

## 2. Installer SideStore sur l'iPhone (une fois, ~30 min)

Suis le guide officiel, étape par étape : **https://docs.sidestore.io** (section *Installation*).
Il faut ton PC une seule fois, ton identifiant Apple (gratuit) et ton iPhone branché.

## 3. Installer Boombox

Dans SideStore : **Sources → +** puis colle (remplace `TON-PSEUDO`) :
```
https://github.com/TON-PSEUDO/BoomBox/releases/latest/download/source.json
```
→ Boombox apparaît → **Installer**. Les mises à jour arriveront ensuite dans SideStore comme sur l'App Store.

(Autre méthode : télécharge `Boombox.ipa` depuis Releases sur l'iPhone, puis SideStore → **Mes apps → +**.)

## 4. Renouvellement automatique (tous les 7 jours)

Avec un identifiant Apple gratuit, les applis installées expirent au bout de 7 jours. Pour ne jamais y penser :
- Dans SideStore → Réglages : active le **rafraîchissement en arrière-plan**.
- App **Raccourcis** → Automatisation → **Nouvelle** → « Heure de la journée » (ex. 3 h, tous les jours) →
  action **SideStore → Tout rafraîchir** → désactive « Demander avant d'exécuter ».

Boombox t'avertit de toute façon **2 jours avant l'expiration**, avec un bouton « Renouveler ».

## 5. Premier lancement

1. Sur le PC : Boombox → **Paramètres → Lier mes appareils**.
2. Avec l'appareil photo de l'iPhone, scanne le **second QR code** (« Appli mobile ») → « Ouvrir dans Boombox ».
3. Ta bibliothèque apparaît. Pour l'écoute hors ligne : bouton ⬇ sur une playlist ou sur Titres likés.

L'icône Boombox est sur l'écran d'accueil dès l'installation (c'est ton raccourci). Les appareils liés se gèrent
dans **Paramètres → Appareils liés** (sur n'importe quel appareil) : tu peux y délier un téléphone perdu.

### Gestes
- Glisser un titre vers la **droite** → ajouté à la file d'attente.
- Glisser vers la **gauche** → menu « Ajouter à une playlist » (les dossiers se déroulent).
- **Appui long** sur un titre → menu complet (en bas de l'écran).

### Code du profil
Paramètres → **Code du profil** : 4 chiffres, demandés quand on choisit ce profil sur un appareil ou qu'on
change de profil (pas à chaque ouverture). Code oublié : taper **six fois 4** sur le clavier du code.

## Mises à jour sans réinstaller

L'appli télécharge toute seule la dernière interface au démarrage (~1 Mo) et la met en place à la prochaine
ouverture (ou tout de suite via la notification « Installer »). Si une version plante deux fois au démarrage,
elle revient automatiquement à la précédente. Pour publier les modifications faites sur le PC :
```
npm run publish:web
```

## Android

Télécharge `Boombox.apk` depuis Releases sur le téléphone et ouvre-le (autorise l'installation depuis cette source).
Pour tes amis sur Android, c'est tout : pas de renouvellement.

## Mettre à jour les règles Firebase et le mode soirée « partout »

Une fois (et après chaque modification de `firestore.rules`), depuis le dossier BoomBox :
```
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,hosting
```
Ça active le **partage de playlists** et met en ligne la page invité du **mode soirée** (invités sur la 4G).
