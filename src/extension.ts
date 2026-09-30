import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { Filters, facets, labels, matches, parseCatalogue, pdfTarget, safeSource } from './core';
import { Bank, Runner } from './runner';
import { Previews } from './preview';
import { CurrentFile, reveal } from './outline';
import { BankEntry, newExercise, newSheet, Selection, selectBank } from './authoring';
import { Browser, BrowserNode, Source } from './browser';
import { isFolder } from './tree';

export async function activate(context: vscode.ExtensionContext) {
  const runner = new Runner();
  const selection = new Selection();
  const library = new Browser('exercices', selection, context.workspaceState);
  const sheets = new Browser('feuilles', selection, context.workspaceState);
  const contests = new Browser('concours', selection, context.workspaceState);
  const browsers = [library, sheets, contests];
  const view = vscode.window.createTreeView('exercicesMpi.library', { treeDataProvider: library, showCollapseAll: true, canSelectMany: true, manageCheckboxStateManually: true });
  const sheetView = vscode.window.createTreeView('exercicesMpi.sheets', { treeDataProvider: sheets, showCollapseAll: true });
  const contestView = vscode.window.createTreeView('exercicesMpi.contests', { treeDataProvider: contests, showCollapseAll: true });
  const currentFile = new CurrentFile(context);
  let banks: Bank[] = [];
  let watchers: vscode.Disposable[] = [];
  let disposed = false;
  let discovery = Promise.resolve();
  const saved = context.workspaceState.get<{ query: string; filters: Filters }>('search');
  if (saved) { library.query = saved.query; library.filters = saved.filters; }
  const entries = (): BankEntry[] => library.entries.flatMap(item => item.ex ? [{ bank: item.bank, ex: item.ex }] : []);
  const visible = (): BankEntry[] => library.visible.flatMap(item => item.ex ? [{ bank: item.bank, ex: item.ex }] : []);
  const report = (error: unknown) => {
    if (disposed || error instanceof vscode.CancellationError) return;
    runner.output.appendLine(String(error));
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error), 'Voir le journal').then(choice => { if (choice) runner.output.show(true); });
  };
  const update = () => {
    view.description = `${library.visible.length} / ${library.entries.length}`;
    view.message = [library.query && `Recherche : ${library.query}`, ...facets.filter(key => library.filters[key]).map(key => `${labels[key]} : ${library.filters[key]}`), library.filters.difficulteMax && `Difficulté ≤ ${library.filters.difficulteMax}`].filter(Boolean).join(' · ') || undefined;
    library.changed.fire();
    void context.workspaceState.update('search', { query: library.query, filters: library.filters });
  };
  async function scan(bank: Bank, browser: Browser): Promise<void> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(bank.root), `${browser.category}/**/*.typ`), null);
    const metadata = new Map(entries().filter(entry => entry.bank.root === bank.root).map(entry => [entry.ex.fichier, entry.ex]));
    const sources = files.map(uri => { const source = path.relative(bank.root, uri.fsPath).split(path.sep).join('/'); return { bank, source, ex: metadata.get(source) }; });
    browser.entries = [...browser.entries.filter(entry => entry.bank.root !== bank.root), ...sources];
    browser.changed.fire(); if (browser === library) update();
  }
  async function load(bank: Bank): Promise<void> {
    const catalogue = parseCatalogue(await readFile(path.join(bank.root, 'build/catalogue.json'), 'utf8'));
    const metadata = new Map(catalogue.map(ex => [ex.fichier, ex]));
    await scan(bank, library);
    for (const item of library.entries) if (item.bank.root === bank.root) item.ex = metadata.get(item.source);
    update();
  }
  async function discover(): Promise<void> {
    for (const watcher of watchers) watcher.dispose(); watchers = [];
    banks = []; for (const browser of browsers) browser.entries = [];
    const seen = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      const configured = vscode.workspace.getConfiguration('exercicesMpi', folder.uri).get<string>('bankPath', '');
      const candidate = path.resolve(folder.uri.fsPath, configured || '.');
      if (!['scripts/catalogue.py', 'templates/fiche.typ', 'lib/exercices.typ', 'Makefile'].every(file => existsSync(path.join(candidate, file)))) continue;
      const root = await realpath(candidate);
      if (seen.has(root)) continue; seen.add(root);
      const bank: Bank = { root, name: path.basename(root), scope: folder.uri }; banks.push(bank);
      try {
        if (!existsSync(path.join(root, 'build/catalogue.json'))) await runner.run(bank, ['catalogue']);
        await load(bank);
      } catch (error) { report(error); await scan(bank, library); }
      await Promise.all([scan(bank, sheets), scan(bank, contests)]);
      const catalogue = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), 'build/catalogue.json'));
      let timer: NodeJS.Timeout | undefined;
      const reload = () => { clearTimeout(timer); timer = setTimeout(() => { void load(bank).catch(report); }, 200); };
      catalogue.onDidChange(reload); catalogue.onDidCreate(reload);
      watchers.push(catalogue, { dispose: () => clearTimeout(timer) });
      for (const browser of browsers) {
        const files = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), `${browser.category}/**/*.typ`));
        const rescan = () => { void scan(bank, browser).catch(report); };
        files.onDidCreate(rescan); files.onDidDelete(rescan);
        if (browser === library) files.onDidChange(() => { view.message = 'Métadonnées modifiées : ↻ actualise le catalogue.'; });
        watchers.push(files);
      }
    }
    for (const browser of browsers) browser.changed.fire();
    update();
    if (!banks.length) view.message = 'Ouvrez une banque ou renseignez le réglage Bank Path.';
  }
  const discoverQueued = () => { discovery = discovery.catch(() => undefined).then(discover); return discovery; };
  async function checkSource(source: Source): Promise<Source> {
    safeSource(source.source);
    if (!banks.some(bank => bank.root === source.bank.root)) throw new Error('Cette banque ne fait pas partie de cet espace de travail.');
    const file = await realpath(path.join(source.bank.root, source.source));
    if (!file.startsWith(source.bank.root + path.sep)) throw new Error('La source doit rester dans la banque.');
    return source;
  }
  async function chooseSource(argument?: BrowserNode | vscode.Uri): Promise<Source | undefined> {
    await discovery;
    if (argument && !(argument instanceof vscode.Uri)) {
      if (isFolder(argument)) return;
      return checkSource('source' in argument ? argument : { bank: argument.bank, source: argument.ex.fichier });
    }
    const uri = argument ?? vscode.window.activeTextEditor?.document.uri;
    if (uri?.scheme === 'file') {
      const file = await realpath(uri.fsPath);
      const bank = banks.filter(bank => file.startsWith(bank.root + path.sep)).sort((a, b) => b.root.length - a.root.length)[0];
      if (bank) {
        const source = path.relative(bank.root, file).split(path.sep).join('/');
        if (/^(exercices|feuilles|concours)\//.test(source)) return checkSource({ bank, source });
      }
      if (argument) throw new Error('Choisissez une source dans exercices/, feuilles/ ou concours/.');
    }
    const picked = await vscode.window.showQuickPick(library.visible.map(item => ({ label: item.ex?.titre ?? item.source, description: item.bank.name, detail: item.source, item })), { placeHolder: 'Choisir un exercice', matchOnDetail: true });
    return picked ? checkSource(picked.item) : undefined;
  }
  async function compile(source: Source, targets = ['c', source.source]): Promise<void> {
    await checkSource(source);
    if (vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === 'file' && document.uri.fsPath.startsWith(source.bank.root + path.sep))) throw new Error('Enregistrez les fichiers modifiés de la banque avant d’exporter le PDF.');
    await runner.run(source.bank, targets);
  }
  const previews = new Previews(context, async (preview, variant) => {
    const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(preview.bank.root, `${path.basename(preview.source, '.typ')}-${variant}.pdf`)), filters: { PDF: ['pdf'] } });
    if (!destination) return;
    const target = pdfTarget(preview.source, variant);
    await compile(preview, [target]);
    const from = vscode.Uri.file(path.join(preview.bank.root, target));
    if (from.toString() !== destination.toString()) await vscode.workspace.fs.copy(from, destination, { overwrite: true });
  });
  context.subscriptions.push(selection.onDidChangeTreeData(() => { library.changed.fire(); sheets.changed.fire(); }), view.onDidChangeCheckboxState(event => {
    try {
      const checked = event.items.flatMap(([item, state]) => !isFolder(item) && item.ex && state === vscode.TreeItemCheckboxState.Checked ? [{ bank: item.bank, ex: item.ex }] : []);
      selection.add(checked);
      for (const [item, state] of event.items) if (!isFolder(item) && item.ex && state === vscode.TreeItemCheckboxState.Unchecked) selection.remove({ bank: item.bank, ex: item.ex });
    } catch (error) { library.changed.fire(); report(error); }
  }));
  const register = (name: string, action: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(`exercicesMpi.${name}`, async (...args: unknown[]) => {
      try { return await action(...args); } catch (error) { if (error instanceof vscode.CancellationError) return; report(error); throw error; }
    }));
  };
  register('search', async () => {
    const query = await vscode.window.showInputBox({ title: 'Rechercher des exercices', prompt: 'Titre, fichier ou métadonnées ; accents ignorés.', value: library.query });
    if (query !== undefined) { library.query = query; update(); await vscode.commands.executeCommand('exercicesMpi.library.focus'); }
  });
  register('filters', async () => {
    const options = [...facets.map(key => ({ label: labels[key], description: library.filters[key] ?? 'Tous', key })), { label: 'Difficulté maximale', description: String(library.filters.difficulteMax ?? 'Toutes'), key: 'difficulteMax' as const }];
    const chosen = await vscode.window.showQuickPick(options, { title: 'Filtrer les exercices' }); if (!chosen) return;
    const key = chosen.key;
    const values = key === 'difficulteMax' ? ['1', '2', '3', '4', '5'] : [...new Set(entries().flatMap(({ ex }) => key === 'concours' ? ex.concours?.nom ? [ex.concours.nom] : [] : ex[key]))].sort((a, b) => a.localeCompare(b, 'fr'));
    const value = await vscode.window.showQuickPick([{ label: 'Tous / toutes', value: '' }, ...values.map(value => ({ label: value, value }))], { title: chosen.label }); if (!value) return;
    if (!value.value) delete library.filters[key]; else if (key === 'difficulteMax') library.filters.difficulteMax = +value.value; else library.filters[key] = value.value;
    update();
  });
  register('reset', () => { library.query = ''; library.filters = {}; update(); });
  register('refresh', async () => { await discovery; if (!banks.length) await discoverQueued(); for (const bank of banks) { await runner.run(bank, ['catalogue']); await load(bank); } });
  register('source', async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await vscode.window.showTextDocument(vscode.Uri.file(path.join(source.bank.root, source.source))); });
  for (const variant of ['enonce', 'corrige'] as const) register(variant, async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await previews.open(source.bank, source.source, variant); });
  register('compileBoth', async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await compile(source); });
  register('output', () => runner.output.show(true));
  register('sync', () => previews.sync());
  register('reveal', reveal);
  register('toggleLibrary', () => library.toggle()); register('toggleSheets', () => sheets.toggle()); register('toggleContests', () => contests.toggle());
  register('addSelection', async (entry?: BrowserNode, selected?: BrowserNode[]) => {
    if (entry && !isFolder(entry) && entry.ex) selection.add((selected?.length ? selected : [entry]).flatMap(item => !isFolder(item) && item.ex ? [{ bank: item.bank, ex: item.ex }] : []));
    else {
      const picked = await vscode.window.showQuickPick(visible().map(entry => ({ label: entry.ex.titre, description: entry.bank.name, entry })), { title: 'Ajouter à la feuille', canPickMany: true });
      if (picked) selection.add(picked.map(item => item.entry));
    }
  });
  register('removeSelection', (entry: BankEntry) => selection.remove(entry)); register('moveUp', (entry: BankEntry) => selection.move(entry, -1)); register('moveDown', (entry: BankEntry) => selection.move(entry, 1)); register('clearSelection', () => selection.clear());
  register('newSheet', async () => { await discovery; const uri = await newSheet(selection); if (uri) await vscode.commands.executeCommand('exercicesMpi.enonce', uri); });
  register('newExercise', async () => { await discovery; const bank = await selectBank(banks); await runner.run(bank, ['catalogue']); await load(bank); const uri = await newExercise(bank, entries()); await runner.run(bank, ['catalogue']); await load(bank); await vscode.window.showTextDocument(uri); });
  context.subscriptions.push(runner, ...browsers, view, sheetView, contestView, previews, selection, currentFile,
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void discoverQueued().catch(report); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('exercicesMpi.bankPath')) void discoverQueued().catch(report); }),
    { dispose: () => { disposed = true; for (const watcher of watchers) watcher.dispose(); } });
  await discoverQueued();
  return {
    getEntries: () => entries().map(({ bank, ex }) => ({ bank: bank.root, ...ex })),
    search: (query: string, filters: Filters = {}) => entries().filter(({ ex }) => matches(ex, query, filters)).map(({ ex }) => ex),
    previewCount: () => previews.entries.size
  };
}
