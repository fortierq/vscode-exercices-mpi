import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { Exercise, Filters, Variant, duration, facets, labels, matches, parseCatalogue, pdfTarget, safeSource } from './core';
import { Bank, Runner } from './runner';
import { Previews, Preview } from './preview';
import { CurrentFile, reveal } from './outline';
import { newExercise, newSheet, Selection, selectBank } from './authoring';

interface Entry { bank: Bank; ex: Exercise }
interface Source { bank: Bank; source: string }

class Library implements vscode.TreeDataProvider<Entry>, vscode.Disposable {
  readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  entries: Entry[] = [];
  query = '';
  filters: Filters = {};
  get visible(): Entry[] { return this.entries.filter(({ ex }) => matches(ex, this.query, this.filters)); }
  getChildren(): Entry[] { return this.visible; }
  getTreeItem(entry: Entry): vscode.TreeItem {
    const { ex, bank } = entry;
    const item = new vscode.TreeItem(ex.titre);
    item.id = `${bank.root}/${ex.fichier}`;
    item.contextValue = 'exercice';
    item.description = [`${ex.difficulte}/5`, duration(ex), ex.langages.join(', ')].filter(Boolean).join(' · ');
    item.tooltip = [ex.titre, `Banque : ${bank.name}`, ex.fichier, `Chapitres : ${ex.chapitres.join(', ')}`, `Niveaux : ${ex.niveaux.join(', ')}`, `Algorithmes : ${ex.algorithmes.join(', ')}`, `Structures : ${ex.structures.join(', ')}`, ex.concours ? Object.values(ex.concours).filter(x => typeof x !== 'boolean').join(' ') : ''].filter(Boolean).join('\n');
    item.iconPath = new vscode.ThemeIcon('book');
    item.command = { command: 'exercicesMpi.source', title: 'Ouvrir la source', arguments: [entry] };
    return item;
  }
  dispose(): void { this.changed.dispose(); }
}

