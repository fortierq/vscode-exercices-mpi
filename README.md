# Exercices MPI pour Visual Studio Code

Extension locale pour parcourir une banque Typst au format `exercices-mpi`, compiler ses documents et consulter les PDF dans VS Code.

## Installer et utiliser

1. Dans VS Code, lancer **Extensions: Install from VSIX…** depuis la palette de commandes et choisir `releases/vscode-exercices-mpi-0.2.0.vsix`.
2. Ouvrir le dossier de la banque `exercices-mpi` et autoriser cet espace de travail.
3. Cliquer sur l'icône **Exercices MPI** dans la barre latérale.
4. Utiliser la loupe pour chercher et l'entonnoir pour ajouter des filtres. Cliquer sur un exercice pour ouvrir sa source ; les deux boutons de sa ligne compilent et affichent l'énoncé ou le corrigé.

La recherche porte sur le titre, le nom de fichier et les métadonnées. Elle ignore les accents et la casse ; tous les mots saisis doivent apparaître. Les filtres par chapitre, algorithme, structure, langage, niveau, concours et difficulté maximale se cumulent. La recherche et les filtres sont conservés pour chaque espace de travail.

La barre PDF compacte propose une bascule **Énoncé ⇄ Corrigé**, le numéro de page, le zoom, l'état **watch** et des icônes pour recompiler, ouvrir la source et enregistrer une copie. Les pages se suivent verticalement : utiliser la molette ou les flèches du clavier (ainsi que Page précédente/suivante, Début et Fin). Le texte est sélectionnable. Les PDF sont affichés localement par PDF.js, inclus dans l'extension.

Un **double-clic sur le texte du PDF** recherche le passage correspondant dans la source et les exercices importés. S'il existe plusieurs correspondances, une liste permet de choisir. Cette navigation par texte n'est pas une correspondance exacte de positions : les formules, figures et contenus construits dynamiquement peuvent nécessiter le plan du fichier.

Chaque compilation manuelle exécute **`make c <source>`**, qui génère l'énoncé et le corrigé. L'aperçu lance ensuite un processus **`typst watch`** avec le même modèle et les mêmes paramètres. Les modifications enregistrées et celles des fichiers importés mettent à jour le PDF automatiquement. La surveillance s'arrête à la fermeture de l'aperçu et redémarre pour l'autre version lors d'une bascule. Enregistrer les fichiers modifiés avant une compilation manuelle.

Le bouton ↻ de la banque régénère les métadonnées du catalogue après modification ou ajout d'un exercice. Un catalogue absent est créé automatiquement ; un catalogue présent est chargé immédiatement.

Les boutons de l'éditeur et le menu contextuel des fichiers permettent aussi de compiler les feuilles et les sujets de concours. Ces deux catégories ne figurent pas encore dans le moteur de recherche, car le catalogue actuel de la banque n'exporte que les exercices.

Les erreurs apparaissent dans le journal **Exercices MPI** et, lorsqu'une position Typst est disponible, dans le panneau **Problèmes**.

## Écrire et composer

La vue **Fichier en cours** présente les métadonnées, parties, questions et imports du fichier Typst actif. Chaque entrée rejoint la ligne correspondante ; le plan suit les modifications non enregistrées. Il analyse les appels littéraux à `question` et `partie` ; des questions construites par une boucle ne sont pas développées.

Pour créer une feuille :

1. Cliquer sur **+** à côté des exercices souhaités (ou lancer **Ajouter à la sélection**).
2. Dans **Sélection pour une feuille**, réordonner avec les boutons monter/descendre et retirer les éléments inutiles.
3. Cliquer sur **Créer une feuille**, puis saisir son titre et son nom de fichier. La feuille est créée à partir du modèle de la banque, ouverte, compilée et surveillée.

La sélection respecte l'ordre affiché et doit appartenir à une même banque. Elle dure pendant la session VS Code.

La commande **Exercices MPI : Ajouter un exercice** demande le titre, les chapitres/sujets, les algorithmes, les structures, les langages, les niveaux, la difficulté, la durée et l'identifiant. Les valeurs du programme sont lues dans `lib/meta.typ`. Un titre identique ou un identifiant déjà présent est signalé. Le fichier est créé depuis `templates/exercice.typ`, avec une question à compléter et une solution manquante explicite. Le catalogue est ensuite actualisé. Aucun fichier existant n'est écrasé et aucun commit n'est lancé par ces commandes.

## Prérequis et paramètres

