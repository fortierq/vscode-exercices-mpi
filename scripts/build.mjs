import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('dist/pdfjs', { recursive: true });
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) await copyFile(`node_modules/pdfjs-dist/build/${file}`, `dist/pdfjs/${file}`);
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await cp(`node_modules/pdfjs-dist/${dir}`, `dist/pdfjs/${dir}`, { recursive: true });
await copyFile('node_modules/pdfjs-dist/LICENSE', 'dist/pdfjs/LICENSE');
await mkdir('releases', { recursive: true });
await build({ entryPoints: { extension: 'src/extension.ts', 'core.test': 'test/core.test.ts', integration: 'test/integration.ts' }, bundle: true, platform: 'node', format: 'cjs', target: 'node20', outdir: 'dist', external: ['vscode'] });
await copyFile('node_modules/vscode-jsonrpc/License.txt', 'dist/LICENSE-vscode-jsonrpc.txt');
