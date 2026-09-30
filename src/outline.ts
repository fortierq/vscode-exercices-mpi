import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { Bank } from './runner';
import { normalize } from './core';
import { outline, OutlineItem } from './typst';

type Node = { title: string; children?: Node[]; uri?: vscode.Uri; line?: number; icon?: string };
export class CurrentFile implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private nodes: Node[] = [];
  private current?: vscode.TextDocument;
  private subscriptions: vscode.Disposable[] = [];
  constructor(context: vscode.ExtensionContext) {
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor?.document.uri.path.endsWith('.typ')) { this.current = editor.document; this.update(); } }),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.document === this.current) this.update(); }));
    this.current = vscode.window.activeTextEditor?.document;
    this.update();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('exercicesMpi.current', this));
  }
  private update(): void {
    if (!this.current?.uri.path.endsWith('.typ')) return;
    const document = this.current;
    const items = outline(document.getText());
    const leaf = (item: OutlineItem): Node => ({ title: item.title, line: item.line, uri: document.uri, icon: item.kind === 'question' ? 'list-ordered' : item.kind === 'partie' ? 'symbol-namespace' : 'symbol-property' });
    this.nodes = [{ title: path.basename(document.uri.fsPath), uri: document.uri, line: 0, icon: 'file-code' },
      { title: 'Métadonnées', children: items.filter(item => item.kind === 'meta').map(leaf), icon: 'tag' },
      ...items.filter(item => item.kind !== 'meta').map(leaf)];
    this.emitter.fire();
  }
  getChildren(node?: Node): Node[] { return node?.children ?? (node ? [] : this.nodes); }
  getTreeItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(node.title, node.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
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
}

export async function sourceFromText(bank: Bank, source: string, text: string): Promise<void> {
  const needle = normalize(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (needle.length < 5) { await reveal(vscode.Uri.file(path.join(bank.root, source))); return; }
  const candidates: { label: string; description: string; file: string; line: number }[] = [];
  const visited = new Set<string>();
  async function scan(file: string): Promise<void> {
    const actual = await realpath(file);
    if (!actual.startsWith(bank.root + path.sep) || visited.has(actual) || visited.size >= 50) return;
    visited.add(actual);
    const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === actual);
    const content = document?.getText() ?? await readFile(actual, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const fragment = normalize(lines.slice(i, i + 3).join(' ')).replace(/[^\p{L}\p{N}]+/gu, ' ');
      const firstLine = normalize(lines[i]).replace(/[^\p{L}\p{N}]+/gu, ' ');
      if (firstLine.includes(needle.split(' ')[0]) && fragment.includes(needle) && !candidates.some(candidate => candidate.file === actual && Math.abs(candidate.line - i) < 3)) {
        candidates.push({ label: lines[i].trim().slice(0, 100), description: `${path.relative(bank.root, actual)}:${i + 1}`, file: actual, line: i });
      }
    }
    for (const match of content.matchAll(/#import\s+"([^"\n]+\.typ)"/g)) {
      const imported = match[1].startsWith('/') ? path.join(bank.root, match[1]) : path.resolve(path.dirname(actual), match[1]);
      if (/(?:exercices|concours)\//.test(imported)) await scan(imported).catch(() => undefined);
    }
  }
  await scan(path.join(bank.root, source));
  const picked = candidates.length === 1 ? candidates[0] : candidates.length ? await vscode.window.showQuickPick(candidates, { placeHolder: 'Plusieurs passages correspondent au texte du PDF' }) : undefined;
  if (picked) await reveal(vscode.Uri.file(picked.file), picked.line);
  else if (!candidates.length) { await reveal(vscode.Uri.file(path.join(bank.root, source))); void vscode.window.showInformationMessage('Passage non retrouvé exactement. Le plan « Fichier en cours » permet de rejoindre la question.'); }
}
