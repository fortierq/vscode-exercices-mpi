import * as vscode from 'vscode';
import * as path from 'node:path';
import { stat, mkdtemp, mkdir, writeFile, rm, cp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { Exercise } from '../src/core';
import { Previews } from '../src/preview';
import { Runner } from '../src/runner';
import { Selection } from '../src/authoring';
import { exerciseFromTemplate, sheetFromTemplate } from '../src/typst';
import { forward } from '../src/tinymist';
import { Browser } from '../src/browser';
import { isFolder } from '../src/tree';

async function until(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('qfortier.vscode-exercices-mpi');
  assert.ok(extension, 'Extension chargée');
  const api = await extension.activate();
  assert.ok(api.getEntries().length > 0, 'Banque détectée');
  const results: Exercise[] = api.search('monoides', { concours: 'ENS' });
  assert.ok(results.some(ex => ex.fichier.endsWith('/automates-monoides.typ')));
  const bank = process.env.EXERCICES_MPI_BANK!;
  // No generated bank PDF is opened or inspected.
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'exercices-mpi-preview-')));
  const previewBank = { root: temporary, name: 'Test isolé', scope: vscode.Uri.file(temporary) };
  const previews = new Previews({ extensionUri: extension.extensionUri } as vscode.ExtensionContext, async () => undefined);
  const runner = new Runner();
  const selection = new Selection();
  const sockets: WebSocket[] = [];
  try {
    for (const file of ['lib', 'templates', 'Makefile', 'flake.nix', 'flake.lock']) await cp(path.join(bank, file), path.join(temporary, file), { recursive: true });
    for (const directory of ['exercices/graphes', 'feuilles', 'concours']) await mkdir(path.join(temporary, directory), { recursive: true });
    const relative = 'exercices/graphes/test-creation.typ';
    const generated = exerciseFromTemplate(await readFile(path.join(bank, 'templates/exercice.typ'), 'utf8'), {
      title: 'Test création', chapters: ['graphes'], algorithms: [], structures: [], languages: [], levels: ['MPI'], difficulty: 2, minutes: 20
    }).replace('Énoncé à compléter.', '#heading(level: 2)[Repère du test]\n      Un texte unique avec une formule $x^2 + y^2 = z^2$.').replace('solution: none', 'solution: [#heading(level: 2)[Repère du corrigé] Une correction.]');
    const file = path.join(temporary, relative);
    await writeFile(file, generated);
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.One });
    const before = Date.now();
    const preview = await previews.open(previewBank, relative, 'enonce');
    console.log('Démarrage aperçu (ms)', Date.now() - before);
    let frames = 0;
    const listener = preview.panel.webview.onDidReceiveMessage(message => { if (message.type === 'frameReady') frames++; });
    await until(() => frames > 0, "L'iframe Tinymist ne se charge pas");
    const enonce = preview.sessions.get('enonce')!;
    let documentOutline: any;
    enonce.connection.onNotification('tinymist/documentOutline', outline => { documentOutline = outline; });
    const socket = new WebSocket(`ws://127.0.0.1:${enonce.port}`);
    sockets.push(socket);
    const messages: Buffer[] = [];
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', event => { const data = typeof event.data === 'string' ? Buffer.from(event.data) : Buffer.from(event.data as ArrayBuffer); messages.push(data); });
    await until(() => socket.readyState === WebSocket.OPEN, 'Connexion au rendu Tinymist');
    socket.send('current');
    await until(() => messages.some(data => /^(new|diff-v1),/.test(data.toString())), 'Rendu vectoriel initial');
    const dark = [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind);
    assert.ok(messages.some(data => data.toString().includes(`"rest":"${dark ? 'always' : 'never'}"`)), 'Thème de rendu correct');
    const count = messages.length;
    const edit = new vscode.WorkspaceEdit();
    const line = generated.split('\n').findIndex(text => text.includes('Un texte unique'));
    edit.insert(editor.document.uri, new vscode.Position(line, 7), 'MODIFICATION ');
    await vscode.workspace.applyEdit(edit);
    await until(() => messages.slice(count).some(data => /^(new|diff-v1),/.test(data.toString())), 'Mise à jour sans enregistrer');
    const startJump = messages.length;
    editor.selection = new vscode.Selection(line, 20, line, 20);
    await forward(enonce, editor);
    await until(() => messages.slice(startJump).some(data => data.toString().startsWith('jump,')), 'Saut source vers aperçu');
    await until(() => !!documentOutline?.items?.length, 'Plan exact produit par Tinymist');
    assert.ok(!JSON.stringify(documentOutline).includes('Repère du corrigé'), 'Énoncé sans solution');
    const headingLine = generated.split('\n').findIndex(text => text.includes('Repère du test'));
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await enonce.connection.sendRequest('workspace/executeCommand', { command: 'tinymist.scrollPreview', arguments: [enonce.id, { event: 'sourceScrollBySpan', span: documentOutline.items[0].span }] });
    await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file && vscode.window.activeTextEditor.selection.start.line === headingLine, 'Saut inverse vers la position source exacte');
    await preview.select('corrige');
    let correctedOutline: any;
    preview.sessions.get('corrige')!.connection.onNotification('tinymist/documentOutline', outline => { correctedOutline = outline; });
    const secondEdit = new vscode.WorkspaceEdit();
    secondEdit.insert(editor.document.uri, new vscode.Position(line, 7), 'SUITE ');
    await vscode.workspace.applyEdit(secondEdit);
    await until(() => JSON.stringify(correctedOutline)?.includes('Repère du corrigé') ?? false, 'Le corrigé affiche réellement les solutions');
    assert.equal(preview.sessions.size, 2);
    const switchStart = Date.now();
    await preview.select('enonce');
    assert.equal(preview.sessions.get('enonce'), enonce, 'La bascule réutilise le compilateur');
    console.log('Bascule chaude (ms)', Date.now() - switchStart);
    await assert.rejects(stat(path.join(temporary, 'build')), 'Aucun make/PDF pour afficher ou basculer');
    await editor.document.save();
    await runner.run(previewBank, ['c', relative]);
    for (const variant of ['enonce', 'corrige']) assert.ok((await stat(path.join(temporary, 'build/exercices/graphes/test-creation', `${variant}.pdf`))).size > 1000);
    const entries = results.slice(0, 1).map(ex => ({ bank: previewBank, ex }));
    const state = { get: (_key: string, fallback: unknown) => fallback, update: async () => undefined } as unknown as vscode.Memento;
    const browser = new Browser('exercices', selection, state);
    browser.entries = entries.map(item => ({ ...item, source: item.ex.fichier }));
    selection.add(entries);
    assert.ok(selection.has({ ...entries[0], ex: { ...entries[0].ex } }), 'Sélection stable après rechargement catalogue');
    selection.add(entries);
    assert.equal(selection.entries.length, 1);
    assert.equal(browser.getTreeItem(browser.entries[0]).checkboxState, vscode.TreeItemCheckboxState.Checked);
    browser.query = 'absent'; assert.equal(browser.visible.length, 0); assert.equal(selection.entries.length, 1);
    browser.query = ''; assert.ok(isFolder(browser.getChildren()[0]));
    browser.toggle(); assert.ok(!isFolder(browser.getChildren()[0]));
    assert.throws(() => selection.add([{ ...entries[0], bank: { ...previewBank, root: '/other' } }]));
    selection.remove({ ...entries[0], ex: { ...entries[0].ex } });
    assert.equal(selection.entries.length, 0);
    assert.equal(browser.getTreeItem(browser.entries[0]).checkboxState, vscode.TreeItemCheckboxState.Unchecked);
    browser.dispose();
    const sheet = sheetFromTemplate(await readFile(path.join(bank, 'templates/feuille.typ'), 'utf8'), 'Feuille de test', [relative]);
    await writeFile(path.join(temporary, 'feuilles/test-creation.typ'), sheet);
    await runner.run(previewBank, ['c', 'feuilles/test-creation.typ']);
    listener.dispose();
    if (process.env.PREVIEW_REVIEW) { console.log('Aperçu temporaire', enonce.url); await new Promise(resolve => setTimeout(resolve, 55_000)); }
    preview.panel.dispose();
    assert.equal(previews.entries.size, 0);
  } finally {
    for (const socket of sockets) socket.close();
    previews.dispose(); runner.dispose(); selection.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
  console.log('Intégration complète réussie. Aucun PDF de la banque inspecté.');
}
