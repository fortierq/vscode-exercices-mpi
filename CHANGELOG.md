# Journal des versions

## 0.4.0

- Barre d'aperçu : Énoncé/Corrigé distincts, interrupteurs des sauts et du thème, icônes uniformisées.
- Composition des feuilles existantes : titres cliquables, monter/descendre, retirer, ajouter à la dernière feuille ouverte.
- Recherche et filtres dans les trois bibliothèques ; concours affiché en premier après le titre des exercices.
- Création de dossiers, déplacement avec mise à jour des références Typst littérales, suppression dans la corbeille avec contrôle des dépendances.

## 0.3.0 — Exercices Typst

- Quatre sections : Fichier actuel, Exercices, Feuilles, Concours ; arborescences repliables ou listes.
- Métadonnées accessibles par un lien ; parties du plan repliées par défaut.
- Cases à cocher dans la recherche ; création des feuilles dans l'ordre de la sélection affichée sous Feuilles.
- Aperçu Tinymist à la frappe, navigation précise dans les deux sens, thème sombre et variantes conservées en mémoire.
- `make c` réservé à l'export ; suppression du lecteur PDF.js et du watch supplémentaire.
- Icônes identiques pour les deux aperçus, corrigé en vert.

## 0.2.0

- Barre PDF compacte, bascule énoncé/corrigé, défilement continu et navigation clavier.
- Texte sélectionnable et double-clic pour retrouver la source.
- Compilation des deux versions avec `make c`, puis surveillance réelle par `typst watch`.
- Plan du fichier courant : métadonnées, parties et questions cliquables.
- Sélection ordonnée d'exercices et création de feuilles depuis le modèle de la banque.
- Assistant de création d'exercices avec les métadonnées du programme et contrôle des doublons.

## 0.1.0

- Recherche d'exercices et filtres cumulables dans la barre latérale.
- Compilation par Make, avec détection de Nix.
- Aperçus PDF intégrés pour les énoncés, corrigés, feuilles et sujets.
- Recompilation à l'enregistrement et diagnostics Typst.
