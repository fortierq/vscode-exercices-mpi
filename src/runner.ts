import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import { existsSync } from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import { executionCommand, parseDiagnostics } from './core';

export interface Bank { root: string; name: string; scope: vscode.Uri }

export class Runner implements vscode.Disposable {
  private queues = new Map<string, Promise<unknown>>();
  private children = new Set<ChildProcess>();
  private disposed = false;
  readonly output = vscode.window.createOutputChannel('Exercices Typst');
  readonly diagnostics = vscode.languages.createDiagnosticCollection('exercices-mpi');

  run(bank: Bank, targets: string[]): Promise<void> {
    const previous = this.queues.get(bank.root) ?? Promise.resolve();
    const job = previous.catch(() => undefined).then(() => this.execute(bank, targets));
    this.queues.set(bank.root, job);
    void job.finally(() => { if (this.queues.get(bank.root) === job) this.queues.delete(bank.root); }).catch(() => undefined);
    return job;
  }

  private command(bank: Bank, targets: string[], program?: string) {
    const config = vscode.workspace.getConfiguration('exercicesMpi', bank.scope);
    let nix = config.get<string>('nixPath', 'nix');
    if (nix === 'nix') {
      // VS Code opened from the Dock may not inherit the Nix PATH.
      nix = ['/nix/var/nix/profiles/default/bin/nix', path.join(os.homedir(), '.nix-profile/bin/nix')].find(existsSync) ?? nix;
    }
    return executionCommand(config.get('execution', 'auto'), existsSync(path.join(bank.root, 'flake.nix')), nix, program ?? config.get('makePath', 'make'), targets);
  }

  private async execute(bank: Bank, targets: string[]): Promise<void> {
    if (this.disposed) return;
    if (!vscode.workspace.isTrusted) throw new Error('Autorisez ce dossier dans VS Code pour compiler.');
    const { command, args } = this.command(bank, targets);
    this.output.appendLine(`\n[${bank.name}] ${command} ${args.join(' ')}`);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Exercices Typst : ${targets[0] === 'catalogue' ? 'catalogue' : 'compilation'}`, cancellable: true }, async (_progress, token) => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { cwd: bank.root, shell: false, detached: process.platform !== 'win32', env: { ...process.env, NO_COLOR: '1' } });
        this.children.add(child);
        let output = '';
        child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
        const collect = (text: string) => { this.output.append(text); output = (output + text).slice(-2_000_000); };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        const cancellation = token.onCancellationRequested(() => this.stop(child));
        child.once('error', error => {
          this.children.delete(child); cancellation.dispose();
          reject(new Error(`Impossible de lancer ${command} : ${error.message}. Vérifiez les réglages Exercices Typst.`));
        });
        child.once('close', code => {
          this.children.delete(child); cancellation.dispose();
          if (this.disposed || token.isCancellationRequested) { reject(new vscode.CancellationError()); return; }
          this.updateDiagnostics(bank, output);
          if (code === 0) resolve();
          else { this.output.show(true); reject(new Error(`La compilation a échoué (code ${code}). Consultez le journal Exercices Typst et le panneau Problèmes.`)); }
        });
      });
    });
  }

  private updateDiagnostics(bank: Bank, output: string): void {
    this.diagnostics.forEach(uri => { if (uri.fsPath.startsWith(bank.root + path.sep)) this.diagnostics.delete(uri); });
    const grouped = new Map<string, vscode.Diagnostic[]>();
    for (const item of parseDiagnostics(output)) {
      const file = path.resolve(bank.root, item.file);
      if (!file.startsWith(bank.root + path.sep)) continue;
      const diagnostic = new vscode.Diagnostic(new vscode.Range(item.line, item.column, item.line, item.column + 1), item.message, item.warning ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'Typst';
      grouped.set(file, [...(grouped.get(file) ?? []), diagnostic]);
    }
    for (const [file, entries] of grouped) this.diagnostics.set(vscode.Uri.file(file), entries);
  }

  private stop(child: ChildProcess): void {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill();
    } catch { /* The process may already have exited. */ }
  }
  dispose(): void { this.disposed = true; for (const child of this.children) this.stop(child); this.output.dispose(); this.diagnostics.dispose(); }
}
