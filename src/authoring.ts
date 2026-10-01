import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { Bank } from './runner';
import { Exercise, normalize, safeSource } from './core';
import { exerciseFromTemplate, sheetFromTemplate, contestFromTemplate, creationPath, slug, vocabulary } from './typst';

export interface BankEntry { bank: Bank; ex: Exercise }
const canceled = () => { throw new vscode.CancellationError(); };

async function input(title: string, value = '', validate?: (value: string) => string | undefined): Promise<string> {
  return (await vscode.window.showInputBox({ title, value, validateInput: value => validate?.(value) ?? (value.trim() ? undefined : 'Champ obligatoire.') })) ?? canceled();
}
async function select(title: string, values: string[], required = false): Promise<string[]> {
  const chosen = await vscode.window.showQuickPick(values.map(label => ({ label })), { title, canPickMany: true, placeHolder: required ? 'Sélectionnez au moins une valeur' : 'Facultatif : validez sans sélection si aucun' });
  if (!chosen) canceled();
  if (required && !chosen!.length) throw new Error('Sélectionnez au moins une valeur.');
  return chosen!.map(item => item.label);
}

export async function selectBank(banks: Bank[]): Promise<Bank> {
  if (!banks.length) throw new Error("Ouvrez d'abord une banque exercices-mpi.");
  if (banks.length === 1) return banks[0];
  const chosen = await vscode.window.showQuickPick(banks.map(bank => ({ label: bank.name, description: bank.root, bank })), { title: 'Choisir une banque' });
  return chosen?.bank ?? canceled();
}

async function create(bank: Bank, relative: string, content: string): Promise<vscode.Uri> {
  safeSource(relative);
  const uri = vscode.Uri.file(path.join(bank.root, relative));
  const directory = vscode.Uri.file(path.dirname(uri.fsPath));
  let ancestor = directory.fsPath;
  while (ancestor !== bank.root) {
    try {
      const actual = await realpath(ancestor);
      if (!actual.startsWith(bank.root + path.sep)) throw new Error('Le dossier de destination doit rester dans la banque.');
      break;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
  }
  await vscode.workspace.fs.createDirectory(directory);
  const actual = await realpath(directory.fsPath);
  if (!actual.startsWith(bank.root + path.sep)) throw new Error('Le dossier de destination doit rester dans la banque.');
  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
  edit.insert(uri, new vscode.Position(0, 0), content);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('Création impossible : le fichier existe peut-être déjà.');
  const document = await vscode.workspace.openTextDocument(uri);
  await document.save();
  await vscode.window.showTextDocument(document);
  return uri;
}

export async function newExercise(bank: Bank, entries: BankEntry[], targetDirectory?: string): Promise<vscode.Uri> {
  const title = await input("Nouvel exercice — titre");
  const duplicate = entries.find(entry => entry.bank.root === bank.root && normalize(entry.ex.titre).trim() === normalize(title).trim());
  if (duplicate) { await vscode.window.showTextDocument(vscode.Uri.file(path.join(bank.root, duplicate.ex.fichier))); throw new Error('Un exercice porte déjà ce titre ; sa source a été ouverte pour comparaison.'); }
  const meta = await readFile(path.join(bank.root, 'lib/meta.typ'), 'utf8');
  const chapters = await select('Chapitres / sujets', vocabulary(meta, 'chapitres-programme'), true);
  const algorithms = await select('Algorithmes', vocabulary(meta, 'algorithmes-programme'));
  const structures = await select('Structures de données', vocabulary(meta, 'structures-programme'));
  const languages = await select('Langages utilisés', ['C', 'OCaml', 'Python']);
  const levels = await select('Niveaux', ['MP2I', 'MPI', 'MP'], true);
  const difficultyChoice = await vscode.window.showQuickPick(['1', '2', '3', '4', '5'], { title: 'Difficulté (1 : application directe ; 5 : très difficile)' });
  if (!difficultyChoice) canceled();
  const minutesText = await input('Durée estimée en minutes (0 : non estimée)', '20', value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? undefined : 'Entrez un nombre entier positif ou nul.');
  const directories = [...new Set(entries.filter(entry => entry.bank.root === bank.root).map(entry => entry.ex.fichier.split('/')[1]))];
  const preferred = entries.find(entry => entry.bank.root === bank.root && entry.ex.chapitres.includes(chapters[0]))?.ex.fichier.split('/')[1] ?? chapters[0];
  const directory = targetDirectory?.replace(/^exercices\/?/, '') ?? await vscode.window.showQuickPick([...new Set([preferred, ...directories])], { title: 'Dossier de classement' });
  if (directory === undefined) canceled();
  const identifier = await input('Identifiant unique (nom du fichier)', slug(title), value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? undefined : 'Utilisez des lettres minuscules, chiffres et tirets.');
  const existing = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(bank.root), 'exercices/**/*.typ'));
  if (existing.some(uri => path.basename(uri.fsPath, '.typ') === identifier)) throw new Error(`L'identifiant ${identifier} existe déjà dans la banque.`);
  const template = await readFile(path.join(bank.root, 'templates/exercice.typ'), 'utf8');
  return create(bank, `exercices/${directory ? directory + '/' : ''}${identifier}.typ`, exerciseFromTemplate(template, { title, chapters, algorithms, structures, languages, levels, difficulty: Number(difficultyChoice), minutes: Number(minutesText) || null }));
}

export async function newSheet(bank: Bank, directory = 'feuilles'): Promise<vscode.Uri> {
  const title = await input('Titre de la feuille', 'Travaux dirigés');
  const identifier = await input('Nom du fichier de la feuille', slug(title), value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? undefined : 'Utilisez des lettres minuscules, chiffres et tirets.');
  const template = await readFile(path.join(bank.root, 'templates/feuille.typ'), 'utf8');
  return create(bank, creationPath('feuilles', directory, identifier), sheetFromTemplate(template, title, []));
}

export async function newContest(bank: Bank, directory = 'concours'): Promise<vscode.Uri> {
  if (directory === 'concours') {
    const year = await input('Année du sujet (quatre chiffres)', '', value => /^\d{4}$/.test(value) && +value > 0 ? undefined : 'Entrez une année sur quatre chiffres.');
    directory += '/' + year.slice(-2);
  }
  const title = await input('Titre du sujet de concours');
  const identifier = await input('Nom du fichier du sujet', slug(title), value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? undefined : 'Utilisez des lettres minuscules, chiffres et tirets.');
  const template = await readFile(path.join(bank.root, 'templates/sujet-concours.typ'), 'utf8');
  return create(bank, creationPath('concours', directory, identifier), contestFromTemplate(template, title));
}
