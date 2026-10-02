import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { Filters, facets, labels, matches, parseCatalogue, pdfTarget, pdfFilename, safeSource } from './core';
import { Bank, Runner } from './runner';
import { Previews } from './preview';
import { CurrentFile, reveal } from './outline';
import { BankEntry, newExercise, newSheet, newContest, selectBank } from './authoring';
import { Browser, BrowserNode, Source } from './browser';
import { isFolder } from './tree';
import { Sheets, SheetMember } from './sheets';
import { sourceMetadata } from './sheet-model';
import { directories, newFolder, moveSource, deleteSource, Location } from './files';
import { Drag } from './drag';

export async function activate(context: vscode.ExtensionContext) {
  const runner = new Runner();
  const library = new Browser('exercices', context.workspaceState);
  const sheets = new Browser('feuilles', context.workspaceState);
  const contests = new Browser('concours', context.workspaceState);
  const browsers = [library, sheets, contests];
  const drag = <T>(category: string) => new Drag<T>(category, () => sheetEditor, relocate, error => report(error));
  const view = vscode.window.createTreeView('exercicesMpi.library', { treeDataProvider: library, showCollapseAll: false, canSelectMany: true, dragAndDropController: drag<BrowserNode>('exercices') });
  const sheetView = vscode.window.createTreeView('exercicesMpi.sheets', { treeDataProvider: sheets, showCollapseAll: false, dragAndDropController: drag<BrowserNode>('feuilles') });
  const contestView = vscode.window.createTreeView('exercicesMpi.contests', { treeDataProvider: contests, showCollapseAll: false, dragAndDropController: drag<BrowserNode>('concours') });
  let banks: Bank[] = [];
  let watchers: vscode.Disposable[] = [];
  let disposed = false;
  let discovery = Promise.resolve();
  const saved = context.workspaceState.get<{ query: string; filters: Filters }>('search');
  if (saved) { library.query = saved.query; library.filters = saved.filters; }
  const entries = (): BankEntry[] => library.entries.flatMap(item => item.ex ? [{ bank: item.bank, ex: item.ex }] : []);
  const sheetEditor = new Sheets(() => banks, entries);
  const currentFile = new CurrentFile(context, sheetEditor, drag('feuilles'));
  context.subscriptions.push(sheetView.onDidChangeSelection(event => {
    const node = event.selection[0];
    if (node && !isFolder(node)) {
      const source = 'sheet' in node ? node.sheet : node.source;
      if (source.startsWith('feuilles/')) sheetEditor.selected = { bank: node.bank, source };
    }
  }));
  const report = (error: unknown) => {
    if (disposed || error instanceof vscode.CancellationError) return;
    runner.output.appendLine(String(error));
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error), 'Voir le journal').then(choice => { if (choice) runner.output.show(true); });
  };
  const update = () => {
    for (const [index, browser] of browsers.entries()) {
      const treeView = [view, sheetView, contestView][index];
      treeView.description = `${browser.visible.length} / ${browser.entries.length}`;
      treeView.message = [browser.query && `Recherche : ${browser.query}`, ...facets.filter(key => browser.filters[key]).map(key => `${labels[key]} : ${browser.filters[key]}`), browser.filters.difficulteMax && `Difficulté ≤ ${browser.filters.difficulteMax}`].filter(Boolean).join(' · ') || undefined;
      browser.changed.fire();
      void vscode.commands.executeCommand('setContext', `exercicesMpi.searchActive.${['library', 'sheets', 'contests'][index]}`, browser.searching);
      void context.workspaceState.update(browser === library ? 'search' : `search.${browser.category}`, { query: browser.query, filters: browser.filters });
    }
  };
  for (const browser of [sheets, contests]) {
    const saved = context.workspaceState.get<{ query: string; filters: Filters }>(`search.${browser.category}`);
    if (saved) { browser.query = saved.query; browser.filters = saved.filters; }
  }
  async function scan(bank: Bank, browser: Browser): Promise<void> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(bank.root), `${browser.category}/**/*.typ`), null);
    const metadata = new Map(entries().filter(entry => entry.bank.root === bank.root).map(entry => [entry.ex.fichier, entry.ex]));
    const sources: Source[] = await Promise.all(files.map(async uri => {
      const source = path.relative(bank.root, uri.fsPath).split(path.sep).join('/');
      const item: Source = { bank, source, ex: metadata.get(source) };
      if (browser === library && !item.ex) item.ex = sourceMetadata((await vscode.workspace.openTextDocument(uri)).getText(), source);
      if (browser !== library) {
        item.metadata = [sourceMetadata((await vscode.workspace.openTextDocument(uri)).getText(), source)];
        if (browser === sheets) {
          try { item.members = await sheetEditor.members(bank, source); item.metadata.push(...item.members.flatMap(member => metadata.get(member.source) ?? [])); }
          catch (error) { item.compositionError = String(error); }
        }
      }
      return item;
    }));
    browser.directories = [...browser.directories.filter(item => item.bank.root !== bank.root), ...await directories(bank, browser.category)];
    browser.entries = [...browser.entries.filter(entry => entry.bank.root !== bank.root), ...sources];
    update();
  }
  async function load(bank: Bank): Promise<void> {
    const catalogue = parseCatalogue(await readFile(path.join(bank.root, 'build/catalogue.json'), 'utf8'));
    const metadata = new Map(catalogue.map(ex => [ex.fichier, ex]));
    await scan(bank, library);
    for (const item of library.entries) if (item.bank.root === bank.root) item.ex = metadata.get(item.source) ?? item.ex;
    update();
  }
  async function discover(): Promise<void> {
    for (const watcher of watchers) watcher.dispose(); watchers = [];
    banks = []; for (const browser of browsers) { browser.entries = []; browser.directories = []; }
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
        else files.onDidChange(rescan);
        watchers.push(files);
      }
    }
    for (const browser of browsers) browser.changed.fire();
    update();
    sheetEditor.remember();
    sheetEditor.changed.fire();
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
      return checkSource(argument);
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
    const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(preview.bank.root, pdfFilename(preview.source, variant))), filters: { PDF: ['pdf'] } });
    if (!destination) return;
    const target = pdfTarget(preview.source, variant);
    await compile(preview, [target]);
    const from = vscode.Uri.file(path.join(preview.bank.root, target));
    if (from.toString() !== destination.toString()) await vscode.workspace.fs.copy(from, destination, { overwrite: true });
  });
  const register = (name: string, action: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(`exercicesMpi.${name}`, async (...args: unknown[]) => {
      try { return await action(...args); } catch (error) { if (error instanceof vscode.CancellationError) return; report(error); throw error; }
    }));
  };
  async function relocate(source: Location, destination: string): Promise<void> {
    await checkSource(source);
    await moveSource(source, destination);
    previews.entries.get(`${source.bank.root}/${source.source}`)?.panel.dispose();
    for (const key of ['current', 'selected'] as const) if (sheetEditor[key]?.bank.root === source.bank.root && sheetEditor[key]?.source === source.source) sheetEditor[key] = { bank: source.bank, source: destination };
    for (const browser of browsers) await scan(source.bank, browser);
  }
  for (const [index, browser] of browsers.entries()) {
  const suffix = ['', 'Sheets', 'Contests'][index];
  register('search' + suffix, async () => {
    const query = await vscode.window.showInputBox({ title: `Rechercher : ${browser.category}`, prompt: 'Titre, fichier ou métadonnées ; accents ignorés.', value: browser.query });
    if (query !== undefined) { browser.query = query.trim(); update(); await vscode.commands.executeCommand(`exercicesMpi.${['library', 'sheets', 'contests'][index]}.focus`); }
  });
  register('filters' + suffix, async () => {
    const options = [...facets.map(key => ({ label: labels[key], description: browser.filters[key] ?? 'Tous', key })), { label: 'Difficulté maximale', description: String(browser.filters.difficulteMax ?? 'Toutes'), key: 'difficulteMax' as const }];
    const chosen = await vscode.window.showQuickPick(options, { title: 'Filtrer les exercices' }); if (!chosen) return;
    const key = chosen.key;
    const metadata = browser.entries.flatMap(item => item.ex ? [item.ex] : item.metadata ?? []);
    const values = key === 'difficulteMax' ? ['1', '2', '3', '4', '5'] : [...new Set(metadata.flatMap(ex => key === 'concours' ? ex.concours?.nom ? [ex.concours.nom] : [] : ex[key]))].sort((a, b) => a.localeCompare(b, 'fr'));
    const value = await vscode.window.showQuickPick([{ label: 'Tous / toutes', value: '' }, ...values.map(value => ({ label: value, value }))], { title: chosen.label }); if (!value) return;
    if (!value.value) delete browser.filters[key]; else if (key === 'difficulteMax') browser.filters.difficulteMax = +value.value; else browser.filters[key] = value.value;
    update();
    await vscode.commands.executeCommand(`exercicesMpi.${['library', 'sheets', 'contests'][index]}.focus`);
  });
  register('reset' + suffix, () => { browser.query = ''; browser.filters = {}; update(); });
  }
  register('openPanel', () => vscode.commands.executeCommand('workbench.view.extension.exercicesMpi'));
  for (const section of ['current', 'library', 'sheets', 'contests']) register('collapse' + section, async () => {
    await vscode.commands.executeCommand(`exercicesMpi.${section}.focus`);
    await vscode.commands.executeCommand(`workbench.actions.treeView.exercicesMpi.${section}.collapseAll`);
  });
  async function revealSheet(source: Source): Promise<void> {
    sheets.query = ''; sheets.filters = {}; update();
    sheetEditor.selected = source;
    await sheetView.reveal(source, { select: true, expand: true });
  }
  register('refresh', async () => { await discovery; if (!banks.length) await discoverQueued(); for (const bank of banks) { await runner.run(bank, ['catalogue']); await load(bank); await scan(bank, sheets); await scan(bank, contests); } });
  register('source', async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await vscode.window.showTextDocument(vscode.Uri.file(path.join(source.bank.root, source.source))); });
  for (const variant of ['enonce', 'corrige'] as const) register(variant, async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await previews.open(source.bank, source.source, variant); });
  register('compileBoth', async (argument?: BrowserNode | vscode.Uri) => { const source = await chooseSource(argument); if (source) await compile(source); });
  register('output', () => runner.output.show(true));
  register('sync', () => previews.sync());
  register('reveal', reveal);
  register('toggleLibrary', () => library.toggle()); register('toggleSheets', () => sheets.toggle()); register('toggleContests', () => contests.toggle());
  register('newSheet', async (argument?: Location) => { await discovery; const bank = argument?.bank ?? await selectBank(banks); const uri = await newSheet(bank, argument?.bank ? argument.source : undefined); await scan(bank, sheets); const source = sheets.entries.find(item => path.join(bank.root, item.source) === uri.fsPath); if (source) { await revealSheet(source); } });
  register('newContest', async (argument?: Location) => { await discovery; const bank = argument?.bank ?? await selectBank(banks); const uri = await newContest(bank, argument?.bank ? argument.source : undefined); await scan(bank, contests); await vscode.window.showTextDocument(uri); });
  register('newExercise', async (argument?: Location) => { await discovery; const bank = argument?.bank ?? await selectBank(banks); await runner.run(bank, ['catalogue']); await load(bank); const uri = await newExercise(bank, entries(), argument?.source?.startsWith('exercices') ? argument.source : undefined); await runner.run(bank, ['catalogue']); await load(bank); await vscode.window.showTextDocument(uri); });
  for (const [name, direction] of [['memberUp', -1], ['memberDown', 1], ['memberRemove', undefined]] as const) register(name, async (argument: SheetMember | { member: SheetMember }) => { await sheetEditor.change('member' in argument ? argument.member : argument, direction); });
  register('addCurrent', async (argument?: BrowserNode) => {
    const source = await chooseSource(argument); if (!source) return;
    if (!source.source.startsWith('exercices/')) throw new Error('Choisissez un exercice à ajouter.');
    let sheet = sheetEditor.target;
    if (!sheet || sheet.bank.root !== source.bank.root) {
      const picked = await vscode.window.showQuickPick(sheets.entries.filter(item => item.bank.root === source.bank.root).map(item => ({ label: item.metadata?.[0]?.titre ?? item.source, description: item.source, item })), { title: 'Choisir la feuille en cours' });
      if (!picked) return; sheet = picked.item; sheetEditor.selected = sheet;
    }
    await sheetEditor.add(source.bank, source.source, sheet.source);
    void vscode.window.showInformationMessage(`Ajouté à ${sheet.source}. Feuille enregistrée.`);
  });
  for (const [suffix, browser] of [['Library', library], ['Sheets', sheets], ['Contests', contests]] as const) register('newFolder' + suffix, async (argument?: Location) => {
    await discovery;
    const location = argument?.bank ? argument : { bank: await selectBank(banks), source: browser.category };
    await newFolder(location); await scan(location.bank, browser);
  });
  register('deleteSource', async (argument: BrowserNode) => {
    const source = await chooseSource(argument); if (!source || !await deleteSource(source)) return;
    previews.entries.get(`${source.bank.root}/${source.source}`)?.panel.dispose();
    if (sheetEditor.current?.bank.root === source.bank.root && sheetEditor.current.source === source.source) sheetEditor.current = undefined;
    if (sheetEditor.selected?.bank.root === source.bank.root && sheetEditor.selected.source === source.source) sheetEditor.selected = undefined;
    for (const browser of browsers) await scan(source.bank, browser);
  });
  let sheetTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(sheetEditor.changed.event(() => { clearTimeout(sheetTimer); sheetTimer = setTimeout(() => { for (const bank of banks) void scan(bank, sheets).catch(report); }, 120); }), { dispose: () => clearTimeout(sheetTimer) });
  context.subscriptions.push(runner, ...browsers, view, sheetView, contestView, previews, currentFile, sheetEditor,
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void discoverQueued().catch(report); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('exercicesMpi.bankPath')) void discoverQueued().catch(report); }),
    { dispose: () => { disposed = true; for (const watcher of watchers) watcher.dispose(); } });
  await discoverQueued();
  return {
    getEntries: () => entries().map(({ bank, ex }) => ({ bank: bank.root, ...ex })),
    search: (query: string, filters: Filters = {}) => entries().filter(({ ex }) => matches(ex, query, filters)).map(({ ex }) => ex),
    previewCount: () => previews.entries.size,
    revealSheet: async (source: string) => { const item = sheets.entries.find(item => item.source === source); if (!item) throw new Error('Feuille introuvable'); await revealSheet(item); return sheetView.selection[0]; }
  };
}
