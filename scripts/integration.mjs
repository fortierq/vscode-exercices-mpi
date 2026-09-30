import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
const bank = process.env.EXERCICES_MPI_BANK ?? path.resolve(root, '../exercices-mpi');
const userData = path.join(root, '.vscode-test', 'user-data');
await mkdir(userData, { recursive: true });
await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'dist/integration.js'),
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
  launchArgs: [bank, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir', userData],
  extensionTestsEnv: { EXERCICES_MPI_BANK: bank }
});
