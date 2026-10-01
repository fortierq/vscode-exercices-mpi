# Composants tiers

L'extension embarque `vscode-jsonrpc` (Microsoft Corporation), sous licence MIT. Le texte complet est inclus dans `dist/LICENSE-vscode-jsonrpc.txt`.

Le moteur et le lecteur de [Tinymist](https://github.com/Myriad-Dreamin/tinymist) sont réutilisés depuis l'extension installée, sans copie dans le VSIX.

PDF.js (`pdfjs-dist`, Mozilla, Apache-2.0) assure le lecteur de secours sans Tinymist. Sa licence et celles de ses polices sont incluses dans `dist/pdfjs/`.

Le code de l'extension est pour le moment non licencié pour une distribution publique (`UNLICENSED`). Les outils de construction et de test sont des dépendances de développement et ne sont pas embarqués dans le VSIX.
