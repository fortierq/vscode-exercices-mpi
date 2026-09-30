import * as vscode from 'vscode';
import * as path from 'node:path';
import { Bank } from './runner';
import { BankEntry, Selection } from './authoring';
import { Exercise, Filters, duration, matches, normalize } from './core';
import { Folder, hierarchy, isFolder } from './tree';

export interface Source { bank: Bank; source: string; ex?: Exercise }
type Leaf = Source | BankEntry;
export type BrowserNode = Leaf | Folder<Leaf>;
export class Browser implements vscode.TreeDataProvider<BrowserNode>, vscode.Disposable {
  readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  entries: Source[] = [];
  query = '';
  filters: Filters = {};
  flat: boolean;
  constructor(readonly category: 'exercices' | 'feuilles' | 'concours', private selection: Selection, private state: vscode.Memento) {
    this.flat = state.get(`flat.${category}`, false);
  }
  get visible(): Source[] {
    return this.entries.filter(item => item.ex ? matches(item.ex, this.query, this.filters) : !Object.values(this.filters).some(Boolean) && normalize(item.source).includes(normalize(this.query)));
  }
  getChildren(node?: BrowserNode): BrowserNode[] {
    if (node) return isFolder(node) ? node.children : [];
    const banks = new Set(this.entries.map(item => item.bank.root));
    const entries = [...this.visible].sort((a, b) => (a.ex?.titre ?? a.source).localeCompare(b.ex?.titre ?? b.source, 'fr', { numeric: true }));
    const files = this.flat ? entries : hierarchy<Leaf>(entries, item => `${banks.size > 1 ? item.bank.name + '/' : ''}${('source' in item ? item.source : item.ex.fichier).replace(/^[^/]+\//, '')}`);
    return this.category === 'feuilles' ? [{ folder: ':selection', title: `Nouvelle feuille (${this.selection.entries.length})`, children: this.selection.entries }, ...files] : files;
  }
  getTreeItem(node: BrowserNode): vscode.TreeItem {
    if (isFolder(node)) {
      const selected = node.folder === ':selection';
      const item = new vscode.TreeItem(node.title, selected || this.query || Object.keys(this.filters).length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `${this.category}:${node.folder}`;
      item.iconPath = new vscode.ThemeIcon(selected ? 'list-ordered' : 'folder');
      item.contextValue = selected ? 'sheetSelection' : 'sourceFolder';
      return item;
    }
    if (!('source' in node)) return this.selection.getTreeItem(node);
    const { ex, bank, source } = node;
    const item = new vscode.TreeItem(this.flat && ex ? ex.titre : path.basename(source, '.typ'));
    item.id = `${bank.root}/${source}`;
    item.contextValue = ex ? 'exercice' : 'typstSource';
    item.resourceUri = vscode.Uri.file(path.join(bank.root, source));
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.description = ex ? [`${ex.difficulte}/5`, duration(ex), ex.langages.join(', ')].filter(Boolean).join(' · ') : this.flat ? path.dirname(source) : undefined;
    item.tooltip = ex ? [ex.titre, source, ex.chapitres.join(', '), ex.niveaux.join(', ')].join('\n') : source;
    if (ex) item.checkboxState = this.selection.has({ bank, ex }) ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    item.command = { command: 'exercicesMpi.source', title: 'Ouvrir la source', arguments: [node] };
    return item;
  }
  toggle(): void { this.flat = !this.flat; void this.state.update(`flat.${this.category}`, this.flat); this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }
}
