import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, MessageConnection } from 'vscode-jsonrpc/node';
import { Variant, previewArguments } from './core';
import { Bank } from './runner';

export interface Session { id: string; url: string; port: number; connection: MessageConnection; dispose(): void }

// Tinymist's shared LSP ignores per-preview root/inputs. An isolated LSP
// context reuses its installed engine without changing the user's settings.
export async function start(bank: Bank, source: string, variant: Variant, options: { dark?: boolean; canJump?: () => boolean } = {}): Promise<Session> {
  if (!vscode.workspace.isTrusted) throw new Error('Autorisez cet espace de travail pour ouvrir un aperçu.');
  const extension = vscode.extensions.getExtension('myriad-dreamin.tinymist');
  if (!extension) throw new Error('Installez Tinymist pour afficher les aperçus.');
  const binary = vscode.workspace.getConfiguration('tinymist', bank.scope).get<string | null>('serverPath') || path.join(extension.extensionPath, 'out', process.platform === 'win32' ? 'tinymist.exe' : 'tinymist');
  if (!existsSync(binary)) throw new Error('Moteur Tinymist introuvable. Vérifiez son installation ou tinymist.serverPath.');
  const id = `exercices-typst-${randomUUID()}`;
  const theme = vscode.workspace.getConfiguration('exercicesMpi', bank.scope).get<string>('previewTheme', 'auto');
  const dark = options.dark ?? (theme === 'dark' || (theme === 'auto' && [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind)));
  const args = previewArguments(bank.root, source, variant);
  const settings = { rootPath: bank.root, typstExtraArgs: args.slice(0, -1), exportPdf: 'never',
    preview: { refresh: 'onType', invertColors: JSON.stringify({ rest: dark ? 'always' : 'never', image: 'never' }) }, customizedShowDocument: true };
  const output = vscode.window.createOutputChannel(`Exercices Typst — ${path.basename(source)} (${variant})`);
  const child = spawn(binary, ['lsp'], { cwd: bank.root, stdio: 'pipe', windowsHide: true });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  const subscriptions: vscode.Disposable[] = [];
  const diagnostics = vscode.languages.createDiagnosticCollection(id);
  let stopped = false;
  const dispose = () => {
    if (stopped) return; stopped = true;
    for (const sub of subscriptions) sub.dispose();
    connection.dispose(); child.kill(); diagnostics.dispose(); output.dispose();
  };
  child.stderr.on('data', data => output.append(data.toString()));
  child.on('error', error => { output.appendLine(error.message); connection.dispose(); });
  child.once('exit', () => { if (!stopped) { connection.dispose(); void vscode.window.showErrorMessage('Le moteur d’aperçu s’est arrêté. Utilisez ↻ pour le redémarrer.'); } });
  connection.onRequest('workspace/configuration', (request: { items: unknown[] }) => request.items.map(() => settings));
  connection.onRequest('client/registerCapability', () => null);
  connection.onRequest('client/unregisterCapability', () => null);
  connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; message: string; severity?: number }[] }) => {
    diagnostics.set(vscode.Uri.parse(params.uri), params.diagnostics.map(d => new vscode.Diagnostic(new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character), d.message, (d.severity ?? 1) - 1)));
  });
  const showSource = async (jump: { filepath: string; start: [number, number] | null; end: [number, number] | null }) => {
    if (options.canJump?.() === false || !jump.start || !jump.end || !path.resolve(jump.filepath).startsWith(bank.root + path.sep)) return;
    try {
      const uri = vscode.Uri.file(jump.filepath);
      const column = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString())?.viewColumn ?? vscode.ViewColumn.One;
      const editor = await vscode.window.showTextDocument(uri, { viewColumn: column });
      editor.selection = new vscode.Selection(...jump.start, ...jump.end);
      editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (error) { output.appendLine(String(error)); }
  };
  connection.onNotification('tinymist/preview/scrollSource', showSource);
  connection.onRequest('window/showDocument', async (request: { uri: string; selection?: { start: { line: number; character: number }; end: { line: number; character: number } } }) => {
    const uri = vscode.Uri.parse(request.uri);
    if (options.canJump?.() === false || uri.scheme !== 'file' || !uri.fsPath.startsWith(bank.root + path.sep)) return { success: false };
    const { start, end } = request.selection ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    await showSource({ filepath: uri.fsPath, start: [start.line, start.character], end: [end.line, end.character] });
    return { success: true };
  });
  connection.listen();
  try {
    await connection.sendRequest('initialize', { processId: process.pid, rootUri: vscode.Uri.file(bank.root).toString(), workspaceFolders: [{ uri: vscode.Uri.file(bank.root).toString(), name: bank.name }],
      capabilities: { general: { positionEncodings: ['utf-16'] }, window: { showDocument: { support: true } }, textDocument: { publishDiagnostics: {} }, workspace: { configuration: true } }, initializationOptions: settings });
    await connection.sendNotification('initialized', {});
    const belongs = (doc: vscode.TextDocument) => doc.uri.scheme === 'file' && doc.uri.fsPath.startsWith(bank.root + path.sep) && doc.uri.path.endsWith('.typ');
    const opened = new Set<string>();
    const notify = (method: string, params: object) => { if (!stopped) void connection.sendNotification(method, params).catch(error => output.appendLine(String(error))); };
    const open = (doc: vscode.TextDocument) => {
      if (!belongs(doc) || opened.has(doc.uri.toString())) return;
      opened.add(doc.uri.toString());
      notify('textDocument/didOpen', { textDocument: { uri: doc.uri.toString(), languageId: 'typst', version: doc.version, text: doc.getText() } });
    };
    for (const document of vscode.workspace.textDocuments) open(document);
    subscriptions.push(vscode.workspace.onDidOpenTextDocument(open),
      vscode.workspace.onDidChangeTextDocument(event => { if (belongs(event.document)) { open(event.document); notify('textDocument/didChange', { textDocument: { uri: event.document.uri.toString(), version: event.document.version }, contentChanges: [{ text: event.document.getText() }] }); } }),
      vscode.workspace.onDidCloseTextDocument(doc => { if (opened.delete(doc.uri.toString())) notify('textDocument/didClose', { textDocument: { uri: doc.uri.toString() } }); }));
    const result = await connection.sendRequest<{ staticServerPort: number }>('workspace/executeCommand', {
      command: 'tinymist.doStartPreview', arguments: [['--task-id', id, '--data-plane-host', '127.0.0.1:0', '--invert-colors', settings.preview.invertColors, args.at(-1)!]]
    });
    const port = result?.staticServerPort;
    if (!Number.isInteger(port) || port! < 1 || port! > 65535) throw new Error("Tinymist n'a pas démarré l'aperçu.");
    const uri = await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${port}`));
    return { id, port, url: uri.toString(), connection, dispose };
  } catch (error) { dispose(); throw error; }
}

export async function stop(session: Session): Promise<void> { session.dispose(); }

export async function forward(session: Session, editor: vscode.TextEditor): Promise<void> {
  await session.connection.sendRequest('workspace/executeCommand', { command: 'tinymist.scrollPreview', arguments: [session.id, {
    event: 'panelScrollTo', filepath: editor.document.uri.fsPath,
    line: editor.selection.active.line, character: editor.selection.active.character
  }] });
}
