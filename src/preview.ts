import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Variant, pdfTarget, pdfFilename } from './core';
import { Bank, Runner } from './runner';
import * as tinymist from './tinymist';

export interface Preview {
  bank: Bank; source: string; variant: Variant; panel: vscode.WebviewPanel;
  sessions: Map<Variant, tinymist.Session>;
  jumps: boolean;
  native: boolean;
  dark?: boolean;
  toggleJumps(): Promise<void>;
  toggleTheme(): Promise<void>;
  select(variant: Variant): Promise<void>;
  restart(): Promise<void>;
}
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Previews implements vscode.Disposable {
  readonly entries = new Map<string, Preview>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private editor = vscode.window.activeTextEditor;
  private fallback = new Runner();
  constructor(private readonly context: vscode.ExtensionContext, private readonly exportPdf: (preview: Preview, variant: Variant) => Promise<void>, private readonly hasTinymist = () => !!vscode.extensions.getExtension('myriad-dreamin.tinymist')) {
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor?.document.uri.path.endsWith('.typ')) this.editor = editor; }), vscode.window.onDidChangeTextEditorSelection(event => {
      const mode = vscode.workspace.getConfiguration('tinymist').get<string>('preview.scrollSync', 'onSelectionChangeByMouse');
      if (mode === 'never' || event.kind === vscode.TextEditorSelectionChangeKind.Command || (mode === 'onSelectionChangeByMouse' && event.kind !== vscode.TextEditorSelectionChangeKind.Mouse)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.sync(event.textEditor).catch(this.report); }, 120);
    }), vscode.window.onDidChangeActiveColorTheme(() => this.restart()),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('exercicesMpi.previewTheme')) this.restart(); }),
    vscode.workspace.onDidSaveTextDocument(doc => { for (const preview of this.entries.values()) if (!preview.native && doc.uri.fsPath.startsWith(preview.bank.root + path.sep)) void preview.restart().catch(this.report); }));
  }
  private report(error: unknown): void { void vscode.window.showErrorMessage(`Aperçu : ${String(error)}`); }
  private restart(): void { for (const preview of this.entries.values()) if (preview.dark === undefined) void preview.restart().catch(this.report); }

  async sync(editor = this.editor): Promise<void> {
    if (!editor || editor.document.uri.scheme !== 'file') return;
    for (const preview of this.entries.values()) {
      const session = preview.sessions.get(preview.variant);
      if (preview.jumps && session && preview.panel.visible && editor.document.uri.fsPath.startsWith(preview.bank.root + path.sep)) await tinymist.forward(session, editor);
    }
  }

  async open(bank: Bank, source: string, variant: Variant): Promise<Preview> {
    const key = `${bank.root}/${source}`;
    const existing = this.entries.get(key);
    if (existing) { existing.panel.reveal(undefined, true); await existing.select(variant); return existing; }
    const panel = vscode.window.createWebviewPanel('exercicesMpi.pdf', pdfFilename(source, variant), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media'), vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfjs')]
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'pdf.svg');
    const sessions = new Map<Variant, tinymist.Session>();
    const pdfs = new Map<Variant, string>();
    const channel = randomBytes(18).toString('hex');
    const post = (message: object) => panel.webview.postMessage({ ...message, channel });
    let disposed = false;
    let ready = false;
    let queue = Promise.resolve();
    const enqueue = (action: () => Promise<void>) => { const next = queue.catch(() => undefined).then(action); queue = next; return next; };
    const isDark = () => {
      const theme = vscode.workspace.getConfiguration('exercicesMpi', bank.scope).get<string>('previewTheme', 'auto');
      return preview.dark ?? (theme === 'dark' || (theme === 'auto' && [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind)));
    };
    const describe = async () => {
      panel.title = pdfFilename(source, preview.variant);
      if (ready && !disposed) await post({ type: 'show', variant: preview.variant, native: preview.native, jumps: preview.jumps, dark: isDark(), pdf: pdfs.get(preview.variant), sessions: Object.fromEntries([...sessions].map(([v, s]) => [v, s.url])), tokens: Object.fromEntries([...sessions].map(([v, s]) => [v, s.id])) });
    };
    const select = async (value: Variant) => {
      if (disposed) return;
      if (!preview.native && !pdfs.has(value)) {
        if (vscode.workspace.textDocuments.some(doc => doc.isDirty && doc.uri.fsPath.startsWith(bank.root + path.sep))) throw new Error('Sans Tinymist, enregistrez les fichiers de la banque pour actualiser l’aperçu PDF.');
        await post({ type: 'status', message: 'Compilation du PDF…' });
        const target = pdfTarget(source, value);
        await this.fallback.run(bank, [target]);
        pdfs.set(value, (await readFile(path.join(bank.root, target))).toString('base64'));
      }
      if (preview.native && !sessions.has(value)) {
        await post({ type: 'status', message: 'Démarrage de Tinymist…' });
        const session = await tinymist.start(bank, source, value, { dark: isDark(), canJump: () => preview.jumps && preview.variant === value && panel.visible });
        if (disposed) { await tinymist.stop(session); return; }
        sessions.set(value, session);
      }
      preview.variant = value;
      await describe();
    };
    const preview: Preview = {
      bank, source, variant, panel, sessions, native: this.hasTinymist(), jumps: this.hasTinymist(),
      toggleJumps: async () => { preview.jumps = preview.native && !preview.jumps; await describe(); },
      toggleTheme: async () => { preview.dark = !isDark(); if (preview.native) await preview.restart(); else await describe(); },
      select: value => enqueue(() => select(value)),
      restart: () => enqueue(async () => {
        if (disposed) return;
        await post({ type: 'reset' });
        pdfs.clear();
        const previous = [...sessions.values()]; sessions.clear();
        await Promise.all(previous.map(session => tinymist.stop(session).catch(() => undefined)));
        await select(preview.variant);
      })
    };
    this.entries.set(key, preview);
    const listener = panel.webview.onDidReceiveMessage(async message => {
      try {
        if (message?.type === 'ready') { ready = true; await describe(); }
        else if (message?.type === 'enonce' || message?.type === 'corrige') await preview.select(message.type);
        else if (message?.type === 'jumps') await preview.toggleJumps();
        else if (message?.type === 'theme') await preview.toggleTheme();
        else if (message?.type === 'restart') await preview.restart();
        else if (message?.type === 'sync') await this.sync();
        else if (message?.type === 'save') await this.exportPdf(preview, preview.variant);
      } catch (error) { if (!disposed) await post({ type: 'status', message: String(error) }); }
    });
    panel.onDidDispose(() => {
      disposed = true; listener.dispose(); this.entries.delete(key);
      for (const session of sessions.values()) void tinymist.stop(session).catch(() => undefined);
      sessions.clear();
    });
    const webview = panel.webview;
    const uri = (file: string) => escape(webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file)).toString());
    const nonce = randomBytes(18).toString('base64');
    // Frame URLs originate only from the extension, never from source contents.
    webview.html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data: blob:; worker-src ${webview.cspSource} blob:; connect-src ${webview.cspSource}; img-src data: blob: ${webview.cspSource}; frame-src http://127.0.0.1:* https:;">
      <link rel="stylesheet" href="${uri('viewer.css')}"></head><body data-channel="${channel}" data-pdfjs="${escape(webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfjs')).toString())}/">
      <nav aria-label="Outils de l'aperçu"><button id="enonce" aria-pressed="true">Énoncé</button><button id="corrige" aria-pressed="false">Corrigé</button>
      <span class="watch" title="Mise à jour à la frappe par Tinymist">● watch</span>
      <button id="jumps" title="Sauts source ↔ aperçu" aria-label="Sauts source ↔ aperçu" aria-pressed="true"><svg viewBox="0 0 24 24"><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"/></svg></button>
      <button id="theme" title="Mode sombre" aria-label="Mode sombre" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/></svg></button>
      <button id="restart" title="Redémarrer l'aperçu" aria-label="Redémarrer l'aperçu"><svg viewBox="0 0 24 24"><path d="M20 8a9 9 0 1 0 1 8M20 2v6h-6"/></svg></button>
      <button id="save" title="Exporter le PDF…" aria-label="Exporter le PDF"><svg width="16" height="16" viewBox="0 0 21 21" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h12l3 3v12H3zM6 3v6h8V3M6 18v-6h9v6"/></svg></button></nav>
      <p id="status" role="status">Chargement…</p><main id="viewers"></main>
      <script nonce="${nonce}" src="${uri('viewer.mjs')}" type="module"></script></body></html>`;
    try { await preview.select(variant); return preview; }
    catch (error) { panel.dispose(); throw error; }
  }

  dispose(): void { this.fallback.dispose(); clearTimeout(this.timer); for (const sub of this.subscriptions) sub.dispose(); for (const preview of [...this.entries.values()]) preview.panel.dispose(); }
}
