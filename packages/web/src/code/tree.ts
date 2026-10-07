/**
 * The Code tab's model: which line or bean is being browsed (`?ref=`), a directory's entries
 * from the ref's flat file list, the README to show, the breadcrumb, and every URL the tab
 * links to. Pure, so the routes stay thin and the tests need no gateway.
 */
import { TaskId } from '@beanstalk/shared-race/ids';

/** What the Code tab browses: the stalk (default), the sprout, a bean's pushed head, or a commit. */
export type RefChoice =
  | { readonly kind: 'stalk' }
  | { readonly kind: 'sprout' }
  | { readonly kind: 'bean'; readonly name: string }
  | { readonly kind: 'commit'; readonly sha: string };

export const STALK: RefChoice = { kind: 'stalk' };

/** `?ref=` as a choice: `sprout`, `bean/<name>`, a commit; anything else (or nothing) is the stalk. */
export function readRef(value: string | string[] | undefined): RefChoice {
  const text = typeof value === 'string' ? value : '';
  if (text === 'sprout') return { kind: 'sprout' };
  if (/^[0-9a-f]{40}$/.test(text)) return { kind: 'commit', sha: text };
  if (text.startsWith('bean/')) {
    const name = TaskId.safeParse(text.slice('bean/'.length));
    if (name.success) return { kind: 'bean', name: name.data };
  }
  return STALK;
}

/** The ref as `?ref=` writes it; the stalk writes nothing. */
export function refParam(ref: RefChoice): string | null {
  switch (ref.kind) {
    case 'stalk':
      return null;
    case 'sprout':
      return 'sprout';
    case 'bean':
      return `bean/${ref.name}`;
    case 'commit':
      return ref.sha;
    default:
      return assertNever(ref);
  }
}

export function refLabel(ref: RefChoice): string {
  if (ref.kind === 'bean') return `bean/${ref.name}`;
  return ref.kind === 'commit' ? ref.sha.slice(0, 7) : ref.kind;
}

export type CodeView = 'tree' | 'blob';

/** The URL of a directory (`tree`) or a file (`blob`) at a ref; the root at the stalk is `base`. */
export function codeHref(base: string, view: CodeView, path: string, ref: RefChoice): string {
  const param = refParam(ref);
  const query = param === null ? '' : `?ref=${encodeURIComponent(param)}`;
  if (view === 'tree' && path === '') return `${base}${query}`;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/${view}/${encoded}${query}`;
}

/** A catch-all route's segments as a repository path (`[]` is the root). */
export function pathOf(segments: readonly string[] | undefined): string {
  return (segments ?? []).map((segment) => decodeURIComponent(segment)).join('/');
}

export type TreeEntry = {
  readonly name: string;
  readonly path: string;
  readonly kind: 'dir' | 'file';
  /** Bytes, for files. */
  readonly size: number | null;
};

/**
 * The entries directly under `dir` (`''` is the root): folders first, then files, each by
 * name. Null when `dir` is not a folder of the tree.
 */
export function listing(
  files: readonly { readonly path: string; readonly size: number }[],
  dir: string,
): readonly TreeEntry[] | null {
  const prefix = dir === '' ? '' : `${dir}/`;
  const dirs = new Map<string, TreeEntry>();
  const leaves: TreeEntry[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const [head, ...tail] = rest.split('/');
    if (head === undefined || head === '') continue;
    if (tail.length === 0)
      leaves.push({ name: head, path: file.path, kind: 'file', size: file.size });
    else dirs.set(head, { name: head, path: `${prefix}${head}`, kind: 'dir', size: null });
  }
  if (dirs.size + leaves.length === 0) return dir === '' ? [] : null;
  const byName = (a: TreeEntry, b: TreeEntry): number => a.name.localeCompare(b.name);
  return [...[...dirs.values()].toSorted(byName), ...leaves.toSorted(byName)];
}

/** The README of a folder, if it has one (`README.md` first, any case). */
export function readmeOf(entries: readonly TreeEntry[]): TreeEntry | null {
  const files = entries.filter((entry) => entry.kind === 'file');
  const named = (pattern: RegExp) => files.find((entry) => pattern.test(entry.name));
  return named(/^readme\.md$/i) ?? named(/^readme(\.markdown|\.txt)?$/i) ?? null;
}

/** Each folder on the way to `path`, for the breadcrumb (the last is the path itself). */
export function crumbs(path: string): readonly { readonly name: string; readonly path: string }[] {
  if (path === '') return [];
  const parts = path.split('/');
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }));
}

/** `1.2 KB` and the like, for the file list. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A README's link as this repository's URL: absolute links and anchors as written; relative
 * ones resolved against the folder `at.path` and opened at the same ref.
 */
export function readmeHref(
  at: { readonly base: string; readonly ref: RefChoice; readonly path: string },
  href: string,
): string {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  const [target = '', anchor] = href.split('#');
  const start = target.startsWith('/')
    ? target.slice(1)
    : [at.path, target].filter(Boolean).join('/');
  const joined = start
    .split('/')
    .reduce<string[]>((parts, part) => {
      if (part === '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
      return parts;
    }, [])
    .join('/');
  const view: CodeView = target.endsWith('/') || !/\.[A-Za-z0-9]+$/.test(joined) ? 'tree' : 'blob';
  return `${codeHref(at.base, view, joined, at.ref)}${anchor === undefined ? '' : `#${anchor}`}`;
}

function assertNever(value: never): never {
  throw new Error(`unexpected ref ${JSON.stringify(value)}`);
}
