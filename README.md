# MyMuseum

Carnet de visite de musée pour Android (et navigateur), **100 % gratuit**.
Vous photographiez une œuvre qui vous plaît : elle est identifiée, une **fiche** est créée à partir de **Wikidata** et **Wikipédia** (avec une analyse **Gemini** si vous ajoutez une clé gratuite), puis l'œuvre est **rangée dans le dossier de son musée**, avec un sous-dossier par **exposition temporaire**.

## Fonctionnement

- **Je visite** : le musée, la ville et l'exposition en cours. Avec la **détection automatique**, l'app compare votre position aux musées d'OpenStreetMap à l'ouverture et au retour après 20 minutes. Si vous êtes dans un musée ou à moins de 120 m, il est rempli tout seul ; sinon, les lieux proches s'affichent. La saisie à la main reste toujours possible.
- **Photographier** : la photo de l'œuvre est toujours gardée. Pour l'identifier :
  - **avec une clé Gemini** : la photo suffit, Gemini propose l'œuvre et l'app la relie automatiquement à Wikidata / Wikipédia ;
  - **sans clé** : cherchez l'œuvre par titre ou artiste (les œuvres du musée détecté apparaissent en premier), ou **photographiez le cartel** : il est lu sur le téléphone (Tesseract) puis recherché dans Wikidata.
  - Pas de réseau ? **Identifier plus tard** garde la photo et le lieu.
- **Fiche** : données Wikidata (artiste, date, technique, dimensions, mouvement, n° d'inventaire, ce qui est représenté), article Wikipédia par sections, présentation de l'artiste, image de référence ; avec Gemini en plus : contexte, analyse, détails à regarder, anecdotes, œuvres liées, et questions sur l'œuvre. Notes personnelles, coups de cœur, correction du lieu.
- **Musées** : un dossier par musée, séparé en « Collections permanentes » et « Exposition « … » ». Les œuvres prêtées par une autre institution portent l'étiquette *Prêt*.

## Clé Gemini gratuite (facultative)

1. Ouvrez <https://aistudio.google.com/app/apikey> et connectez-vous avec un compte Google.
2. Acceptez les conditions, puis **Create API key** (Google crée au besoin un projet par défaut).
3. Copiez la clé (elle commence par `AIza…`).
4. Dans MyMuseum : **Réglages** (roue dentée) → collez la clé → **Vérifier la clé**.

**Pour que cela reste à 0 €** : ne cliquez jamais sur « Set up billing » / « Upgrade » dans AI Studio et n'associez aucun moyen de paiement. Sans compte de facturation lié, le projet reste sur l'offre gratuite : quand le quota gratuit est atteint, l'API répond « quota dépassé » (l'app le signale et propose de continuer sans IA), elle ne facture pas. Vos quotas sont visibles sur <https://aistudio.google.com/rate-limit>.

À savoir : selon la page des tarifs de Google, les contenus envoyés sur l'offre gratuite peuvent servir à améliorer leurs produits. Les photos d'œuvres et vos questions passent donc chez Google ; vos fiches, elles, restent sur le téléphone.

L'app choisit d'elle-même un modèle « Flash » gratuit (Gemini 3.5 Flash en priorité) et passe au suivant si l'un n'est pas disponible gratuitement ou a épuisé son quota du jour.

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

L'application est à la racine du dépôt, sans étape de compilation, et GitHub Pages la sert à **<https://karimhx4.github.io/MyMuseum/>**. Sur un téléphone, « Ajouter à l'écran d'accueil » l'installe comme une app. En local : `npm run serve`, puis <http://localhost:8080>.

## Développement

```
index.html, app.js,  l'application web (servie telle quelle par GitHub Pages)
style.css, sw.js…
android-res/         icônes Android (générées par scripts/make_icons.py)
scripts/             copie de l'app dans dist/ pour Android, icônes, préparation du projet Android
android-signing/     clé de signature stable
.github/workflows/   build de l'APK
```

Build Android en local (Node 22, JDK 21, SDK Android) :

```
npm install
node scripts/build-web.mjs
npx cap add android
node scripts/android-setup.mjs
npx cap sync android
cd android && ./gradlew assembleDebug
```

Lieux : © contributeurs OpenStreetMap (API Overpass) · données Wikidata (CC0) · textes Wikipédia (CC BY-SA) · lecture du cartel : Tesseract.js.
