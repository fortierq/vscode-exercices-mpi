import { normalize } from './core';

export const quote = (value: string) => JSON.stringify(value.replaceAll('’', "'"));
export const tuple = (values: string[]) => `(${values.map(quote).join(', ')}${values.length ? ',' : ''})`;
export const slug = (value: string) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exercice';

// Preserve offsets and line breaks while ignoring comments, strings and raw code.
export function mask(text: string, strings = true): string {
  const result = text.split('');
  const blank = (start: number, end: number) => { for (let j = start; j < end; j++) if (text[j] !== '\n') result[j] = ' '; };
  for (let i = 0; i < text.length;) {
    const start = i;
    if (text.startsWith('//', i)) { i = text.indexOf('\n', i); if (i < 0) i = text.length; blank(start, i); }
    else if (text.startsWith('/*', i)) {
      i += 2; let depth = 1;
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) { depth++; i += 2; }
        else if (text.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      blank(start, i);
    } else if (text[i] === '"') {
      i++;
      while (i < text.length) { if (text[i] === '\\') i += 2; else if (text[i++] === '"') break; }
      if (strings) blank(start, Math.min(i, text.length));
    } else if (text[i] === '`') {
      while (text[i] === '`') i++;
      const fence = text.slice(start, i); const end = text.indexOf(fence, i);
      i = end < 0 ? text.length : end + fence.length; blank(start, i);
    } else i++;
  }
  return result.join('');
}

export interface OutlineItem { title: string; line: number; kind: 'question' | 'partie' | 'meta' | 'import'; children?: OutlineItem[] }
export function outline(text: string): OutlineItem[] {
  const code = mask(text);
  const items: OutlineItem[] = [];
  let number = Number(/\bdebut\s*:\s*(\d+)/.exec(code)?.[1] ?? 1);
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length - 1;
  const parents: { end: number; children: OutlineItem[] }[] = [];
  for (const match of code.matchAll(/\b(question|partie)\s*\(/g)) {
    while (parents.length && parents.at(-1)!.end <= match.index!) parents.pop();
    const children = parents.at(-1)?.children ?? items;
    const tail = text.slice(match.index! + match[0].length);
    if (match[1] === 'question') {
      const body = /^\s*(?:enonce:\s*)?\[([^\]]*)/.exec(tail)?.[1] ?? '';
      const title = body.replace(/[\n\r]+/g, ' ').replace(/[#\[\]$]/g, '').trim().slice(0, 95);
      children.push({ title: `${number++}. ${title || 'Question'}`, line: lineAt(match.index!), kind: 'question' });
    } else {
      const args = /^\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"/.exec(tail);
      const item: OutlineItem = { title: args ? `${args[1]} — ${args[2]}` : 'Partie', line: lineAt(match.index!), kind: 'partie', children: [] };
      children.push(item);
      let depth = 1; let end = match.index! + match[0].length;
      while (end < code.length && depth) { if (code[end] === '(') depth++; if (code[end] === ')') depth--; end++; }
      parents.push({ end, children: item.children! });
    }
  }
  for (const match of code.matchAll(/^\s*(titre|chapitres|algorithmes|structures|langages|difficulte|niveaux|duree|concours)\s*:/gm)) {
    const offset = match.index! + match[0].indexOf(match[1]);
    const value = text.slice(offset + match[1].length + 1).split('\n')[0].replace(/\/\/.*$/, '').trim().replace(/,$/, '');
    items.push({ title: `${match[1]} : ${value}`, line: lineAt(offset), kind: 'meta' });
  }
  for (const match of mask(text, false).matchAll(/#import\s+"([^"\n]+)"/g)) {
    if (/(exercices|concours)\//.test(match[1])) items.push({ title: match[1], line: lineAt(match.index!), kind: 'import' });
  }
  return items.sort((a, b) => a.line - b.line);
}

export function vocabulary(text: string, name: string): string[] {
  const clean = mask(text, false);
  const start = clean.indexOf(`#let ${name} = (`);
  if (start < 0) throw new Error(`Vocabulaire absent de lib/meta.typ : ${name}`);
  const end = clean.indexOf(')', start);
  return [...clean.slice(start, end).matchAll(/"([^"\n]+)"/g)].map(match => match[1]);
}

export interface NewExercise { title: string; chapters: string[]; algorithms: string[]; structures: string[]; languages: string[]; levels: string[]; difficulty: number; minutes: number | null }
export function exerciseFromTemplate(template: string, data: NewExercise): string {
  const fields: Record<string, string> = {
    titre: quote(data.title), chapitres: tuple(data.chapters), algorithmes: tuple(data.algorithms),
    structures: tuple(data.structures), langages: tuple(data.languages), niveaux: tuple(data.levels),
    difficulte: String(data.difficulty), duree: data.minutes ? `(${Math.floor(data.minutes / 60)}, ${data.minutes % 60})` : 'none', concours: 'none'
  };
  let result = template;
  for (const [key, value] of Object.entries(fields)) {
    const pattern = new RegExp(`(^[ \\t]*${key}:)[^\\n]*`, 'm');
    if (!pattern.test(result)) throw new Error(`Modèle incompatible : champ ${key} absent.`);
    result = result.replace(pattern, (_match, prefix) => `${prefix} ${value},`);
  }
  const content = /(^[ \t]*contenu:\s*)\(/m.exec(mask(result));
  if (!content) throw new Error('Modèle incompatible : contenu absent.');
  const start = content.index + content[0].length;
  const code = mask(result);
  let depth = 1; let end = start;
  while (end < code.length && depth) { if (code[end] === '(') depth++; if (code[end] === ')') depth--; end++; }
  if (depth) throw new Error('Modèle incompatible : contenu non fermé.');
  return result.slice(0, start) + '\n    question(\n      [Énoncé à compléter.],\n      solution: none,\n    ),\n  ' + result.slice(end - 1);
}

export function sheetFromTemplate(template: string, title: string, files: string[]): string {
  if (!files.length) throw new Error('Sélectionnez au moins un exercice.');
  let result = template.replace(/^#import\s+"\/templates\/exercice.typ"[^\n]*$/m,
    files.map((file, i) => `#import ${quote('/' + file)}: ex as ex${i + 1}`).join('\n'));
  if (result === template) throw new Error("Modèle de feuille incompatible : import d'exemple absent.");
  result = result.replace(/(^[ \t]*titre:)[^\n]*/m, (_match, prefix) => `${prefix} ${quote(title)},`);
  result = result.replace(/(^[ \t]*exercices:)[^\n]*/m, (_match, prefix) => `${prefix} (${files.map((_, i) => `ex${i + 1}`).join(', ')},),`);
  return result;
}
