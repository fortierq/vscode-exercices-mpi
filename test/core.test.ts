import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Exercise, executionCommand, matches, parseCatalogue, parseDiagnostics, pdfTarget, watchArguments } from '../src/core';
import { exerciseFromTemplate, sheetFromTemplate, outline, vocabulary } from '../src/typst';

const exercise: Exercise = {
  titre: 'Automates et monoïdes', fichier: 'exercices/langages/automates-monoides.typ',
  chapitres: ['automates-finis'], algorithmes: [], structures: [], langages: ['OCaml'],
  niveaux: ['MPI'], difficulte: 4, duree: [1, 30], concours: { nom: 'ENS', annee: 2022, filiere: 'MP' }
};
test('catalogue actuel : tableau et identifiant déduit du chemin', () => {
  assert.deepEqual(parseCatalogue(JSON.stringify([exercise])), [exercise]);
  assert.throws(() => parseCatalogue('{}'));
  assert.throws(() => parseCatalogue(JSON.stringify([exercise, { ...exercise, fichier: 'exercices/autre/automates-monoides.typ' }])));
});
test('validation des métadonnées avant leur utilisation', () => {
  for (const change of [{ titre: null }, { niveaux: null }, { difficulte: 6 }, { duree: [0, 60] }, { concours: { nom: 3 } }]) {
    assert.throws(() => parseCatalogue(JSON.stringify([{ ...exercise, ...change }])));
  }
});
test('recherche multi-mots, insensible à la casse et aux accents', () => {
  assert.equal(matches(exercise, 'MONOIDES ens 2022', {}), true);
  assert.equal(matches(exercise, 'monoides 2021', {}), false);
  assert.equal(matches(exercise, 'automates-monoides', {}), true);
});
test('tous les filtres se cumulent avec la recherche', () => {
  assert.equal(matches(exercise, 'automates', { chapitres: 'automates-finis', langages: 'OCaml', concours: 'ENS', niveaux: 'MPI', difficulteMax: 4 }), true);
  assert.equal(matches(exercise, '', { difficulteMax: 3 }), false);
  assert.equal(matches(exercise, '', { langages: 'Python' }), false);
  assert.equal(matches({ ...exercise, concours: null }, '', { concours: 'ENS' }), false);
});
test('chemins PDF conformes aux règles Make, feuilles imbriquées incluses', () => {
  assert.equal(pdfTarget(exercise.fichier, 'enonce'), 'build/exercices/langages/automates-monoides/enonce.pdf');
  assert.equal(pdfTarget('concours/22/oral/test.typ', 'corrige'), 'build/concours/22/oral/test/corrige.pdf');
  assert.equal(pdfTarget('feuilles/langages/td.typ', 'enonce'), 'build/feuilles/langages/td.pdf');
  assert.equal(pdfTarget('feuilles/langages/td.typ', 'corrige'), 'build/feuilles/langages/td-corrige.pdf');
});
test('rejet de chemins sortant de la banque et de la syntaxe Make', () => {
  for (const source of ['../test.typ', 'exercices/../test.typ', '/exercices/test.typ', 'exercices/$(shell x).typ', 'exercices/test;exit.typ', 'exercices/test\n.typ']) assert.throws(() => pdfTarget(source, 'enonce'));
});
test('Nix automatique pour flake ; exécution directe configurable', () => {
  assert.deepEqual(executionCommand('auto', true, '/path with spaces/nix', 'make', ['catalogue']), { command: '/path with spaces/nix', args: ['develop', 'path:.', '-c', 'make', 'catalogue'] });
  assert.deepEqual(executionCommand('direct', true, 'nix', 'gmake', ['catalogue']), { command: 'gmake', args: ['catalogue'] });
  assert.equal(executionCommand('auto', false, 'nix', 'make', []).command, 'make');
  assert.equal(executionCommand('nix', false, 'nix', 'make', []).command, 'nix');
});
test('diagnostics Typst : erreurs, avertissements, coordonnées à base zéro', () => {
  assert.deepEqual(parseDiagnostics('error: unknown variable: foo\n  ┌─ exercices/test.typ:8:4\nwarning: font missing\n  ┌─ lib/exercices.typ:2:1'), [
    { file: 'exercices/test.typ', line: 7, column: 3, message: 'unknown variable: foo', warning: false },
    { file: 'lib/exercices.typ', line: 1, column: 0, message: 'font missing', warning: true }
  ]);
});
test('watch : modèles et variantes cohérents avec les cibles make c', () => {
  const exerciseArgs = watchArguments(exercise.fichier, 'corrige');
  assert.ok(exerciseArgs.includes('corrige=true'));
  assert.ok(exerciseArgs.includes(`exercice=/${exercise.fichier}`));
  assert.equal(exerciseArgs.at(-1), pdfTarget(exercise.fichier, 'corrige'));
  const sheetArgs = watchArguments('feuilles/langages/td.typ', 'enonce');
  assert.equal(sheetArgs.at(-2), 'feuilles/langages/td.typ');
  assert.equal(sheetArgs.includes('templates/fiche.typ'), false);
});
test('plan, vocabulaire et création à partir des modèles Typst', () => {
  const source = '#let ex = exercice(\n  meta: (\n    titre: "Exemple",\n    chapitres: (),\n    algorithmes: (),\n    structures: (),\n    langages: (),\n    niveaux: (),\n    difficulte: 2,\n    duree: none,\n    concours: none,\n  ),\n  contenu: (\n    // question([Commentaire ignoré])\n    partie("I", "Test", contenu: (question([Une question ?]),)),\n  ),\n)';
  assert.equal(outline(source).filter(item => item.kind === 'question').length, 1);
  assert.equal(outline(source).find(item => item.kind === 'question')?.title, '1. Une question ?');
  assert.deepEqual(vocabulary('#let chapitres-programme = (\n// "ignoré"\n"graphes", "logique",\n)', 'chapitres-programme'), ['graphes', 'logique']);
  const created = exerciseFromTemplate(source, { title: 'Titre "cité"', chapters: ['graphes'], algorithms: [], structures: [], languages: ['C'], levels: ['MPI'], difficulty: 3, minutes: 90 });
  assert.ok(created.includes('titre: "Titre \\"cité\\"",'.replaceAll('\\\\', '\\')));
  assert.ok(created.includes('duree: (1, 30),'));
  assert.equal(outline(created).filter(item => item.kind === 'question').length, 1);
  assert.ok(!created.includes('Une question ?'));
  const sheet = sheetFromTemplate('#import "/templates/exercice.typ": ex\n#show: feuille.with(\n  titre: "TD",\n  exercices: (ex,),\n)\n', 'Feuille', [exercise.fichier, 'exercices/graphes/test.typ']);
  assert.ok(sheet.includes('ex as ex2'));
  assert.ok(sheet.includes('exercices: (ex1, ex2,),'));
});
