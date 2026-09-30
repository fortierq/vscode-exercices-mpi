import * as vscode from 'vscode';
import * as path from 'node:path';
import { stat, mkdtemp, mkdir, writeFile, rm, cp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { Exercise } from '../src/core';
import { Previews, Preview } from '../src/preview';
import { Runner } from '../src/runner';
import { exerciseFromTemplate, sheetFromTemplate, outline } from '../src/typst';
import { sourceFromText } from '../src/outline';

// A minimal blank PDF fixture, independent of the bank's generated documents.
function blankPdf(pages: number): Buffer {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pages} >>`, ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << >> >>')];
  let data = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(data.length); data += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = data.length;
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(data + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

function rendered(preview: Preview, pages: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listener.dispose(); reject(new Error(`Le lecteur PDF ne répond pas après 20 s (${pages} pages attendues).`)); }, 20_000);
    const listener = preview.panel.webview.onDidReceiveMessage(message => {
      if (message.type === 'renderError' || (message.type === 'rendered' && message.pages === pages)) {
        clearTimeout(timer); listener.dispose();
        if (message.type === 'renderError') reject(new Error(message.message)); else resolve();
      }
    });
  });
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('qfortier.vscode-exercices-mpi');
  assert.ok(extension, 'Extension chargée');
  const api = await extension.activate();
  assert.ok(api.getEntries().length > 0, 'Banque détectée et catalogue chargé');
  const results: Exercise[] = api.search('monoides', { concours: 'ENS' });
  assert.ok(results.some(ex => ex.fichier.endsWith('/automates-monoides.typ')), 'Recherche réelle avec accents et filtre');
  await vscode.commands.executeCommand('exercicesMpi.refresh');
  assert.ok(api.getEntries().length > 0, 'Catalogue régénéré');
  const bank = process.env.EXERCICES_MPI_BANK!;
  const source = vscode.Uri.file(path.join(bank, 'exercices/langages/mots-qui-commutent.typ'));
  await vscode.commands.executeCommand('exercicesMpi.source', source);
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, source.fsPath);
  await vscode.commands.executeCommand('exercicesMpi.compileBoth', source);
  for (const variant of ['enonce', 'corrige']) {
    const pdf = await stat(path.join(bank, 'build/exercices/langages/mots-qui-commutent', `${variant}.pdf`));
    assert.ok(pdf.size > 1000, `PDF ${variant} produit`);
  }
  await vscode.commands.executeCommand('exercicesMpi.reset');
  // Generated bank PDFs are intentionally not opened or inspected by this test.
  // Exercise the real webview and bundled worker only against blank PDF fixtures.
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'exercices-mpi-preview-')));
  const previewBank = { root: temporary, name: 'Test isolé', scope: vscode.Uri.file(temporary) };
  const previews = new Previews({ extensionUri: extension.extensionUri } as vscode.ExtensionContext, async () => undefined);
  try {
    const output = path.join(temporary, 'build/exercices/test/viewer/enonce.pdf');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, blankPdf(1));
    await previews.open(previewBank, 'exercices/test/viewer.typ', 'enonce');
    const preview = [...previews.entries.values()][0];
    await rendered(preview, 1);
    const reloaded = rendered(preview, 2);
    await writeFile(output, blankPdf(2));
    await reloaded;
    preview.panel.dispose();
    assert.equal(previews.entries.size, 0, 'Aperçu fermé et ressources libérées');
    const runner = new Runner();
    try {
      for (const file of ['lib', 'templates', 'Makefile', 'flake.nix', 'flake.lock']) await cp(path.join(bank, file), path.join(temporary, file), { recursive: true });
      for (const directory of ['exercices/graphes', 'feuilles', 'concours']) await mkdir(path.join(temporary, directory), { recursive: true });
      const generated = exerciseFromTemplate(await readFile(path.join(bank, 'templates/exercice.typ'), 'utf8'), {
        title: 'Test création', chapters: ['graphes'], algorithms: [], structures: [], languages: [], levels: ['MPI'], difficulty: 2, minutes: 20
      });
      const relative = 'exercices/graphes/test-creation.typ';
      await writeFile(path.join(temporary, relative), generated);
      await runner.run(previewBank, ['c', relative]);
      assert.equal(outline(generated).filter(item => item.kind === 'question').length, 1);
      const sheet = sheetFromTemplate(await readFile(path.join(bank, 'templates/feuille.typ'), 'utf8'), 'Feuille de test', [relative]);
      await writeFile(path.join(temporary, 'feuilles/test-creation.typ'), sheet);
      await runner.run(previewBank, ['c', 'feuilles/test-creation.typ']);
      const pdfFile = path.join(temporary, 'build/exercices/graphes/test-creation/enonce.pdf');
      const waitForUpdate = async (before: number) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          if ((await stat(pdfFile)).mtimeMs > before) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Le watch ne met pas le PDF à jour.');
      };
      let timestamp = (await stat(pdfFile)).mtimeMs;
      await runner.watch(previewBank, relative, 'enonce', () => {});
      await waitForUpdate(timestamp);
      timestamp = (await stat(pdfFile)).mtimeMs;
      await writeFile(path.join(temporary, relative), generated.replace('Énoncé à compléter.', 'Un passage modifié pour vérifier la surveillance.'));
      await waitForUpdate(timestamp);
      await runner.stopWatch(previewBank, relative);
      await sourceFromText(previewBank, relative, 'Un passage modifié pour vérifier la surveillance.');
      const editor = vscode.window.activeTextEditor;
      assert.ok(editor?.document.lineAt(editor.selection.active.line).text.includes('Un passage modifié'));
      console.log('Création exercice/feuille, compilation des modèles, watch et navigation vers la source : réussis.');
    } finally { runner.dispose(); }
  } finally { previews.dispose(); await rm(temporary, { recursive: true, force: true }); }
  console.log('Intégration complète réussie. Aucun PDF de la banque inspecté.');
}
