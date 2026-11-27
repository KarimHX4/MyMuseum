# MyMuseum

Carnet de visite de musée pour Android (et navigateur), **100 % gratuit**.
Vous photographiez une œuvre qui vous plaît : elle est identifiée, une **fiche** est créée à partir de **Wikidata** et **Wikipédia** (avec une analyse **Gemini** si vous ajoutez une clé gratuite), puis l'œuvre est **rangée dans le dossier de son musée**, avec un sous-dossier par **exposition temporaire**.

## Fonctionnement

- **Je visite** : le musée, la ville et l'exposition en cours. Avec la **détection automatique**, l'app compare votre position aux musées d'OpenStreetMap à l'ouverture et au retour après 20 minutes. Si vous êtes dans un musée ou à moins de 120 m, il est rempli tout seul ; sinon, les lieux proches s'affichent. La saisie à la main reste toujours possible.
- **Photographier** : la photo de l'œuvre est toujours gardée. Pour l'identifier :
  - **avec une clé Gemini** : la photo suffit, Gemini propose l'œuvre et l'app la relie automatiquement à Wikidata / Wikipédia ;
  - **sans clé** : cherchez l'œuvre par titre ou artiste (les œuvres du musée détecté apparaissent en premier), ou **photographiez le cartel** : il est lu sur le téléphone (Tesseract) puis recherché dans Wikidata.
  - Pas de réseau ? **Identifier plus tard** garde la photo et le lieu.
  - Le cartel peut être **photographié ou importé** depuis la galerie, seul ou en plus de la photo de l'œuvre.
  - Dès qu'une œuvre est identifiée, son **image de référence** s'affiche (« Est-ce bien cette œuvre ? ») pour vérifier d'un coup d'œil.
  - Une œuvre **déjà dans le carnet** (même œuvre Wikidata, même titre, ou photo presque identique) est signalée : ouvrir sa fiche, remplacer sa photo, ou continuer.
- **Fiche** : données Wikidata (artiste, date, technique, dimensions, mouvement, n° d'inventaire, ce qui est représenté), article Wikipédia par sections, présentation de l'artiste, image de référence ; avec Gemini en plus : contexte, analyse, détails à regarder, anecdotes, œuvres liées, et questions sur l'œuvre. Notes personnelles, coups de cœur, correction du lieu.
- **Musées** : deux vues bien distinctes. **Musées visités** (par défaut) range chaque œuvre dans le lieu où vous l'avez vue, avec une section par exposition temporaire et l'étiquette *Prêt* pour les œuvres venues d'ailleurs. **Musées d'origine** range les œuvres par musée qui les conserve. Les musées s'affichent en **liste** (ou en vignettes). Dans un musée, deux vues : **Mur** (accrochage à l'échelle réelle, avec un chat de 32 cm) et **Liste**. Chaque musée a sa **couleur de mur**. Les musées en double (« MoMA » et « Museum of Modern Art ») sont détectés et peuvent être fusionnés.
- **Cadres** : doré, baroque, baguette noire, bois clair, cadre fin ou sans cadre. Par défaut, le cadre est choisi **selon l'époque et la technique** ; on peut changer le style par défaut (Réglages) ou le cadre de chaque œuvre (fiche).
- **Photo** : dans chaque fiche, un bouton bascule entre **votre photo** et **l'image de référence** (Wikimedia Commons) dans le cadre ; Réglages permet de préférer l'image de référence partout. Le bouton **Cadre** ouvre le choix du cadre. Plein écran avec zoom (pincer, double-toucher), comparaison avec l'image de référence, **recadrage en perspective** (on place les 4 coins, la photo est redressée ; le bouton **Automatique** repère seul les bords de l'œuvre).
- **Recadrage automatique** : juste après la photo ou l'import, et avant l'analyse, l'app détecte les bords du tableau (en écartant le cadre quand elle le distingue), redresse la perspective et vous propose le résultat : on ajuste les coins, on valide, ou on garde la photo entière. Tout se fait sur le téléphone, sans service en ligne. Désactivable dans Réglages.
- **Explorer** : **carte** des musées visités et/ou des musées d'origine (OpenStreetMap), **frise chronologique** par siècle et **statistiques** (artistes, mouvements, siècles, musées visités et musées d'origine).

## Clé Gemini gratuite (facultative)

1. Ouvrez <https://aistudio.google.com/app/apikey> et connectez-vous avec un compte Google.
2. Acceptez les conditions, puis **Create API key** (Google crée au besoin un projet par défaut).
3. Copiez la clé. Depuis mi-2026, les nouvelles clés commencent par `AQ.` (les anciennes par `AIza…`) : les deux fonctionnent.
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
