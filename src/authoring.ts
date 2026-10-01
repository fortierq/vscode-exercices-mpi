import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { Bank } from './runner';
import { Exercise, normalize, safeSource } from './core';
import { exerciseFromTemplate, sheetFromTemplate, slug, vocabulary } from './typst';

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

export class Selection implements vscode.TreeDataProvider<BankEntry>, vscode.Disposable {
  readonly entries: BankEntry[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  has(entry: BankEntry): boolean { return this.entries.some(item => item.bank.root === entry.bank.root && item.ex.fichier === entry.ex.fichier); }
  add(entries: BankEntry[]): void {
    const bank = this.entries[0]?.bank.root ?? entries[0]?.bank.root;
    if (entries.some(entry => entry.bank.root !== bank)) throw new Error('Une feuille doit réunir des exercices de la même banque.');
    for (const entry of entries) {
      if (!this.has(entry)) this.entries.push(entry);
    }
    this.changed.fire();
  }
  remove(entry: BankEntry): void { const index = this.entries.findIndex(item => item.bank.root === entry.bank.root && item.ex.fichier === entry.ex.fichier); if (index >= 0) this.entries.splice(index, 1); this.changed.fire(); }
  move(entry: BankEntry, direction: number): void {
    const index = this.entries.indexOf(entry); const target = index + direction;
    if (index >= 0 && target >= 0 && target < this.entries.length) [this.entries[index], this.entries[target]] = [this.entries[target], this.entries[index]];
    this.changed.fire();
  }
  clear(): void { this.entries.length = 0; this.changed.fire(); }
  getChildren(): BankEntry[] { return this.entries; }
  getTreeItem(entry: BankEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(`${this.entries.indexOf(entry) + 1}. ${entry.ex.titre}`);
    item.contextValue = 'selectedExercise'; item.iconPath = new vscode.ThemeIcon('book');
    item.command = { command: 'exercicesMpi.source', title: 'Ouvrir', arguments: [entry] };
    return item;
  }
  dispose(): void { this.changed.dispose(); }
}

export async function newSheet(selection: Selection): Promise<vscode.Uri | undefined> {
  if (!selection.entries.length) {
    await vscode.window.showInformationMessage('Cochez des exercices dans Exercices, puis réordonnez-les dans Feuilles.');
    await vscode.commands.executeCommand('exercicesMpi.library.focus');
    return;
  }
  const title = await input('Titre de la feuille', 'Travaux dirigés');
  const identifier = await input('Nom du fichier de la feuille', slug(title), value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? undefined : 'Utilisez des lettres minuscules, chiffres et tirets.');
  const bank = selection.entries[0].bank;
  const template = await readFile(path.join(bank.root, 'templates/feuille.typ'), 'utf8');
  return create(bank, `feuilles/${identifier}.typ`, sheetFromTemplate(template, title, selection.entries.map(entry => entry.ex.fichier)));
}
