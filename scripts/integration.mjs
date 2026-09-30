import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
const root = path.resolve(import.meta.dirname, '..');
const bank = process.env.EXERCICES_MPI_BANK ?? path.resolve(root, '../exercices-mpi');
const userData = path.join(root, '.vscode-test', 'user-data');
await mkdir(userData, { recursive: true });
const extensions = path.join(homedir(), '.vscode/extensions');
const tinymist = process.env.TINYMIST_PATH ?? path.join(extensions, (await readdir(extensions)).filter(name => name.startsWith('myriad-dreamin.tinymist-')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? 'missing');
await runTests({
  extensionDevelopmentPath: [root, tinymist],
  extensionTestsPath: path.join(root, 'dist/integration.js'),
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
  launchArgs: [bank, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir', userData],
  extensionTestsEnv: { EXERCICES_MPI_BANK: bank, PREVIEW_REVIEW: process.env.PREVIEW_REVIEW ?? '' }
});
