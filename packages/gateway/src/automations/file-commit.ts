/**
 * One file's change as a git commit built in the Worker (doc 25 §4.2): the new blob, a new tree
 * for each directory on the file's path, and a commit whose parent is the version the editor
 * opened. Every other entry keeps its id, so the pack carries only the new objects (the
 * repository already holds the rest). Deleting the file drops directories it leaves empty.
 */
import type { RepoTreeEntry } from '@gitstalk/shared-race/rpc';

import type { GitObject, Signature } from '../git/pack-writer';
import { commitObject, gitObject } from '../git/pack-writer';

/** Reads one directory of the base commit; null when the directory does not exist. */
export type DirectoryReader = (path: string) => Promise<readonly RepoTreeEntry[] | null>;

export type FileChange = {
  readonly base: { readonly commit: string };
  readonly path: string;
  /** The file's new text; null deletes it. */
  readonly content: string | null;
  readonly author: Signature;
  readonly message: string;
};

export type FileCommit = {
  readonly commit: string;
  /** The blob of the file in the new commit; null when it was deleted. */
  readonly blob: string | null;
  /** The new objects, for the pack. */
  readonly objects: readonly GitObject[];
};

type Entry = { readonly name: string; readonly mode: string; readonly id: string };

const MODES: Readonly<Record<RepoTreeEntry['type'], string>> = {
  tree: '40000',
  blob: '100644',
  exec: '100755',
  symlink: '120000',
  gitlink: '160000',
};
const encoder = new TextEncoder();

/** Builds the commit that changes `change.path` on top of `change.base`. */
export async function buildFileCommit(
  read: DirectoryReader,
  change: FileChange,
): Promise<FileCommit> {
  const parts = change.path.split('/');
  const fileName = parts.pop() ?? change.path;
  const directories = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  const listings = await Promise.all(['', ...directories].map((path) => read(path)));
  const objects: GitObject[] = [];
  const blob = change.content === null ? null : await gitObject('blob', change.content);
  if (blob !== null) objects.push(blob);
  let child: { readonly name: string; readonly entry: Entry | null } = {
    name: fileName,
    entry: blob === null ? null : { name: fileName, mode: MODES.blob, id: blob.id },
  };
  for (let level = parts.length; level >= 0; level -= 1) {
    const entries = withEntry(entriesOf(listings[level] ?? null), child);
    const isRoot = level === 0;
    const tree =
      entries.length === 0 && !isRoot
        ? null
        : // oxlint-disable-next-line no-await-in-loop -- a parent tree needs its child's id
          await gitObject('tree', treeBody(entries));
    if (tree !== null) objects.push(tree);
    const name = parts[level - 1] ?? '';
    child = { name, entry: tree === null ? null : { name, mode: MODES.tree, id: tree.id } };
  }
  const root = child.entry;
  if (root === null) throw new Error('the root tree is always written');
  const commit = await commitObject({
    tree: root.id,
    parents: [change.base.commit],
    author: change.author,
    message: change.message,
  });
  return { commit: commit.id, blob: blob?.id ?? null, objects: [...objects, commit] };
}

function entriesOf(listing: readonly RepoTreeEntry[] | null): Entry[] {
  return (listing ?? []).map((entry) => ({
    name: entry.name,
    mode: MODES[entry.type],
    id: entry.sha,
  }));
}

/** The directory's entries with `child` replaced, added or (when its entry is null) removed. */
function withEntry(
  entries: readonly Entry[],
  child: { readonly name: string; readonly entry: Entry | null },
): Entry[] {
  const others = entries.filter((entry) => entry.name !== child.name);
  return child.entry === null ? others : [...others, child.entry];
}

/** Git sorts tree entries by name, comparing a directory as if its name ended in `/`. */
function treeBody(entries: readonly Entry[]): Uint8Array {
  const key = (entry: Entry): string => (entry.mode === MODES.tree ? `${entry.name}/` : entry.name);
  const sorted = entries.toSorted((a, b) => compareBytes(key(a), key(b)));
  const parts = sorted.flatMap((entry) => [
    encoder.encode(`${entry.mode} ${entry.name}\0`),
    unhex(entry.id),
  ]);
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function compareBytes(a: string, b: string): number {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function unhex(id: string): Uint8Array {
  return Uint8Array.from(id.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
