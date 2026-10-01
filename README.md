# Exercices Typst

Installer le VSIX de `releases/`, puis ouvrir une banque `exercices-mpi` approuvée. Prérequis : VS Code ≥ 1.100 et Nix ou Make/Typst/Python. Tinymist est facultatif (testé avec 0.15.8).

- **Fichier actuel** : métadonnées, questions et exercices cliquables ; parties repliées.
- **Exercices**, **Feuilles**, **Concours** : recherche, filtres, dossiers repliables ou liste.
- **Créer une nouvelle feuille** crée une feuille vide. Sélectionner la feuille dans **Feuilles**, puis utiliser **+** sur les exercices, ou les glisser sur la feuille.
- Réordonner les exercices par glisser-déposer ou avec les flèches ; **×** retire aussi l'import. Ces modifications sont enregistrées automatiquement et restent annulables. Un import utilisé ailleurs n'est pas supprimé silencieusement.
- Déplacer les fichiers en les glissant sur un dossier ou dans le fond de leur section. Les références Typst littérales sont actualisées ; vérifier les chemins calculés et les références externes.
- Bouton **Nouveau dossier** ; clic droit pour créer un exercice depuis le modèle ou supprimer un fichier dans la corbeille. Un fichier encore référencé ne peut pas être supprimé.

## Aperçu

Énoncé et Corrigé ont deux boutons distincts. **↔** active les sauts source–aperçu et leur surlignage ; **lune** inverse le thème, qui suit VS Code par défaut.

Avec Tinymist : rendu vectoriel actualisé à la frappe, positions source précises et variantes gardées en mémoire. Sans Tinymist : lecteur PDF actualisé à l'enregistrement, sans sauts ; les outils de compilation de la banque restent nécessaires.

La sauvegarde exporte le PDF courant ; **Exporter les PDF énoncé et corrigé** lance `make c`. Enregistrer les sources avant l'export. Réglages : `exercicesMpi.previewTheme`, `bankPath`, `execution`, `nixPath`, `makePath`.

## Développement

`npm ci` · `npm test` · `npm run test:integration` · `npm run package`

Tests dans un profil VS Code isolé et sur des documents temporaires ; aucun PDF de la banque inspecté. Variables : `EXERCICES_MPI_BANK`, `VSCODE_EXECUTABLE`, `TINYMIST_PATH`. Distribution locale, licence publique à choisir.