VS Code 1.100 ou ultérieur. La compilation utilise les outils de la banque : Nix, ou Make avec Typst et Python disponibles. Node.js n'est nécessaire que pour développer l'extension.

| Réglage | Valeur par défaut | Usage |
| --- | --- | --- |
| `exercicesMpi.execution` | `auto` | Nix si `flake.nix` existe ; sinon Make. `nix` et `direct` permettent de forcer le choix. |
| `exercicesMpi.nixPath` | `nix` | Exécutable Nix ; les emplacements standard macOS sont détectés même depuis le Dock. |
| `exercicesMpi.makePath` | `make` | Exécutable Make dans l'environnement choisi. |
| `exercicesMpi.typstPath` | `typst` | Exécutable Typst utilisé pour `watch`. |
| `exercicesMpi.bankPath` | vide | Banque à la racine du dossier ouvert, ou chemin explicite absolu/relatif. |
| `exercicesMpi.autoCompile` | `true` | Recompiler les aperçus ouverts à l'enregistrement. |

Plusieurs banques peuvent être ouvertes dans un espace de travail multi-dossiers. Les tâches sont sérialisées par banque ; annuler une tâche arrête son groupe de processus sur macOS/Linux. Les tests ciblent macOS avec Nix. La compilation directe sous Windows nécessite des outils compatibles avec le Makefile de la banque ; elle n'est pas validée ici.

## Interface avec la banque

La banque est détectée par `scripts/catalogue.py`, `templates/fiche.typ`, `lib/exercices.typ` et `Makefile`. L'extension ne modifie pas ces fichiers.

- `make catalogue` exporte `build/catalogue.json`, un tableau des métadonnées avec `fichier`. L'identifiant est le nom du fichier sans extension, unique dans la banque.
- Un exercice ou sujet produit `build/<chemin sans .typ>/enonce.pdf` et `corrige.pdf`.
- Une feuille produit `build/feuilles/<nom>.pdf` et `<nom>-corrige.pdf`, y compris dans les sous-dossiers.
- L'extension appelle `make c <source>`, puis `typst watch --root . --ignore-system-fonts` avec les paramètres du modèle ; le mode Nix ajoute `nix develop path:. -c`.

Le Makefile doit limiter la variable `CIBLE` aux invocations `c` et `w`. Une ancienne règle marquait aussi les PDF des sous-commandes comme `.PHONY`, empêchant leur génération par les règles implicites. Cette correction est incluse dans la banque développée avec cette extension.

Les sources sont des chemins relatifs sous `exercices/`, `feuilles/` ou `concours/`, avec lettres, chiffres, tirets et traits de soulignement. Les anciens catalogues portant un champ `id` supplémentaire restent lisibles ; ce champ n'est pas utilisé. La génération actuelle du catalogue n'étant pas versionnée, toute évolution incompatible devra être coordonnée avec l'extension.

## Développer

Avec Node.js 22.13 ou ultérieur et npm :

```sh
npm ci
npm test
npm run package
```

Avec Nix, on peut préfixer ces commandes par `nix shell nixpkgs#nodejs_22 -c`.

Ouvrir ce dépôt dans VS Code et appuyer sur F5. La configuration de lancement ouvre la banque voisine `../exercices-mpi` dans une fenêtre de développement.

Tests d'intégration contre une vraie banque, dans un profil VS Code isolé :

```sh
EXERCICES_MPI_BANK=/chemin/exercices-mpi npm run test:integration
```

Le lanceur télécharge un VS Code de test si `VSCODE_EXECUTABLE` n'est pas défini. Pour utiliser l'application macOS installée, définir cette variable à `/Applications/Visual Studio Code.app/Contents/MacOS/Code` (ou `Electron` pour certaines anciennes versions).

Les tests unitaires vérifient la recherche, les filtres, le format du catalogue, les chemins des PDF, les arguments Nix/Make et les diagnostics. Les tests d'intégration activent l'extension, régénèrent le catalogue et compilent les deux versions d'un exercice réel. Ils n'inspectent pas les PDF de la banque. Le lecteur PDF et son rechargement sont testés avec des pages vierges créées dans un dossier temporaire isolé.

Le dépôt et le paquet sont locaux ; aucune publication Marketplace ou GitHub n'est effectuée. La licence du code de l'extension reste à choisir avant une distribution publique.

Références : [API des extensions VS Code](https://code.visualstudio.com/api), [webviews](https://code.visualstudio.com/api/extension-guides/webview), [PDF.js](https://mozilla.github.io/pdf.js/).
