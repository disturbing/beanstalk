/** Repo paths: ordering, folders and the words in a path. */

/** Byte order, so paths sort the same in every runtime (no locale). */
export function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** `src/billing/tax.ts` → `src/billing`; a root file → `''`. */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** `src/billing/tax.ts` → `tax.ts`. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The words of a path, lower case: folders, the file name split on punctuation and
 * camelCase (`src/lib/formatMoney.test.ts` → src, lib, format, money, test, ts).
 */
export function pathWords(path: string): readonly string[] {
  return path
    .split(/[/._-]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .map((word) => word.toLowerCase())
    .filter((word) => word !== '');
}
