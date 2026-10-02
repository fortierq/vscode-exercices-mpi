import * as vscode from 'vscode';
import * as path from 'node:path';
import { Bank } from './runner';
import { Exercise, Filters, duration, matches, normalize } from './core';
import { Folder, hierarchy, isFolder } from './tree';
import { SheetMember, memberItem } from './sheets';

export interface Source { bank: Bank; source: string; ex?: Exercise; metadata?: Exercise[]; members?: SheetMember[]; compositionError?: string }
type Leaf = Source | SheetMember;
export type BrowserNode = Leaf | Folder<Leaf>;
export class Browser implements vscode.TreeDataProvider<BrowserNode>, vscode.Disposable {
  readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  entries: Source[] = [];
  directories: { bank: Bank; source: string }[] = [];
  query = '';
  filters: Filters = {};
  flat: boolean;
  private folders = new Map<string, Folder<Leaf>>();
  constructor(readonly category: 'exercices' | 'feuilles' | 'concours', private state: vscode.Memento) {
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
  get searching(): boolean { return !!this.query.trim() || Object.values(this.filters).some(Boolean); }
  getParent(node: BrowserNode): BrowserNode | undefined {
    const id = this.getTreeItem(node).id;
    const find = (nodes: BrowserNode[], parent?: BrowserNode): BrowserNode | undefined => {
      for (const child of nodes) {
        if (this.getTreeItem(child).id === id) return parent;
        const found = find(this.getChildren(child), child);
        if (found) return found;
      }
      return undefined;
    };
    return find(this.getChildren());
  }
  getChildren(node?: BrowserNode): BrowserNode[] {
    if (node) return isFolder(node) ? node.children : 'members' in node ? node.members ?? [] : [];
    const banks = new Set(this.entries.map(item => item.bank.root));
    const entries = [...this.visible].sort((a, b) => (a.ex?.titre ?? a.source).localeCompare(b.ex?.titre ?? b.source, 'fr', { numeric: true }));
    const files: BrowserNode[] = this.flat ? entries : [];
    if (!this.flat) {
      for (const bank of new Map([...entries, ...this.directories].map(item => [item.bank.root, item.bank])).values()) {
        const tree = hierarchy<Leaf>(entries.filter(item => item.bank.root === bank.root), item => item.source.replace(/^[^/]+\//, ''));
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
    // Keep folder identities stable when reveal walks back up the hierarchy.
    const folders = new Map<string, Folder<Leaf>>();
    const stable = (nodes: BrowserNode[]): BrowserNode[] => nodes.map(node => {
      if (!isFolder(node)) return node;
      node.children = stable(node.children);
      const folder = Object.assign(this.folders.get(node.folder) ?? node, node);
      folders.set(node.folder, folder);
      return folder;
    });
    const roots = stable(files);
    this.folders = folders;
    return roots;
  }
  getTreeItem(node: BrowserNode): vscode.TreeItem {
    if (isFolder(node)) {
      const item = new vscode.TreeItem(node.title, this.query || Object.keys(this.filters).length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `${this.category}:${node.folder}`;
      item.iconPath = new vscode.ThemeIcon('folder');
      item.contextValue = 'sourceFolder';
      return item;
    }
    if ('sheet' in node) return memberItem(node);
    const { ex, bank, source } = node;
    const item = new vscode.TreeItem(ex?.titre ?? node.metadata?.[0]?.titre ?? path.basename(source, '.typ'), source.startsWith('feuilles/') ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = `${bank.root}/${source}`;
    item.contextValue = ex ? 'exercice' : 'typstSource';
    if (!ex) { item.resourceUri = vscode.Uri.file(path.join(bank.root, source)); item.iconPath = new vscode.ThemeIcon('file-code'); }
    item.description = ex ? [ex.concours?.nom, `${ex.difficulte}/5`, duration(ex), ex.langages.join(', ')].filter(Boolean).join(' · ') : this.flat ? path.dirname(source) : undefined;
    item.tooltip = ex ? [ex.titre, source, ex.chapitres.join(', '), ex.niveaux.join(', ')].join('\n') : source;
    item.command = { command: 'exercicesMpi.source', title: 'Afficher le fichier', arguments: [node] };
    return item;
  }
  toggle(): void { this.flat = !this.flat; void this.state.update(`flat.${this.category}`, this.flat); this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }
}
