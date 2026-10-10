/**
 * The selection rule of `research/test-impact` (`select()` in `harness/ti.py`), over stored
 * read maps. A test file is affected by a change set when:
 *
 * 1. it changed itself;
 * 2. it has no map (it runs, and that run maps it);
 * 3. its map is stale: traced under another toolchain, or on a tree that differs from the base
 *    in a path the map observed (the trees' difference goes through rules 4-7 as changes), or
 *    on a tree whose manifest (or the base's) is unknown;
 * 4. a modified path is one it read or probed;
 * 5. a deleted path is one it read, or lies in a directory it listed;
 * 6. an added path, or any of the ancestors the add creates, is one it probed or lies in a
 *    directory it listed;
 * 7. a lockfile or `package.json` changed and it loads installed packages (or looked for one),
 *    or a changed path lies inside a package it loaded.
 *
 * Nothing else runs. Sound for deterministic tests: a run that differs from the traced one
 * first differs at an input the traced run read, probed or listed.
 */
import type { AffectedAnswer, AffectedReason, PathChange } from '@gitstalk/shared-race/read-maps';

/** One stored map: what a test file observed on `tree`. */
export type StoredReadMap = {
  readonly test: string;
  /** The tree it was traced on (the commit, or the commit with extra files). */
  readonly tree: string;
  readonly environment: string | null;
  readonly reads: readonly string[];
  readonly probes: readonly string[];
  readonly dirs: readonly string[];
  readonly packages: readonly string[];
};

/** A tree's files and their blob ids. */
export type Manifest = ReadonlyMap<string, string>;

export type AffectedInput = {
  readonly maps: ReadonlyMap<string, StoredReadMap>;
  readonly universe: readonly string[];
  readonly changes: readonly PathChange[];
  /** The tree the changes apply to; null: unknown (maps from other trees are stale). */
  readonly base: string | null;
  /** The current toolchain; maps from another are stale. Null: any. */
  readonly environment: string | null;
  readonly manifestOf: (tree: string) => Manifest | null;
};

/** Files whose change can change every installed package. */
const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  '.npmrc',
  '.yarnrc.yml',
]);

type Hit = { readonly reason: AffectedReason; readonly path: string | null };

/** Splits `input.universe` into affected and unaffected test files. */
export function affectedTests(input: AffectedInput): AffectedAnswer {
  const changed = new Set(input.changes.map((change) => change.path));
  const drift = new TreeDrift(input.manifestOf);
  const reasons: Record<string, Hit> = {};
  const unaffected: string[] = [];
  for (const test of [...new Set(input.universe)].toSorted()) {
    const hit = judge(test, input, { changed, drift });
    if (hit === null) unaffected.push(test);
    else reasons[test] = hit;
  }
  const affected = Object.keys(reasons).toSorted();
  return {
    affected,
    unaffected,
    unknown: affected.filter((test) => reasons[test]?.reason === 'unmapped'),
    reasons,
  };
}

function judge(
  test: string,
  input: AffectedInput,
  seen: { changed: ReadonlySet<string>; drift: TreeDrift },
): Hit | null {
  if (seen.changed.has(test)) return { reason: 'own-change', path: test };
  const map = input.maps.get(test);
  if (map === undefined) return { reason: 'unmapped', path: null };
  if (input.environment !== null && map.environment !== input.environment)
    return { reason: 'stale', path: null };
  if (map.tree !== input.base) {
    const difference = input.base === null ? null : seen.drift.between(map.tree, input.base);
    if (difference === null) return { reason: 'stale', path: null };
    const staleBy = observes(map, difference);
    if (staleBy !== null) return { reason: 'stale', path: staleBy.path };
  }
  return observes(map, input.changes);
}

