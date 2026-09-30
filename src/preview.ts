import * as vscode from 'vscode';
import * as path from 'node:path';
import { watch } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Variant, pdfTarget } from './core';
import { Bank } from './runner';
import { sourceFromText } from './outline';

export interface Preview { bank: Bank; source: string; variant: Variant; panel: vscode.WebviewPanel; refresh(): Promise<void>; state(value: string): void }
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const icons = {
  save: '<path d="M3 3h12l3 3v12H3zM6 3v6h8V3M6 18v-6h9v6"/>',
  source: '<path d="m7 5-6 5 6 5m7-10 6 5-6 5m-2-12-3 16"/>',
  refresh: '<path d="M18 7a8 8 0 1 0 1 6M18 2v6h-6"/>'
};
const button = (id: keyof typeof icons, title: string) => `<button id="${id}" title="${title}" aria-label="${title}"><svg width="16" height="16" viewBox="0 0 21 21" fill="none" stroke="currentColor" stroke-width="1.5">${icons[id]}</svg></button>`;

export class Previews implements vscode.Disposable {
  readonly entries = new Map<string, Preview>();
  constructor(private readonly context: vscode.ExtensionContext, private readonly recompile: (preview: Preview) => Promise<void>, private readonly closed: (preview: Preview) => void = () => {}) {}

  async open(bank: Bank, source: string, variant: Variant): Promise<Preview> {
    const key = `${bank.root}/${source}`;
    const existing = this.entries.get(key);
    if (existing) { existing.variant = variant; existing.panel.reveal(vscode.ViewColumn.Beside, true); await existing.refresh(); return existing; }
    const panel = vscode.window.createWebviewPanel('exercicesMpi.pdf', '', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media'), vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdfjs')]
    });
    let ready = false; let disposed = false; let state = 'watch';
    const file = () => path.join(bank.root, pdfTarget(source, preview.variant));
    const describe = async () => {
      panel.title = `${path.basename(source, '.typ')} — ${preview.variant === 'corrige' ? 'corrigé' : 'énoncé'}`;
      if (ready && !disposed) await panel.webview.postMessage({ type: 'info', variant: preview.variant, state });
    };
    const refresh = async () => {
      if (disposed) return;
      await describe();
      if (!ready) return;
      const bytes = await readFile(file());
      if (!disposed) await panel.webview.postMessage({ type: 'pdf', data: bytes.toString('base64') });
    };
    const preview: Preview = { bank, source, variant, panel, refresh, state(value) { if (disposed) return; state = value; void describe(); } };
    this.entries.set(key, preview);
    const report = (error: unknown) => { if (!disposed) void panel.webview.postMessage({ type: 'error', message: String(error) }); };
    let busy = false;
    const listener = panel.webview.onDidReceiveMessage(async message => {
      try {
        if (message?.type === 'ready') { ready = true; await refresh(); }
        else if ((message?.type === 'compile' || message?.type === 'switch') && !busy) {
          busy = true;
          try {
            if (message.type === 'switch') preview.variant = preview.variant === 'enonce' ? 'corrige' : 'enonce';
            preview.state('compilation'); await this.recompile(preview);
          } finally { busy = false; }
        } else if (message?.type === 'source') {
          if (typeof message.text === 'string' && message.text.trim()) await sourceFromText(bank, source, message.text.slice(0, 400));
          else await vscode.window.showTextDocument(vscode.Uri.file(path.join(bank.root, source)), { viewColumn: vscode.ViewColumn.One });
        } else if (message?.type === 'save') {
          const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(bank.root, `${path.basename(source, '.typ')}-${preview.variant}.pdf`)), filters: { PDF: ['pdf'] } });
          if (destination) await vscode.workspace.fs.copy(vscode.Uri.file(file()), destination, { overwrite: true });
        }
      } catch (error) { preview.state('erreur'); report(error); }
    });
    let timer: NodeJS.Timeout | undefined;
    const watcher = watch(path.dirname(file()), (_event, name) => {
      if (name && String(name) !== path.basename(file())) return;
      clearTimeout(timer); timer = setTimeout(() => { void refresh().catch(report); }, 150);
    });
    watcher.on('error', report);
    panel.onDidDispose(() => { disposed = true; clearTimeout(timer); listener.dispose(); watcher.close(); this.entries.delete(key); this.closed(preview); });
    const webview = panel.webview;
    const uri = (...parts: string[]) => escape(webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts)).toString());
    const nonce = randomBytes(18).toString('base64');
    panel.webview.html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src ${webview.cspSource} blob:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data: blob:; img-src ${webview.cspSource} data: blob:; connect-src ${webview.cspSource};">
      <link rel="stylesheet" href="${uri('dist', 'pdfjs', 'pdf_viewer.css')}"><link rel="stylesheet" href="${uri('media', 'viewer.css')}"><title>PDF</title></head>
      <body data-pdfjs="${uri('dist', 'pdfjs')}/"><nav aria-label="Outils PDF">
      <button id="switch" class="variant" title="Basculer entre l'énoncé et le corrigé" aria-label="Basculer entre l'énoncé et le corrigé">Énoncé ⇄</button>
      <input id="page" type="number" min="1" value="1" aria-label="Numéro de page"><span id="total">/ …</span>
      <select id="zoom" aria-label="Zoom"><option value="fit">Largeur</option><option value="0.75">75 %</option><option value="1">100 %</option><option value="1.5">150 %</option><option value="2">200 %</option></select>
      <span id="watch" title="Compilation continue Typst">● watch</span>
      ${button('refresh', 'Recompiler avec make c')}${button('source', 'Ouvrir la source')}${button('save', 'Enregistrer le PDF sous…')}</nav>
      <p id="status" role="status">Chargement du PDF…</p><main id="viewport" tabindex="0" aria-label="Document PDF : défiler ou utiliser les flèches du clavier. Double-cliquer le texte pour rejoindre sa source."></main>
      <script nonce="${nonce}" type="module" src="${uri('media', 'viewer.mjs')}"></script></body></html>`;
    await describe();
    return preview;
  }

  dispose(): void { for (const preview of [...this.entries.values()]) preview.panel.dispose(); }
}
