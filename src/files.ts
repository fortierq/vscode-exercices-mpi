import * as vscode from 'vscode';
import * as path from 'node:path';
import { realpath } from 'node:fs/promises';
import { Bank } from './runner';
import { safeSource } from './core';
import { mask } from './typst';

export interface Location { bank: Bank; source: string }
export async function directories(bank: Bank, category: string): Promise<Location[]> {
  const result: Location[] = [];
  const visit = async (source: string) => {
    result.push({ bank, source });
    for (const [name, type] of await vscode.workspace.fs.readDirectory(vscode.Uri.file(path.join(bank.root, source)))) {
      if (type === vscode.FileType.Directory) await visit(source + '/' + name);
    }
  };
  try { await visit(category); } catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) throw error; }
  return result;
}
export async function checkDirectory(location: Location): Promise<void> {
  safeSource(location.source + '/placeholder.typ');
  const actual = await realpath(path.join(location.bank.root, location.source));
  if (!actual.startsWith(location.bank.root + path.sep)) throw new Error('Le dossier doit rester dans la banque (pas de lien symbolique externe).');
}
export async function newFolder(location: Location): Promise<void> {
  await checkDirectory(location);
  const name = await vscode.window.showInputBox({ title: `Nouveau dossier dans ${location.source}`, validateInput: value => /^[\p{L}\p{N}_-]+$/u.test(value) ? undefined : 'Lettres, chiffres, tirets et traits de soulignement uniquement.' });
  if (!name) return;
  const uri = vscode.Uri.file(path.join(location.bank.root, location.source, name));
  try { await vscode.workspace.fs.stat(uri); throw new Error('Ce dossier existe déjà.'); } catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) throw error; }
  await vscode.workspace.fs.createDirectory(uri);
}

export interface Reference { start: number; end: number; value: string; target: string }
export function references(text: string, owner: string): Reference[] {
  const code = mask(text);
  return [...mask(text, false).matchAll(/\b(?:import|include|read|image|csv|json|yaml|toml|xml|bibliography)\s*\(?\s*"([^"\n]+)"/g)].filter(match => code[match.index!] === text[match.index!]).map(match => ({
    start: match.index! + match[0].indexOf('"') + 1, end: match.index! + match[0].length - 1, value: match[1],
    target: match[1].startsWith('/') ? match[1].slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(owner), match[1]))
  }));
}
export function relocated(text: string, owner: string, from: string, to: string): string {
  let result = text;
  for (const ref of references(text, owner).reverse()) {
    if (ref.value.startsWith('@')) continue;
    const target = ref.target === from ? to : ref.target;
    const newOwner = owner === from ? to : owner;
    if (target === ref.target && newOwner === owner) continue;
    const value = ref.value.startsWith('/') ? '/' + target : path.posix.relative(path.posix.dirname(newOwner), target);
    result = result.slice(0, ref.start) + value + result.slice(ref.end);
  }
  return result;
}
async function documents(bank: Bank): Promise<vscode.TextDocument[]> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(bank.root), '**/*.typ'), '**/build/**');
  const result: vscode.TextDocument[] = [];
  for (const uri of files) {
    if (!(await realpath(uri.fsPath)).startsWith(bank.root + path.sep)) throw new Error(`Source liée hors de la banque : ${uri.fsPath}`);
    result.push(await vscode.workspace.openTextDocument(uri));
  }
  return result;
}
export async function moveSource(location: Location, destination: string): Promise<void> {
  safeSource(location.source); safeSource(destination);
  if (location.source.split('/')[0] !== destination.split('/')[0]) throw new Error('Déplacez le fichier dans un dossier de la même section.');
  if (location.source === destination) return;
  await checkDirectory({ ...location, source: path.posix.dirname(destination) });
  const from = vscode.Uri.file(path.join(location.bank.root, location.source));
  const to = vscode.Uri.file(path.join(location.bank.root, destination));
  const actual = await realpath(from.fsPath);
  if (!actual.startsWith(location.bank.root + path.sep)) throw new Error('Source externe à la banque.');
  try { await vscode.workspace.fs.stat(to); throw new Error('Un fichier existe déjà à cette destination.'); } catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) throw error; }
  const edit = new vscode.WorkspaceEdit();
  for (const doc of await documents(location.bank)) {
    const source = path.relative(location.bank.root, doc.uri.fsPath).split(path.sep).join('/');
    const text = doc.getText();
    const result = relocated(text, source, location.source, destination);
    if (result !== text) edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), result);
  }
  edit.renameFile(from, to, { overwrite: false });
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('Déplacement impossible.');
  await vscode.window.showTextDocument(to);
  void vscode.window.showInformationMessage('Fichier déplacé ; références Typst littérales mises à jour. Enregistrez les modifications avant l’export. Vérifiez les chemins calculés et les références hors Typst.');
}
export async function deleteSource(location: Location): Promise<boolean> {
  safeSource(location.source);
  const uri = vscode.Uri.file(path.join(location.bank.root, location.source));
  if (!(await realpath(uri.fsPath)).startsWith(location.bank.root + path.sep)) throw new Error('Source externe à la banque.');
  const docs = await documents(location.bank);
  const dependencies = docs.filter(doc => doc.uri.fsPath !== uri.fsPath && references(doc.getText(), path.relative(location.bank.root, doc.uri.fsPath).split(path.sep).join('/')).some(ref => ref.target === location.source));
  if (dependencies.length) throw new Error(`Fichier encore utilisé par : ${dependencies.map(doc => path.relative(location.bank.root, doc.uri.fsPath)).join(', ')}. Retirez ces références avant de le supprimer.`);
  if (docs.some(doc => doc.uri.fsPath === uri.fsPath && doc.isDirty)) throw new Error('Enregistrez ou annulez les modifications de ce fichier avant de le supprimer.');
  if (await vscode.window.showWarningMessage(`Placer ${location.source} dans la corbeille ? Vérifiez aussi les éventuelles références calculées.`, { modal: true }, 'Supprimer') !== 'Supprimer') return false;
  await vscode.workspace.fs.delete(uri, { useTrash: true });
  void vscode.window.showInformationMessage('Fichier placé dans la corbeille ; il peut être restauré.');
  return true;
}
