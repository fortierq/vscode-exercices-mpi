# Journal des versions

## 0.5.11

- F5 pour l'énoncé, F6 pour le corrigé ; Maj exporte la variante correspondante.
- Décorations Git natives sur les fichiers, dossiers et exercices des feuilles.

## 0.5.10

- F2–F6 : recherche, filtres, création et aperçus ; Maj pour les feuilles ou l'export PDF direct.

## 0.5.9

- Raccourcis F2–F5 et Maj+F2–F5 dans les éditeurs Typst et les listes de l'extension ; F1 et les autres contextes préservés.

## 0.5.8

- Retour au style de la barre PDF de 0.5.4 ; icône PDF et noms de fichiers conservés.

## 0.5.7

- Barre PDF de 30 px ; onglets Énoncé/Corrigé avec indicateur actif et focus comme le panneau Terminal.

## 0.5.6

- Barre PDF compacte (26 px), libellés Énoncé et Corrigé sans majuscules forcées.

## 0.5.5

- Icône PDF et noms cohérents pour l'aperçu et l'export : nom.pdf / nom-cor.pdf.
- Barre d'outils suivant les couleurs, onglets et dimensions du panneau Terminal.

## 0.5.4

- Nouveaux exercices sans commentaires du modèle ; chaînes et extraits de code conservés.

## 0.5.3

- Création d'exercices : langages lus depuis lib/meta.typ, SQL disponible aussi avec les anciennes banques.

## 0.5.2

- Création dans un dossier corrigée : sélection de la feuille avec ses parents, même après une recherche.
- Annulation contextuelle des recherches par × ou Échap, commandes secondaires dans …, boutons de création regroupés.
- Exercices des feuilles numérotés, palette simplifiée et raccourcis avec un préfixe commun.

## 0.5.1

- Création de feuilles et de sujets de concours dans le dossier choisi par clic droit ; bouton de création dans Concours.

## 0.5.0

- Glisser-déposer des fichiers et de la composition des feuilles ; suppression de l'ancienne sélection à cases.
- Création de feuilles vides, destination choisie dans Feuilles, enregistrement automatique et suppression des imports retirés.
- Lecture des anciennes feuilles sans virgule finale ; retrait des commandes et messages de source superflus.
- Tinymist facultatif : lecteur PDF de secours. Désactivation des sauts et des surlignages dans le lecteur Tinymist.

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
