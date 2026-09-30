import * as path from 'node:path';

export interface Exercise {
  titre: string; fichier: string; chapitres: string[]; algorithmes: string[];
  structures: string[]; langages: string[]; niveaux: string[]; difficulte: number;
  duree: [number, number] | null;
  concours: { nom?: string; annee?: number; filiere?: string; oral?: boolean } | null;
}
export type Variant = 'enonce' | 'corrige';
export const facets = ['chapitres', 'algorithmes', 'structures', 'langages', 'niveaux', 'concours'] as const;
export type Facet = typeof facets[number];
export type Filters = Partial<Record<Facet, string>> & { difficulteMax?: number };
export const labels: Record<Facet, string> = { chapitres: 'Chapitre', algorithmes: 'Algorithme', structures: 'Structure', langages: 'Langage', niveaux: 'Niveau', concours: 'Concours' };

export function safeSource(file: string): string {
  // This path is also passed to Make: exclude Make variable/recipe syntax.
  if (!/^(exercices|feuilles|concours)\/(?:[\p{L}\p{N}_-]+\/)*[\p{L}\p{N}_-]+\.typ$/u.test(file)) {
    throw new Error(`Chemin de source non pris en charge : ${file}`);
  }
  return file;
}

export function pdfTarget(source: string, variant: Variant): string {
  safeSource(source);
  const stem = source.slice(0, -4);
  return source.startsWith('feuilles/')
    ? `build/${stem}${variant === 'corrige' ? '-corrige' : ''}.pdf`
    : `build/${stem}/${variant}.pdf`;
}

export function watchArguments(source: string, variant: Variant): string[] {
  safeSource(source);
  const args = ['watch', '--root', '.', '--ignore-system-fonts', '--input', `corrige=${variant === 'corrige'}`];
  if (!source.startsWith('feuilles/')) args.push('--input', `exercice=/${source}`);
  args.push(source.startsWith('feuilles/') ? source : 'templates/fiche.typ', pdfTarget(source, variant));
  return args;
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').replace(/[’']/g, ' ');
}

export function parseCatalogue(text: string): Exercise[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('Le catalogue doit être un tableau JSON.');
  const identifiers = new Set<string>();
  return data.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Entrée de catalogue invalide.');
    const ex = item as Exercise;
    if (typeof ex.titre !== 'string' || !ex.titre || typeof ex.fichier !== 'string') throw new Error('Titre ou fichier manquant.');
    safeSource(ex.fichier);
    const id = path.posix.basename(ex.fichier, '.typ');
    if (identifiers.has(id)) throw new Error(`Identifiant dupliqué : ${id}`);
    identifiers.add(id);
    for (const field of ['chapitres', 'algorithmes', 'structures', 'langages', 'niveaux'] as const) {
      if (!Array.isArray(ex[field]) || !ex[field].every(value => typeof value === 'string')) throw new Error(`Champ ${field} invalide : ${id}`);
    }
    if (!Number.isInteger(ex.difficulte) || ex.difficulte < 1 || ex.difficulte > 5) throw new Error(`Difficulté invalide : ${id}`);
    if (ex.duree !== null && (!Array.isArray(ex.duree) || ex.duree.length !== 2 || !ex.duree.every(Number.isInteger) || ex.duree[0] < 0 || ex.duree[1] < 0 || ex.duree[1] >= 60 || ex.duree[0] + ex.duree[1] === 0)) throw new Error(`Durée invalide : ${id}`);
    if (ex.concours !== null && (typeof ex.concours !== 'object' || Array.isArray(ex.concours))) throw new Error(`Concours invalide : ${id}`);
    if (ex.concours) {
      for (const key of ['nom', 'filiere'] as const) if (ex.concours[key] !== undefined && typeof ex.concours[key] !== 'string') throw new Error(`Concours invalide : ${id}`);
      if (ex.concours.annee !== undefined && !Number.isInteger(ex.concours.annee)) throw new Error(`Année invalide : ${id}`);
    }
    return ex;
  });
}

export function matches(ex: Exercise, query: string, filters: Filters): boolean {
  const haystack = normalize([ex.titre, ex.fichier, ...ex.chapitres, ...ex.algorithmes, ...ex.structures, ...ex.langages, ...ex.niveaux, ...Object.values(ex.concours ?? {})].join(' '));
  return normalize(query).split(/\s+/).filter(Boolean).every(word => haystack.includes(word))
    && facets.every(key => !filters[key] || (key === 'concours' ? ex.concours?.nom === filters[key] : ex[key].includes(filters[key]!)))
    && (filters.difficulteMax === undefined || ex.difficulte <= filters.difficulteMax);
}

export function duration(ex: Exercise): string {
  if (!ex.duree) return '';
  const [h, m] = ex.duree;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

export function executionCommand(mode: 'auto' | 'nix' | 'direct', flake: boolean, nix: string, make: string, targets: string[]): { command: string; args: string[] } {
  return mode === 'nix' || (mode === 'auto' && flake)
    ? { command: nix, args: ['develop', 'path:.', '-c', make, ...targets] }
    : { command: make, args: targets };
}

export interface TypstDiagnostic { file: string; line: number; column: number; message: string; warning: boolean }
export function parseDiagnostics(output: string): TypstDiagnostic[] {
  const result: TypstDiagnostic[] = [];
  let message = ''; let warning = false;
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const heading = /^(error|warning): (.*)/.exec(line);
    if (heading) { message = heading[2]; warning = heading[1] === 'warning'; }
    const location = /(?:┌─|-->)[ \t]+(.+):(\d+):(\d+)\s*$/.exec(line);
    if (location && message) result.push({ file: location[1], line: Math.max(0, +location[2] - 1), column: Math.max(0, +location[3] - 1), message, warning });
  }
  return result;
}
