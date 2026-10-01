import * as vscode from 'vscode';
import * as path from 'node:path';
import { realpath } from 'node:fs/promises';
import { Bank } from './runner';
import { Exercise, safeSource } from './core';
import { editSheet, sheetList, sourceMetadata } from './sheet-model';

export interface SheetMember {
  bank: Bank; source: string; title: string; ex?: Exercise;
  sheet: string; index: number; snapshot: string;
}
export class Sheets implements vscode.Disposable {
  readonly changed = new vscode.EventEmitter<void>();
  current?: { bank: Bank; source: string };
  private subscriptions: vscode.Disposable[];
  constructor(private banks: () => Bank[], private exercises: () => { bank: Bank; ex: Exercise }[]) {
    const track = (document?: vscode.TextDocument) => {
      if (!document || document.uri.scheme !== 'file') return;
      const bank = this.banks().find(bank => document.uri.fsPath.startsWith(path.join(bank.root, 'feuilles') + path.sep));
      if (bank) this.current = { bank, source: path.relative(bank.root, document.uri.fsPath).split(path.sep).join('/') };
    };
    this.subscriptions = [vscode.window.onDidChangeActiveTextEditor(editor => track(editor?.document)),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.path.includes('/feuilles/')) this.changed.fire(); })];
  }
  remember(): void {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const bank = uri && this.banks().find(bank => uri.fsPath.startsWith(path.join(bank.root, 'feuilles') + path.sep));
    if (bank) this.current = { bank, source: path.relative(bank.root, uri!.fsPath).split(path.sep).join('/') };
  }
  async members(bank: Bank, source: string): Promise<SheetMember[]> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(bank.root, source)));
    const snapshot = doc.getText();
    const list = sheetList(snapshot, source);
    return Promise.all(list.entries.map(async (entry, index) => {
      safeSource(entry.source);
      const ex = this.exercises().find(item => item.bank.root === bank.root && item.ex.fichier === entry.source)?.ex;
      let title = ex?.titre;
      if (!title) { try { title = sourceMetadata((await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(bank.root, entry.source)))).getText(), entry.source).titre; } catch { title = path.basename(entry.source, '.typ'); } }
      return { bank, source: entry.source, title, sheet: source, index, snapshot };
    }));
  }
  async change(member: SheetMember, direction?: number): Promise<void> {
    await this.modify(member.bank, member.sheet, { index: member.index, direction }, member.snapshot);
  }
  async add(bank: Bank, source: string, sheet: string): Promise<void> { await this.modify(bank, sheet, { add: source }); }
  private async modify(bank: Bank, sheet: string, operation: Parameters<typeof editSheet>[2], snapshot?: string): Promise<void> {
    safeSource(sheet);
    if (!(await realpath(path.join(bank.root, sheet))).startsWith(bank.root + path.sep)) throw new Error('La feuille doit rester dans la banque.');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(bank.root, sheet)));
    const text = doc.getText();
    if (snapshot !== undefined && snapshot !== text) throw new Error('La feuille a changé ; recommencez depuis la vue actualisée.');
    const result = editSheet(text, sheet, operation);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), result);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('Modification de la feuille impossible.');
    this.current = { bank, source: sheet };
    this.changed.fire();
  }
  dispose(): void { this.changed.dispose(); for (const sub of this.subscriptions) sub.dispose(); }
}

export function memberItem(member: SheetMember): vscode.TreeItem {
  const item = new vscode.TreeItem(member.title);
  item.id = `${member.bank.root}/${member.sheet}:${member.index}`;
  item.contextValue = 'sheetMember';
  item.tooltip = member.source;
  item.command = { command: 'exercicesMpi.source', title: 'Ouvrir l’exercice', arguments: [member] };
  return item;
}
