import * as vscode from 'vscode';
import * as path from 'node:path';
import { Location } from './files';
import { Sheets, SheetMember } from './sheets';

const mime = 'application/vnd.exercices-typst.source';
type Node = Location & { sheet?: string; index?: number; snapshot?: string; folder?: string };
function unwrap(value: unknown): Node | undefined {
  if (!value || typeof value !== 'object') return;
  if ('member' in value) return unwrap(value.member);
  if ('bank' in value && 'source' in value) return value as Node;
}
export class Drag<T> implements vscode.TreeDragAndDropController<T> {
  readonly dragMimeTypes = [mime]; readonly dropMimeTypes = [mime];
  constructor(private category: string, private sheets: () => Sheets, private move: (source: Location, destination: string) => Promise<void>, private report: (error: unknown) => void) {}
  handleDrag(nodes: readonly T[], data: vscode.DataTransfer): void {
    const sources = nodes.map(unwrap).filter((node): node is Node => !!node && !node.folder);
    if (sources.length) data.set(mime, new vscode.DataTransferItem(sources));
  }
  async handleDrop(target: T | undefined, data: vscode.DataTransfer): Promise<void> {
    try {
      const nodes = data.get(mime)?.value as Node[] | undefined;
      if (!nodes?.length) return;
      const destination = unwrap(target);
      for (const node of nodes) {
        if (destination && node.bank.root !== destination.bank.root) throw new Error('Le déplacement entre banques n’est pas pris en charge.');
        if (node.sheet && destination?.sheet === node.sheet) {
          await this.sheets().change(node as SheetMember, destination.index! - node.index!);
        } else if (destination && !destination.folder && (destination.sheet || destination.source.startsWith('feuilles/'))) {
          await this.sheets().add(node.bank, node.source, destination.sheet ?? destination.source);
        } else {
          if (destination && !destination.folder) throw new Error('Déposez le fichier sur un dossier, une feuille ou dans le fond de sa section.');
          const folder = destination?.source ?? this.category;
          if (node.source.split('/')[0] !== folder.split('/')[0]) throw new Error('Déposez le fichier dans un dossier de la même section.');
          await this.move(node, folder + '/' + path.posix.basename(node.source));
        }
      }
    } catch (error) { this.report(error); }
  }
}