export async function activate(context: vscode.ExtensionContext) {
  const runner = new Runner();
  const library = new Library();
  const view = vscode.window.createTreeView('exercicesMpi.library', { treeDataProvider: library, showCollapseAll: false });
  const selection = new Selection();
  const selectionView = vscode.window.createTreeView('exercicesMpi.selection', { treeDataProvider: selection });
  const currentFile = new CurrentFile(context);
  let banks: Bank[] = [];
  let watchers: vscode.Disposable[] = [];
  let disposed = false;
  let discovery = Promise.resolve();
  const saved = context.workspaceState.get<{ query: string; filters: Filters }>('search');
  if (saved) { library.query = saved.query; library.filters = saved.filters; }

  const report = (error: unknown) => {
    if (disposed || error instanceof vscode.CancellationError) return;
    runner.output.appendLine(String(error));
    void vscode.window.showErrorMessage(String(error instanceof Error ? error.message : error), 'Voir le journal').then(choice => {
      if (choice) runner.output.show(true);
    });
  };
  const update = () => {
    library.entries.sort((a, b) => a.ex.titre.localeCompare(b.ex.titre, 'fr'));
    view.description = `${library.visible.length} / ${library.entries.length}`;
    view.message = [library.query && `Recherche : ${library.query}`, ...facets.filter(key => library.filters[key]).map(key => `${labels[key]} : ${library.filters[key]}`), library.filters.difficulteMax && `Difficulté ≤ ${library.filters.difficulteMax}`].filter(Boolean).join(' · ') || undefined;
    library.changed.fire();
    void context.workspaceState.update('search', { query: library.query, filters: library.filters });
  };

  async function load(bank: Bank): Promise<void> {
    const catalogue = path.join(bank.root, 'build/catalogue.json');
    const entries = parseCatalogue(await readFile(catalogue, 'utf8')).map(ex => ({ bank, ex }));
    library.entries = [...library.entries.filter(entry => entry.bank.root !== bank.root), ...entries];
    update();
  }

  async function discover(): Promise<void> {
    for (const watcher of watchers) watcher.dispose();
    watchers = [];
    banks = []; library.entries = [];
    const seen = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      const configured = vscode.workspace.getConfiguration('exercicesMpi', folder.uri).get<string>('bankPath', '');
      const candidate = path.resolve(folder.uri.fsPath, configured || '.');
      if (!['scripts/catalogue.py', 'templates/fiche.typ', 'lib/exercices.typ', 'Makefile'].every(file => existsSync(path.join(candidate, file)))) continue;
      const root = await realpath(candidate);
      if (seen.has(root)) continue;
      seen.add(root);
      const bank: Bank = { root, name: path.basename(root), scope: folder.uri };
      banks.push(bank);
      try {
        if (!existsSync(path.join(root, 'build/catalogue.json'))) await runner.run(bank, ['catalogue']);
        await load(bank);
      } catch (error) { report(error); }
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), 'build/catalogue.json'));
      let timer: NodeJS.Timeout | undefined;
      const reload = () => { clearTimeout(timer); timer = setTimeout(() => { void load(bank).catch(report); }, 200); };
      watcher.onDidChange(reload); watcher.onDidCreate(reload);
      watcher.onDidDelete(() => { library.entries = library.entries.filter(entry => entry.bank.root !== root); update(); });
      watchers.push(watcher, { dispose: () => clearTimeout(timer) });
      const sources = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), 'exercices/**/*.typ'));
      const stale = () => { view.message = 'Sources modifiées : régénérez le catalogue avec ↻ pour actualiser les métadonnées.'; };
      sources.onDidChange(stale); sources.onDidCreate(stale); sources.onDidDelete(stale);
      watchers.push(sources);
    }
    update();
    if (!banks.length) view.message = "Ouvrez une banque exercices-mpi, ou renseignez le réglage Exercices MPI : Bank Path.";
  }
  const discoverQueued = () => { discovery = discovery.catch(() => undefined).then(discover); return discovery; };

  async function checkSource(source: Source): Promise<Source> {
    safeSource(source.source);
    const file = await realpath(path.join(source.bank.root, source.source));
    if (!file.startsWith(source.bank.root + path.sep)) throw new Error('La source doit rester dans la banque.');
    return source;
  }

  async function chooseSource(argument?: Entry | vscode.Uri): Promise<Source | undefined> {
    await discovery;
    if (argument && 'ex' in argument) {
      const entry = library.entries.find(entry => entry.bank.root === argument.bank.root && entry.ex.fichier === argument.ex.fichier);
      if (!entry) throw new Error('Exercice absent du catalogue courant.');
      return checkSource({ bank: entry.bank, source: entry.ex.fichier });
    }
    const uri = argument instanceof vscode.Uri ? argument : vscode.window.activeTextEditor?.document.uri;
    if (uri?.scheme === 'file') {
      const file = await realpath(uri.fsPath);
      const bank = banks.filter(bank => file.startsWith(bank.root + path.sep)).sort((a, b) => b.root.length - a.root.length)[0];
      if (bank) {
        const source = path.relative(bank.root, file).split(path.sep).join('/');
        if (/^(exercices|feuilles|concours)\//.test(source)) return checkSource({ bank, source });
      }
      if (argument) throw new Error("Choisissez une source dans exercices/, feuilles/ ou concours/ d'une banque ouverte.");
    }
    const picked = await vscode.window.showQuickPick(library.visible.map(entry => ({ label: entry.ex.titre, description: `${entry.ex.difficulte}/5 · ${entry.bank.name}`, detail: entry.ex.fichier, entry })), { placeHolder: "Choisir un exercice (les filtres actifs s'appliquent)", matchOnDescription: true, matchOnDetail: true });
    return picked ? checkSource({ bank: picked.entry.bank, source: picked.entry.ex.fichier }) : undefined;
  }

  async function compile(source: Source): Promise<void> {
    await checkSource(source);
    const dirty = vscode.workspace.textDocuments.filter(document => document.isDirty && document.uri.scheme === 'file' && document.uri.fsPath.startsWith(source.bank.root + path.sep));
    if (dirty.length) throw new Error("Enregistrez les fichiers modifiés de la banque avant de compiler, afin que le PDF corresponde aux sources affichées.");
    await runner.stopWatch(source.bank, source.source);
    await runner.run(source.bank, ['c', source.source]);
  }
  async function recompile(preview: Preview): Promise<void> {
    await compile(preview); await preview.refresh();
    if ([...previews.entries.values()].includes(preview)) await runner.watch(preview.bank, preview.source, preview.variant, state => preview.state(state));
  }
  const previews = new Previews(context, recompile, preview => { void runner.stopWatch(preview.bank, preview.source); });

  const register = (name: string, action: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(`exercicesMpi.${name}`, async (...args: unknown[]) => {
      try { return await action(...args); } catch (error) { if (error instanceof vscode.CancellationError) return; report(error); throw error; }
    }));
  };
  register('search', async () => {
    const query = await vscode.window.showInputBox({ title: 'Rechercher des exercices', prompt: 'Titre, identifiant ou métadonnées ; plusieurs mots possibles, accents ignorés.', value: library.query });
    if (query !== undefined) { library.query = query; update(); await vscode.commands.executeCommand('exercicesMpi.library.focus'); }
  });
  register('filters', async () => {
    const options = [...facets.map(key => ({ label: labels[key], description: library.filters[key] ?? 'Tous', key })), { label: 'Difficulté maximale', description: String(library.filters.difficulteMax ?? 'Toutes'), key: 'difficulteMax' as const }];
    const chosen = await vscode.window.showQuickPick(options, { title: 'Filtrer les exercices', placeHolder: 'Les filtres se cumulent ; utilisez Effacer pour tout réinitialiser.' });
    if (!chosen) return;
    const key = chosen.key;
    const values = key === 'difficulteMax' ? ['1', '2', '3', '4', '5'] : [...new Set(library.entries.flatMap(({ ex }) => key === 'concours' ? ex.concours?.nom ? [ex.concours.nom] : [] : ex[key]))].sort((a, b) => a.localeCompare(b, 'fr'));
    const value = await vscode.window.showQuickPick([{ label: 'Tous / toutes', value: '' }, ...values.map(value => ({ label: value, value }))], { title: chosen.label });
    if (!value) return;
    if (!value.value) delete library.filters[key];
    else if (key === 'difficulteMax') library.filters.difficulteMax = +value.value;
    else library.filters[key] = value.value;
    update();
  });
  register('reset', () => { library.query = ''; library.filters = {}; update(); });
  register('refresh', async () => {
    await discovery;
    if (!banks.length) await discoverQueued();
    for (const bank of banks) { await runner.run(bank, ['catalogue']); await load(bank); }
  });
  register('source', async (argument?: Entry | vscode.Uri) => {
    const source = await chooseSource(argument);
    if (source) await vscode.window.showTextDocument(vscode.Uri.file(path.join(source.bank.root, source.source)));
  });
  for (const variant of ['enonce', 'corrige'] as const) register(variant, async (argument?: Entry | vscode.Uri) => {
    const source = await chooseSource(argument);
    if (source) {
      await compile(source);
      const preview = await previews.open(source.bank, source.source, variant);
      await runner.watch(source.bank, source.source, variant, state => preview.state(state));
    }
  });
  register('compileBoth', async (argument?: Entry | vscode.Uri) => {
    const source = await chooseSource(argument);
    if (source) {
      await compile(source);
      const preview = [...previews.entries.values()].find(item => item.bank.root === source.bank.root && item.source === source.source);
      if (preview) await runner.watch(preview.bank, preview.source, preview.variant, state => preview.state(state));
    }
  });
  register('output', () => runner.output.show(true));
  register('reveal', reveal);
  register('addSelection', async (entry?: Entry) => {
    if (entry?.ex) selection.add([entry]);
    else {
      const picked = await vscode.window.showQuickPick(library.visible.map(entry => ({ label: entry.ex.titre, description: entry.bank.name, entry })), { title: 'Ajouter des exercices à la sélection', canPickMany: true });
      if (picked) selection.add(picked.map(item => item.entry));
    }
  });
  register('removeSelection', (entry: Entry) => selection.remove(entry));
  register('moveUp', (entry: Entry) => selection.move(entry, -1));
  register('moveDown', (entry: Entry) => selection.move(entry, 1));
  register('clearSelection', () => selection.clear());
  register('newSheet', async () => { await discovery; const uri = await newSheet(selection, library.visible); if (uri) await vscode.commands.executeCommand('exercicesMpi.enonce', uri); });
  register('newExercise', async () => {
    await discovery;
    const bank = await selectBank(banks);
    // Refresh before checking duplicate titles and identifiers.
    await runner.run(bank, ['catalogue']); await load(bank);
    const uri = await newExercise(bank, library.entries);
    await runner.run(bank, ['catalogue']); await load(bank);
    await vscode.window.showTextDocument(uri);
  });
  context.subscriptions.push(runner, library, view, previews, selection, selectionView, currentFile,
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void discoverQueued().catch(report); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('exercicesMpi.bankPath')) void discoverQueued().catch(report);
      if (event.affectsConfiguration('exercicesMpi.autoCompile') || event.affectsConfiguration('exercicesMpi.execution') || event.affectsConfiguration('exercicesMpi.typstPath')) {
        for (const preview of previews.entries.values()) void runner.watch(preview.bank, preview.source, preview.variant, state => preview.state(state)).catch(report);
      }
    }),
    { dispose: () => { disposed = true; for (const watcher of watchers) watcher.dispose(); } }
  );
  await discoverQueued();
  return {
    getEntries: () => library.entries.map(({ bank, ex }) => ({ bank: bank.root, ...ex })),
    search: (query: string, filters: Filters = {}) => library.entries.filter(({ ex }) => matches(ex, query, filters)).map(({ ex }) => ex),
    previewCount: () => previews.entries.size
  };
}
