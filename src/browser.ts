import * as vscode from 'vscode';
import * as path from 'node:path';
import { Bank } from './runner';
import { BankEntry, Selection } from './authoring';
import { Exercise, Filters, duration, matches, normalize } from './core';
import { Folder, hierarchy, isFolder } from './tree';
import { SheetMember, memberItem } from './sheets';

export interface Source { bank: Bank; source: string; ex?: Exercise; metadata?: Exercise[]; members?: SheetMember[]; compositionError?: string }
type Leaf = Source | BankEntry | SheetMember;
export type BrowserNode = Leaf | Folder<Leaf>;
export class Browser implements vscode.TreeDataProvider<BrowserNode>, vscode.Disposable {
  readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  entries: Source[] = [];
  directories: { bank: Bank; source: string }[] = [];
  query = '';
  filters: Filters = {};
  flat: boolean;
  constructor(readonly category: 'exercices' | 'feuilles' | 'concours', private selection: Selection, private state: vscode.Memento) {
    this.flat = state.get(`flat.${category}`, false);
  }
  get visible(): Source[] {
    return this.entries.filter(item => {
      const metadata = item.ex ? [item.ex] : item.metadata ?? [];
      if (!metadata.length) return !Object.values(this.filters).some(Boolean) && normalize(item.source).includes(normalize(this.query));
      // A sheet matches when one member satisfies all facets. Its own title is searchable too.
      return metadata.some(ex => matches({ ...ex, titre: `${metadata[0].titre} ${ex.titre}`, fichier: `${item.source} ${ex.fichier}` }, this.query, this.filters));
    });
  }
  getChildren(node?: BrowserNode): BrowserNode[] {
    if (node) return isFolder(node) ? node.children : 'members' in node ? node.members ?? [] : [];
    const banks = new Set(this.entries.map(item => item.bank.root));
    const entries = [...this.visible].sort((a, b) => (a.ex?.titre ?? a.source).localeCompare(b.ex?.titre ?? b.source, 'fr', { numeric: true }));
    const files: BrowserNode[] = this.flat ? entries : [];
    if (!this.flat) {
      for (const bank of new Map([...entries, ...this.directories].map(item => [item.bank.root, item.bank])).values()) {
        const tree = hierarchy<Leaf>(entries.filter(item => item.bank.root === bank.root), item => ('source' in item ? item.source : item.ex.fichier).replace(/^[^/]+\//, ''));
        const decorate = (nodes: BrowserNode[]) => { for (const node of nodes) if (isFolder(node)) { Object.assign(node, { bank, source: this.category + node.folder }); decorate(node.children); node.folder = bank.root + '/' + this.category + node.folder; } };
        decorate(tree);
        if (!this.query && !Object.keys(this.filters).length) {
          for (const directory of this.directories.filter(item => item.bank.root === bank.root)) {
            let children = tree; let prefix = this.category;
            for (const title of directory.source.split('/').slice(1)) {
              prefix += '/' + title;
              let folder = children.find(item => isFolder(item) && item.folder === bank.root + '/' + prefix) as Folder<Leaf> | undefined;
              if (!folder) { folder = Object.assign({ folder: bank.root + '/' + prefix, title, children: [] }, { bank, source: prefix }); children.push(folder); }
              children = folder.children;
            }
          }
        }
        if (banks.size > 1) files.push(Object.assign({ folder: bank.root, title: bank.name, children: tree }, { bank, source: this.category })); else files.push(...tree);
      }
    }
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
    if ('sheet' in node) return memberItem(node);
    const { ex, bank, source } = node;
    const item = new vscode.TreeItem(ex?.titre ?? node.metadata?.[0]?.titre ?? path.basename(source, '.typ'), source.startsWith('feuilles/') ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = `${bank.root}/${source}`;
    item.contextValue = ex ? 'exercice' : 'typstSource';
    if (!ex) { item.resourceUri = vscode.Uri.file(path.join(bank.root, source)); item.iconPath = new vscode.ThemeIcon('file-code'); }
    item.description = ex ? [ex.concours?.nom, `${ex.difficulte}/5`, duration(ex), ex.langages.join(', ')].filter(Boolean).join(' · ') : node.compositionError ? 'Composition calculée — ouvrir la source' : this.flat ? path.dirname(source) : undefined;
    item.tooltip = ex ? [ex.titre, source, ex.chapitres.join(', '), ex.niveaux.join(', ')].join('\n') : source;
    if (ex) item.checkboxState = this.selection.has({ bank, ex }) ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    item.command = { command: 'exercicesMpi.source', title: 'Ouvrir la source', arguments: [node] };
    return item;
  }
  toggle(): void { this.flat = !this.flat; void this.state.update(`flat.${this.category}`, this.flat); this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }
}
