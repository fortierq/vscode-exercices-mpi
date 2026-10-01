import * as path from 'node:path';
import { mask, quote } from './typst';
import { Exercise } from './core';

export interface SheetEntry { alias: string; source: string; chunk: string }
export interface SheetList { start: number; end: number; entries: SheetEntry[]; tail: string }

// Only literal imported identifiers are editable. Never evaluate or rewrite computed Typst.
export function sheetList(text: string, source: string): SheetList {
  const code = mask(text);
  const fields = [...code.matchAll(/\bexercices\s*:\s*\(/g)];
  const show = /#show\s*:\s*feuille\.with\s*\(/.exec(code);
  if (fields.length !== 1 || !show) throw new Error('Composition calculée ou non reconnue : modifiez cette feuille dans la source.');
  let depth = 1; let stop = show.index + show[0].length;
  while (stop < code.length && depth) { if (code[stop] === '(') depth++; if (code[stop] === ')') depth--; stop++; }
  if (depth || fields[0].index! < show.index || fields[0].index! >= stop) throw new Error('Composition hors de feuille.with.');
  const start = fields[0].index! + fields[0][0].length;
  let end = start;
  while (end < code.length && code[end] !== ')') end++;
  if (end === code.length || !/^\s*,/.test(code.slice(end + 1))) throw new Error('Liste d’exercices non littérale.');
  const imports = new Map<string, string>();
  for (const match of mask(text, false).matchAll(/#import\s+"([^"\n]+)"\s*:\s*([\w-]+)(?:\s+as\s+([\w-]+))?[^\S\n]*(?=\n|$)/g)) {
    if (!code.slice(match.index, match.index! + 7).startsWith('#import')) continue;
    const file = match[1].startsWith('/') ? match[1].slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(source), match[1]));
    const alias = match[3] ?? match[2];
    if (imports.has(alias)) throw new Error('Alias importé plusieurs fois.');
    imports.set(alias, file);
  }
  const entries: SheetEntry[] = [];
  const inner = code.slice(start, end);
  let offset = 0;
  for (const match of inner.matchAll(/([^,]*),/g)) {
    const alias = match[1].trim();
    if (!/^[\w-]+$/.test(alias) || !imports.has(alias)) throw new Error('Composition calculée ou import non reconnu : modifiez cette feuille dans la source.');
    if (new RegExp(`\\blet\\s+${alias}\\s*=`).test(code)) throw new Error('Alias redéfini : modifiez la composition dans la source.');
    const stop = match.index! + match[0].length;
    entries.push({ alias, source: imports.get(alias)!, chunk: text.slice(start + offset, start + stop) });
    offset = stop;
  }
  if (inner.slice(offset).trim()) throw new Error('La liste doit contenir des alias suivis d’une virgule.');
  return { start, end, entries, tail: text.slice(start + offset, end) };
}

export function editSheet(text: string, source: string, operation: { index: number; direction?: number } | { add: string }): string {
  const list = sheetList(text, source);
  let prefix = '';
  if ('add' in operation) {
    if (list.entries.some(entry => entry.source === operation.add)) throw new Error('Cet exercice figure déjà dans la feuille.');
    let n = 1;
    while (new RegExp(`\\bex${n}\\b`).test(text)) n++;
    prefix = `#import ${quote('/' + operation.add)}: ex as ex${n}\n`;
    list.entries.push({ alias: `ex${n}`, source: operation.add, chunk: ` ex${n},` });
  } else {
    if (!list.entries[operation.index]) throw new Error('La feuille a changé ; actualisez la vue.');
    if (operation.direction === undefined) list.entries.splice(operation.index, 1);
    else {
      const target = operation.index + operation.direction;
      if (target < 0 || target >= list.entries.length) return text;
      [list.entries[operation.index], list.entries[target]] = [list.entries[target], list.entries[operation.index]];
    }
  }
  return prefix + text.slice(0, list.start) + list.entries.map(entry => entry.chunk).join('') + list.tail + text.slice(list.end);
}

// Search indexes literal metadata only; compilation remains the catalogue's job.
export function sourceMetadata(text: string, source: string): Exercise {
  const clean = mask(text, false);
  const string = (key: string) => new RegExp(`\\b${key}\\s*:\\s*"([^"\\n]*)"`).exec(clean)?.[1];
  const values = (key: string) => [...(new RegExp(`\\b${key}\\s*:\\s*\\(([^)]*)\\)`).exec(clean)?.[1] ?? '').matchAll(/"([^"\n]*)"/g)].map(match => match[1]);
  const contest = /\bconcours\s*:\s*\(([^)]*)\)/.exec(clean)?.[1];
  return { titre: string('titre') ?? path.posix.basename(source, '.typ'), fichier: source,
    chapitres: values('chapitres'), algorithmes: values('algorithmes'), structures: values('structures'), langages: values('langages'), niveaux: values('niveaux').concat(string('niveau') ?? []),
    difficulte: Number(/\bdifficulte\s*:\s*(\d+)/.exec(clean)?.[1] ?? Infinity), duree: null,
    concours: contest ? { nom: /\bnom\s*:\s*"([^"]*)"/.exec(contest)?.[1], annee: Number(/\bannee\s*:\s*(\d+)/.exec(contest)?.[1]) || undefined, filiere: /\bfiliere\s*:\s*"([^"]*)"/.exec(contest)?.[1] } : null };
}
