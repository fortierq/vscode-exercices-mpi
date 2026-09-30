import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Variant } from './core';
import { Bank } from './runner';
import * as tinymist from './tinymist';

export interface Preview {
  bank: Bank; source: string; variant: Variant; panel: vscode.WebviewPanel;
  sessions: Map<Variant, tinymist.Session>;
  select(variant: Variant): Promise<void>;
  restart(): Promise<void>;
}
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Previews implements vscode.Disposable {
  readonly entries = new Map<string, Preview>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private editor = vscode.window.activeTextEditor;
  constructor(private readonly context: vscode.ExtensionContext, private readonly exportPdf: (preview: Preview, variant: Variant) => Promise<void>) {
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor?.document.uri.path.endsWith('.typ')) this.editor = editor; }), vscode.window.onDidChangeTextEditorSelection(event => {
      const mode = vscode.workspace.getConfiguration('tinymist').get<string>('preview.scrollSync', 'onSelectionChangeByMouse');
      if (mode === 'never' || event.kind === vscode.TextEditorSelectionChangeKind.Command || (mode === 'onSelectionChangeByMouse' && event.kind !== vscode.TextEditorSelectionChangeKind.Mouse)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.sync(event.textEditor).catch(this.report); }, 120);
    }), vscode.window.onDidChangeActiveColorTheme(() => this.restart()),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('exercicesMpi.previewTheme')) this.restart(); }));
  }
  private report(error: unknown): void { void vscode.window.showErrorMessage(`Aperçu Tinymist : ${String(error)}`); }
  private restart(): void { for (const preview of this.entries.values()) void preview.restart().catch(this.report); }

  async sync(editor = this.editor): Promise<void> {
    if (!editor || editor.document.uri.scheme !== 'file') return;
    for (const preview of this.entries.values()) {
      const session = preview.sessions.get(preview.variant);
      if (session && preview.panel.visible && editor.document.uri.fsPath.startsWith(preview.bank.root + path.sep)) await tinymist.forward(session, editor);
    }
  }

  async open(bank: Bank, source: string, variant: Variant): Promise<Preview> {
    const key = `${bank.root}/${source}`;
    const existing = this.entries.get(key);
    if (existing) { existing.panel.reveal(undefined, true); await existing.select(variant); return existing; }
    const panel = vscode.window.createWebviewPanel('exercicesMpi.pdf', path.basename(source), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    });
    const sessions = new Map<Variant, tinymist.Session>();
    const channel = randomBytes(18).toString('hex');
    const post = (message: object) => panel.webview.postMessage({ ...message, channel });
    let disposed = false;
    let ready = false;
    let queue = Promise.resolve();
    const enqueue = (action: () => Promise<void>) => { const next = queue.catch(() => undefined).then(action); queue = next; return next; };
    const describe = async () => {
      panel.title = `${path.basename(source, '.typ')} — ${preview.variant === 'corrige' ? 'corrigé' : 'énoncé'}`;
      if (ready && !disposed) await post({ type: 'show', variant: preview.variant, sessions: Object.fromEntries([...sessions].map(([v, s]) => [v, s.url])) });
    };
    const select = async (value: Variant) => {
      if (disposed) return;
      if (!sessions.has(value)) {
        await post({ type: 'status', message: 'Démarrage de Tinymist…' });
        const session = await tinymist.start(bank, source, value);
        if (disposed) { await tinymist.stop(session); return; }
        sessions.set(value, session);
      }
      preview.variant = value;
      await describe();
    };
    const preview: Preview = {
      bank, source, variant, panel, sessions,
      select: value => enqueue(() => select(value)),
      restart: () => enqueue(async () => {
        if (disposed) return;
        await post({ type: 'reset' });
        const previous = [...sessions.values()]; sessions.clear();
        await Promise.all(previous.map(session => tinymist.stop(session).catch(() => undefined)));
        await select(preview.variant);
      })
    };
    this.entries.set(key, preview);
    const listener = panel.webview.onDidReceiveMessage(async message => {
      try {
        if (message?.type === 'ready') { ready = true; await describe(); }
        else if (message?.type === 'switch') await preview.select(preview.variant === 'enonce' ? 'corrige' : 'enonce');
        else if (message?.type === 'restart') await preview.restart();
        else if (message?.type === 'sync') await this.sync();
        else if (message?.type === 'source') await vscode.window.showTextDocument(vscode.Uri.file(path.join(bank.root, source)), { viewColumn: vscode.ViewColumn.One });
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
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; frame-src http://127.0.0.1:* https:;">
      <link rel="stylesheet" href="${uri('viewer.css')}"></head><body data-channel="${channel}">
      <nav aria-label="Outils de l'aperçu"><button id="switch" title="Basculer énoncé / corrigé">Énoncé ⇄</button>
      <span class="watch" title="Mise à jour à la frappe par Tinymist">● watch</span>
      <button id="sync" title="Rejoindre le curseur dans l'aperçu" aria-label="Rejoindre le curseur">⌖</button>
      <button id="source" title="Ouvrir la source" aria-label="Ouvrir la source">&lt;/&gt;</button>
      <button id="restart" title="Redémarrer l'aperçu" aria-label="Redémarrer l'aperçu">↻</button>
      <button id="save" title="Exporter le PDF…" aria-label="Exporter le PDF"><svg width="16" height="16" viewBox="0 0 21 21" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h12l3 3v12H3zM6 3v6h8V3M6 18v-6h9v6"/></svg></button></nav>
      <p id="status" role="status">Démarrage de Tinymist…</p><main id="viewers"></main>
      <script nonce="${nonce}" src="${uri('viewer.mjs')}" type="module"></script></body></html>`;
    try { await preview.select(variant); return preview; }
    catch (error) { panel.dispose(); throw error; }
  }

  dispose(): void { clearTimeout(this.timer); for (const sub of this.subscriptions) sub.dispose(); for (const preview of [...this.entries.values()]) preview.panel.dispose(); }
}
