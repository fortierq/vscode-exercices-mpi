import * as vscode from 'vscode';
import * as path from 'node:path';
import { outline, OutlineItem } from './typst';
import { Sheets, SheetMember, memberItem } from './sheets';

type Node = { title: string; children?: Node[]; uri?: vscode.Uri; line?: number; icon?: string; collapsed?: boolean; member?: SheetMember };
export class CurrentFile implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private nodes: Node[] = [];
  private current?: vscode.TextDocument;
  private subscriptions: vscode.Disposable[] = [];
  private revision = 0;
  constructor(context: vscode.ExtensionContext, private sheets?: Sheets, dragAndDropController?: vscode.TreeDragAndDropController<Node>) {
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor?.document.uri.path.endsWith('.typ')) { this.current = editor.document; this.update(); } }),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.document === this.current) this.update(); }));
    this.current = vscode.window.activeTextEditor?.document;
    if (sheets) this.subscriptions.push(sheets.changed.event(() => this.update()));
    this.update();
    context.subscriptions.push(vscode.window.createTreeView('exercicesMpi.current', { treeDataProvider: this, showCollapseAll: true, dragAndDropController }));
  }
  private update(): void {
    const revision = ++this.revision;
    if (!this.current?.uri.path.endsWith('.typ')) return;
    const document = this.current;
    const items = outline(document.getText());
    const node = (item: OutlineItem): Node => ({ title: item.title, line: item.line, uri: document.uri,
      icon: item.kind === 'question' ? 'list-ordered' : item.kind === 'partie' ? 'symbol-namespace' : 'symbol-property',
      children: item.children?.map(node), collapsed: item.kind === 'partie' });
    this.nodes = [{ title: path.basename(document.uri.fsPath), uri: document.uri, line: 0, icon: 'file-code' },
      { title: 'Métadonnées', uri: document.uri, line: items.find(item => item.kind === 'meta')?.line ?? 0, icon: 'tag' },
      ...items.filter(item => item.kind !== 'meta' && item.kind !== 'import').map(node)];
    this.emitter.fire();
    if (this.sheets) {
      const sheet = this.sheets.locate(document.uri);
      if (sheet && document.uri.fsPath === path.join(sheet.bank.root, sheet.source)) {
        void this.sheets.members(sheet.bank, sheet.source).then(members => {
          if (this.current !== document || revision !== this.revision) return;
          this.nodes = [...this.nodes.slice(0, 2), ...members.map(member => ({ title: member.title, member }))];
          this.emitter.fire();
        }).catch(() => undefined);
      }
    }
  }
  getChildren(node?: Node): Node[] { return node?.children ?? (node ? [] : this.nodes); }
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.member) return memberItem(node.member);
    const item = new vscode.TreeItem(node.title, node.children ? node.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = `${this.current?.uri.toString()}:${node.line ?? 'metadata'}:${node.icon}`;
    item.iconPath = new vscode.ThemeIcon(node.icon ?? 'symbol-property');
    if (node.uri) item.command = { command: 'exercicesMpi.reveal', title: 'Afficher dans la source', arguments: [node.uri, node.line] };
    return item;
  }
  dispose(): void { this.emitter.dispose(); for (const sub of this.subscriptions) sub.dispose(); }
}

export async function reveal(uri: vscode.Uri, line = 0): Promise<void> {
  const editor = await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
  const position = new vscode.Position(Math.min(line, editor.document.lineCount - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  await vscode.commands.executeCommand('exercicesMpi.sync');
}
