# MyMuseum

Carnet de visite de musée pour Android (et navigateur).
Vous photographiez une œuvre qui vous plaît : elle est **reconnue par Claude**, une **fiche** est rédigée (contexte, description, analyse, artiste, anecdotes, détails à regarder, œuvres liées, lectures), puis l'œuvre est **rangée dans le dossier de son musée**, avec un sous-dossier par **exposition temporaire**.

## Fonctionnement

- **Photographier** : prenez une photo ou importez-en une. Claude propose une identification avec un niveau de confiance et d'autres pistes ; vous validez ou corrigez avant que la fiche soit créée.
- **Je visite** : le musée, la ville et l'exposition en cours. Avec la **détection automatique**, l'app compare votre position aux musées d'OpenStreetMap à l'ouverture et quand vous y revenez après 20 minutes. Si vous êtes à l'intérieur d'un musée ou à moins de 120 m, il est rempli tout seul ; sinon, les lieux proches s'affichent et vous touchez le vôtre. Vous pouvez toujours saisir le lieu à la main : une saisie manuelle n'est pas remplacée automatiquement pendant 4 heures.
- **Musées** : un dossier par musée, séparé en « Collections permanentes » et « Exposition « … » » avec les dates de visite. Les œuvres prêtées par une autre institution portent l'étiquette *Prêt*.
- **Œuvres** : toutes les fiches, avec une recherche (titre, artiste, musée, mot-clé) et un filtre coups de cœur.
- **Fiche** : notes personnelles, questions à Claude sur l'œuvre (réponses conservées), coup de cœur, correction du lieu, régénération, copie.

## Installer l'APK sur le téléphone

1. Chaque envoi sur `main` compile l'APK (onglet **Actions**) et le publie dans **Releases**.
2. Depuis le téléphone, ouvrez la dernière Release et touchez **MyMuseum.apk**.
3. Autorisez l'installation depuis le navigateur si Android le demande.
4. Les mises à jour s'installent par-dessus l'ancienne version **sans perdre les fiches** : la clé de signature est fixe (`android-signing/debug.keystore`).

> La clé de signature est une clé de type « debug » (mot de passe `android`), commitée exprès pour que chaque build puisse mettre à jour le précédent. Elle convient à une app personnelle installée à la main, pas à une publication sur le Play Store.

## Clé API Anthropic

La reconnaissance utilise l'API Claude avec **votre propre clé** :

1. Créez une clé sur <https://console.anthropic.com/settings/keys> (compte API, facturé à l'usage, distinct de l'abonnement claude.ai).
2. Dans l'app : **Réglages** (roue dentée) → collez la clé → **Tester la clé**.

La clé reste sur l'appareil et n'est envoyée qu'à `api.anthropic.com`. Dans les réglages, on choisit aussi le modèle (Sonnet 5.5 par défaut, Opus 5.5 plus précis, Haiku 5.5 plus économique) et on active ou non la vérification sur le web.

## Données et sauvegarde

Les fiches et les photos sont stockées **uniquement sur l'appareil**. **Réglages → Exporter une sauvegarde** crée un fichier `.json` (photos incluses) à envoyer vers Drive ou ailleurs ; **Importer** le restaure, par exemple sur un nouveau téléphone.

## Version web

Le dossier `www/` est une application web autonome, sans étape de compilation :

- en local : `npm run serve`, puis <http://localhost:8080> ;
- en ligne : **Settings → Pages → Source : GitHub Actions** ; le workflow *Version web* publie alors `www/` à chaque envoi. Sur un téléphone, « Ajouter à l'écran d'accueil » l'installe comme une app.

## Développement

```
www/                 l'application (HTML, CSS, JS)
android-res/         icônes Android (générées par scripts/make_icons.py)
scripts/             génération des icônes, préparation du projet Android
android-signing/     clé de signature stable
.github/workflows/   build de l'APK, publication web
```

Build Android en local (Node 22, JDK 21, SDK Android) :

```
npm install
npx cap add android
node scripts/android-setup.mjs
npx cap sync android
cd android && ./gradlew assembleDebug
```

Lieux : © contributeurs OpenStreetMap, via l'API Overpass.
