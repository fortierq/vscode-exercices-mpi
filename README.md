# Exercices Typst

Installer le VSIX de `releases/`, puis ouvrir une banque `exercices-mpi` dans un espace de travail approuvé. Prérequis : VS Code ≥ 1.100, **Tinymist** (testé avec 0.15.8) ; Nix ou Make/Typst/Python pour les exports et le catalogue.

- **Fichier actuel** : lien vers les métadonnées, questions cliquables et parties repliées par défaut.
- **Exercices** : recherche, filtres et cases à cocher pour composer une feuille.
- **Feuilles** : sélection réordonnable et feuilles existantes. La création utilise directement l'ordre affiché sous « Nouvelle feuille ».
- **Concours** : sujets existants.

Exercices, Feuilles et Concours proposent une arborescence repliable et un bouton **dossiers / liste**. La recherche conserve la sélection, même lorsque des exercices sont masqués. **Ajouter un exercice** utilise les modèles et vocabulaires de la banque, avec vérification des doublons.

## Aperçu et PDF

Les deux icônes de document ouvrent l'énoncé ou le corrigé (vert). L'aperçu paginé de Tinymist se met à jour à la frappe, sans PDF intermédiaire ni `make c`. La bascule conserve les variantes déjà ouvertes en mémoire. Les processus s'arrêtent à la fermeture de l'aperçu.

Les sauts source ↔ aperçu utilisent les positions de Tinymist, pas une recherche de texte. Cliquer dans la source synchronise l'aperçu ; la commande **Rejoindre le curseur dans l'aperçu** permet aussi un saut explicite. Le lecteur conserve les gestes natifs de Tinymist pour revenir à la source.

L'icône de sauvegarde exporte le PDF courant ; **Exporter les PDF énoncé et corrigé** lance `make c`. Enregistrer les sources avant l'export. Le PDF final utilise la version Typst de la banque, qui peut différer de celle de Tinymist. Aucun réglage global Tinymist n'est modifié.

Le thème suit VS Code. Réglage `exercicesMpi.previewTheme` : `auto`, `light`, `dark`. Les anciens identifiants `exercicesMpi.*` sont conservés pour compatibilité. Les autres réglages utiles sont `bankPath`, `execution` (`auto`, `nix`, `direct`), `nixPath` et `makePath`.

## Développement

```sh
npm ci
npm test
npm run test:integration
npm run package
```

Les tests d'intégration utilisent un profil VS Code isolé, la banque voisine et des documents temporaires. Variables facultatives : `EXERCICES_MPI_BANK`, `VSCODE_EXECUTABLE`, `TINYMIST_PATH`. Aucun PDF de la banque n'est inspecté. Paquet local, sans publication ; licence à choisir avant distribution publique.
