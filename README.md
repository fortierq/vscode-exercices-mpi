# Exercices Typst

Installer le VSIX de `releases/`, puis ouvrir une banque `exercices-mpi` dans un espace de travail approuvé. Prérequis : VS Code ≥ 1.100, **Tinymist** (testé avec 0.15.8) ; Nix ou Make/Typst/Python pour les exports et le catalogue.

- **Fichier actuel** : métadonnées, questions et exercices de la feuille cliquables ; parties repliées.
- **Exercices** : recherche, filtres et cases à cocher pour composer une feuille.
- **Feuilles** : feuilles existantes avec leurs exercices (monter, descendre, retirer). La création suit l'ordre de « Nouvelle feuille ».
- **Concours** : sujets existants, recherche et filtres.

Les trois bibliothèques proposent recherche, filtres et **dossiers / liste**. Les feuilles sont recherchées aussi par les métadonnées de leurs exercices. Le bouton **+** d'un exercice l'ajoute à la dernière feuille ouverte ; les cases à cocher préparent une nouvelle feuille. Les modifications de composition restent à enregistrer et sont annulables ; les compositions calculées se modifient dans la source.

Bouton **Nouveau dossier** et clic droit : créer un exercice depuis le modèle, déplacer ou supprimer un fichier. Les déplacements actualisent les références Typst littérales ; vérifier les chemins calculés et les références externes. La suppression utilise la corbeille et refuse les fichiers encore référencés par une autre source Typst.

## Aperçu et PDF

Les deux icônes de document ouvrent l'énoncé ou le corrigé (vert). L'aperçu paginé de Tinymist se met à jour à la frappe, sans PDF intermédiaire ni `make c`. La bascule conserve les variantes déjà ouvertes en mémoire. Les processus s'arrêtent à la fermeture de l'aperçu.

Les sauts source ↔ aperçu utilisent les positions de Tinymist, pas une recherche de texte ni un fichier SyncTeX. Le bouton **↔** active/désactive les deux sens ; le suivi du curseur respecte `tinymist.preview.scrollSync`. L'aperçu conserve les gestes natifs de Tinymist pour revenir à la source. L'intégration utilise son moteur installé (nécessaire), avec un processus isolé par variante ouverte pour séparer les paramètres énoncé/corrigé.

L'icône de sauvegarde exporte le PDF courant ; **Exporter les PDF énoncé et corrigé** lance `make c`. Enregistrer les sources avant l'export. Le PDF final utilise la version Typst de la banque, qui peut différer de celle de Tinymist. Aucun réglage global Tinymist n'est modifié.

Le bouton **lune** inverse le thème pour cet aperçu (redémarrage du rendu). Par défaut : réglage `exercicesMpi.previewTheme` (`auto`, `light`, `dark`), avec suivi de VS Code en `auto`. Autres réglages : `bankPath`, `execution` (`auto`, `nix`, `direct`), `nixPath`, `makePath`.

## Développement

```sh
npm ci
npm test
npm run test:integration
npm run package
```

Les tests d'intégration utilisent un profil VS Code isolé, la banque voisine et des documents temporaires. Variables facultatives : `EXERCICES_MPI_BANK`, `VSCODE_EXECUTABLE`, `TINYMIST_PATH`. Aucun PDF de la banque n'est inspecté. Paquet local, sans publication ; licence à choisir avant distribution publique.
