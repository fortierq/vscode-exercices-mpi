export interface Folder<T> { folder: string; title: string; children: (T | Folder<T>)[] }
export function isFolder<T>(node: T | Folder<T>): node is Folder<T> { return !!node && typeof node === 'object' && 'folder' in node; }

export function hierarchy<T>(items: T[], file: (item: T) => string): (T | Folder<T>)[] {
  const root: (T | Folder<T>)[] = [];
  const directories = new Map<string, Folder<T>>();
  for (const item of items) {
    const parts = file(item).split('/'); parts.pop();
    let children = root; let prefix = '';
    for (const title of parts) {
      prefix += '/' + title;
      let folder = directories.get(prefix);
      if (!folder) { folder = { folder: prefix, title, children: [] }; directories.set(prefix, folder); children.push(folder); }
      children = folder.children;
    }
    children.push(item);
  }
  const sort = (children: (T | Folder<T>)[]) => {
    children.sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || (isFolder(a) ? a.title : file(a)).localeCompare(isFolder(b) ? b.title : file(b), 'fr', { numeric: true }));
    for (const child of children) if (isFolder(child)) sort(child.children);
  };
  sort(root);
  return root;
}