/** The first change `map` observes, by rules 4-7. */
export function observes(map: StoredReadMap, changes: readonly PathChange[]): Hit | null {
  const sets = {
    reads: new Set(map.reads),
    probes: new Set(map.probes),
    dirs: new Set(map.dirs),
  };
  for (const change of changes) {
    const reason = observedBy(sets, change);
    if (reason !== null) return { reason, path: change.path };
    if (touchesDependencies(map, change.path)) return { reason: 'dependency', path: change.path };
  }
  return null;
}

type Sets = { reads: Set<string>; probes: Set<string>; dirs: Set<string> };

function observedBy(sets: Sets, change: PathChange): AffectedReason | null {
  const { path, op } = change;
  switch (op) {
    case 'M':
      if (sets.reads.has(path)) return 'read';
      return sets.probes.has(path) ? 'probe' : null;
    case 'D':
      if (sets.reads.has(path)) return 'read';
      return sets.dirs.has(parentOf(path)) ? 'listing' : null;
    case 'A':
      return addedHit(sets, path);
    default:
      return null;
  }
}

/** Adding `path` creates it and every missing ancestor: any of them probed, or listed into. */
function addedHit(sets: Sets, path: string): AffectedReason | null {
  for (let entry: string | null = path; entry !== null; entry = parentOrNull(entry)) {
    if (sets.probes.has(entry)) return 'probe';
    if (sets.dirs.has(parentOf(entry))) return 'listing';
  }
  return null;
}

function touchesDependencies(map: StoredReadMap, path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (DEPENDENCY_FILES.has(name)) return loadsDependencies(map);
  return map.packages.some((pkg) => path.startsWith(`${pkg}/`));
}

/** It loaded a package, or looked for one (adding a dependency could change what it finds). */
function loadsDependencies(map: StoredReadMap): boolean {
  if (map.packages.length > 0) return true;
  return (
    map.probes.some(isInNodeModules) ||
    map.dirs.some(isInNodeModules) ||
    map.reads.some(isInNodeModules)
  );
}

function isInNodeModules(path: string): boolean {
  return path.split('/').includes('node_modules');
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function parentOrNull(path: string): string | null {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? null : path.slice(0, slash);
}

/** The changes from one tree to another, from their manifests; memoised per pair. */
class TreeDrift {
  readonly #manifestOf: (tree: string) => Manifest | null;
  readonly #cache = new Map<string, readonly PathChange[] | null>();

  constructor(manifestOf: (tree: string) => Manifest | null) {
    this.#manifestOf = manifestOf;
  }

  /** `from` to `to` as changes; null when either manifest is unknown. */
  between(from: string, to: string): readonly PathChange[] | null {
    const key = `${from}\u0000${to}`;
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;
    const before = this.#manifestOf(from);
    const after = this.#manifestOf(to);
    const changes = before === null || after === null ? null : diffManifests(before, after);
    this.#cache.set(key, changes);
    return changes;
  }
}

/** The changes that turn `before` into `after`. */
export function diffManifests(before: Manifest, after: Manifest): PathChange[] {
  const changes: PathChange[] = [];
  for (const [path, blob] of after) {
    const old = before.get(path);
    if (old === undefined) changes.push({ path, op: 'A' });
    else if (old !== blob) changes.push({ path, op: 'M' });
  }
  for (const path of before.keys()) if (!after.has(path)) changes.push({ path, op: 'D' });
  return changes;
}

/**
 * Whether `path` is a test file under node's default patterns
 * (`**\/{test,test/**\/*,test-*,*[._-]test}.{js,mjs,cjs,ts,mts,cts}`, outside `node_modules`).
 * Custom suites pass their own universe instead.
 */
export function isDefaultTestFile(path: string): boolean {
  const parts = path.split('/');
  if (parts.includes('node_modules')) return false;
  const name = parts.at(-1) ?? '';
  const match = /^(.*)\.(?:c|m)?[jt]s$/.exec(name);
  if (match === null) return false;
  const stem = match[1] ?? '';
  return (
    stem === 'test' ||
    stem.startsWith('test-') ||
    /[._-]test$/.test(stem) ||
    parts.slice(0, -1).includes('test')
  );
}
