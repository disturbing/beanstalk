/**
 * A tiny in-memory git for engine tests: commits are whole file maps, merges are 3-way
 * per file, and conflicts leave the same markers git does. Enough to give squashes,
 * reworks and suites real content without a container.
 */
import { Sha } from '@beanstalk/shared-race/ids';

export type Files = ReadonlyMap<string, string>;

export type Commit = {
  readonly sha: Sha;
  readonly parents: readonly Sha[];
  readonly files: Files;
  readonly message: string;
};

export type MergeResult =
  | { readonly kind: 'clean'; readonly files: Files }
  | { readonly kind: 'conflict'; readonly files: Files; readonly conflicts: readonly string[] };

export type ToyGit = {
  commit(parents: readonly Sha[], files: Files, message: string): Commit;
  get(sha: string): Commit;
  setRef(repo: string, ref: string, sha: Sha): void;
  ref(repo: string, ref: string): Sha | undefined;
  isAncestor(ancestor: string, descendant: string): boolean;
  mergeBase(a: string, b: string): Sha;
};

/** A fresh object store with per-repo refs. Shas count up, so runs are reproducible. */
export function createToyGit(): ToyGit {
  const commits = new Map<string, Commit>();
  const refs = new Map<string, Map<string, Sha>>();
  const counter = { value: 0 };

  const get = (sha: string): Commit => {
    const commit = commits.get(sha);
    if (commit === undefined) throw new Error(`toy git: no commit ${sha}`);
    return commit;
  };

  const isAncestor = (ancestor: string, descendant: string): boolean => {
    const seen = new Set<string>();
    const stack = [descendant];
    while (stack.length > 0) {
      const sha = stack.pop();
      if (sha === undefined || seen.has(sha)) continue;
      if (sha === ancestor) return true;
      seen.add(sha);
      stack.push(...get(sha).parents);
    }
    return false;
  };

  return {
    commit(parents, files, message) {
      counter.value += 1;
      const sha = Sha.parse(counter.value.toString(16).padStart(40, '0'));
      const commit: Commit = { sha, parents, files, message };
      commits.set(sha, commit);
      return commit;
    },
    get,
    setRef(repo, ref, sha) {
      const repoRefs = refs.get(repo) ?? new Map<string, Sha>();
      repoRefs.set(ref, sha);
      refs.set(repo, repoRefs);
    },
    ref(repo, ref) {
      return refs.get(repo)?.get(ref);
    },
    isAncestor,
    /** The first ancestor of `b`, breadth first, that is also an ancestor of `a`. */
    mergeBase(a, b) {
      const queue = [b];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const sha = queue.shift();
        if (sha === undefined || seen.has(sha)) continue;
        seen.add(sha);
        if (isAncestor(sha, a)) return get(sha).sha;
        queue.push(...get(sha).parents);
      }
      throw new Error(`toy git: no merge base of ${a} and ${b}`);
    },
  };
}

/** Three-way merge of whole file maps, per file; CHANGELOG files merge as a union when asked. */
export function mergeFiles(
  base: Files,
  ours: Files,
  theirs: Files,
  unionPaths: readonly string[],
): MergeResult {
  const paths = [...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])].toSorted();
  const merged = new Map<string, string>();
  const conflicts: string[] = [];
  for (const path of paths) {
    const resolved = mergeOne(path, [base.get(path), ours.get(path), theirs.get(path)], unionPaths);
    if (resolved.isConflict) conflicts.push(path);
    if (resolved.content !== undefined) merged.set(path, resolved.content);
  }
  return conflicts.length === 0
    ? { kind: 'clean', files: merged }
    : { kind: 'conflict', files: merged, conflicts };
}

type Sides = readonly [string | undefined, string | undefined, string | undefined];

function mergeOne(
  path: string,
  [base, ours, theirs]: Sides,
  unionPaths: readonly string[],
): { content: string | undefined; isConflict: boolean } {
  if (ours === theirs) return { content: ours, isConflict: false };
  if (ours === base) return { content: theirs, isConflict: false };
  if (theirs === base) return { content: ours, isConflict: false };
  if (unionPaths.length > 0 && /(^|\/)CHANGELOG[^/]*\.md$/.test(path)) {
    return { content: unionLines(base ?? '', ours ?? '', theirs ?? ''), isConflict: false };
  }
  return {
    content: `<<<<<<< ours\n${ours ?? ''}=======\n${theirs ?? ''}>>>>>>> theirs\n`,
    isConflict: true,
  };
}

/** Base lines, then lines only ours added, then lines only theirs added. */
function unionLines(base: string, ours: string, theirs: string): string {
  const baseLines = new Set(base.split('\n'));
  const added = (text: string): string[] =>
    text.split('\n').filter((line) => line !== '' && !baseLines.has(line));
  const kept = base.split('\n').filter((line) => line !== '');
  return `${[...kept, ...added(ours), ...added(theirs)].join('\n')}\n`;
}

/** Keeps both sides of every conflict hunk (the harness's `union_resolve`). */
export function resolveBothSides(content: string): string {
  return content.replace(/<{7} ours\n([\s\S]*?)={7}\n([\s\S]*?)>{7} theirs\n/g, '$1$2');
}

/** Paths whose content differs between two file maps. */
export function changedPaths(a: Files, b: Files): string[] {
  const paths = new Set([...a.keys(), ...b.keys()]);
  return [...paths].filter((path) => a.get(path) !== b.get(path)).toSorted();
}

export function hasMarkers(content: string): boolean {
  return /^(<{7}|>{7})( |$)/m.test(content);
}
