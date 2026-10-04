/**
 * Reads a recorded run's repo snapshot (`repo.json`): trees per commit, file contents, the
 * line's history, grep and diffs between any two recorded commits.
 */
import type { Sha } from '@beanstalk/shared-race/ids';

import { diffFile } from '@beanstalk/shared-ask/repo/file-diff';
import { compareText } from '@beanstalk/shared-ask/repo/paths';
import type {
  FileStat,
  FileStatus,
  GrepMatch,
  RepoCommit,
  RepoDiff,
  TreeFile,
} from '@beanstalk/shared-ask/repo/repo-types';
import type { LineCommitRecord, RepoSnapshot, TaskRecord } from './recorded-runs';

/** Grep stops after this many matching lines, as a bounded search should. */
const MAX_GREP_MATCHES = 2000;

export type SnapshotReader = {
  readonly base: Sha;
  readonly line: readonly LineCommitRecord[];
  hasCommit(sha: string): boolean;
  treeFiles(sha: Sha): readonly TreeFile[];
  readFile(sha: Sha, path: string): string | undefined;
  diff(from: Sha, to: Sha, paths?: readonly string[]): RepoDiff;
  grep(sha: Sha, pattern: string, paths?: readonly string[]): readonly GrepMatch[];
  /** Line commits up to `sha` (inclusive), newest first, touching `paths` if given. */
  log(sha: Sha, paths?: readonly string[]): readonly RepoCommit[];
};

export function openSnapshot(repo: RepoSnapshot, tasks: readonly TaskRecord[]): SnapshotReader {
  const decoded = new Map<string, ReadonlyMap<string, number>>();
  const titles = new Map(tasks.map((task) => [task.id, task.title]));

  function tree(sha: string): ReadonlyMap<string, number> {
    const cached = decoded.get(sha);
    if (cached !== undefined) return cached;
    const pairs = repo.trees[sha];
    if (pairs === undefined) throw new Error(`commit ${sha} is not in the recorded repo`);
    const entries = new Map<string, number>();
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      const path = repo.paths[pairs[index] ?? -1];
      const blob = pairs[index + 1];
      if (path !== undefined && blob !== undefined) entries.set(path, blob);
    }
    decoded.set(sha, entries);
    return entries;
  }

  function readFile(sha: Sha, path: string): string | undefined {
    const blob = tree(sha).get(path);
    return blob === undefined ? undefined : repo.blobs[blob];
  }

  return {
    base: repo.base,
    line: repo.line,
    hasCommit: (sha) => sha in repo.trees,
    treeFiles: (sha) =>
      [...tree(sha)].map(([path, blob]) => ({ path, size: (repo.blobs[blob] ?? '').length })),
    readFile,
    diff: (from, to, paths) =>
      diffTrees({ from, to, before: tree(from), after: tree(to), paths, blobs: repo.blobs }),
    grep: (sha, pattern, paths) => grepTree(tree(sha), { pattern, paths, blobs: repo.blobs }),
    log: (sha, paths) => lineLog(repo, { sha, paths, titles }),
  };
}

function diffTrees(input: {
  readonly from: Sha;
  readonly to: Sha;
  readonly before: ReadonlyMap<string, number>;
  readonly after: ReadonlyMap<string, number>;
  readonly paths: readonly string[] | undefined;
  readonly blobs: readonly string[];
}): RepoDiff {
  const { before, after, blobs } = input;
  const candidates = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => input.paths === undefined || input.paths.includes(path))
    .filter((path) => before.get(path) !== after.get(path))
    .toSorted(compareText);
  const files = candidates.flatMap((path) => {
    const old = before.get(path);
    const next = after.get(path);
    const diff = diffFile(
      path,
      old === undefined ? undefined : blobs[old],
      next === undefined ? undefined : blobs[next],
    );
    return diff === undefined ? [] : [diff];
  });
  return { from: input.from, to: input.to, files };
}

function grepTree(
  files: ReadonlyMap<string, number>,
  query: {
    readonly pattern: string;
    readonly paths: readonly string[] | undefined;
    readonly blobs: readonly string[];
  },
): readonly GrepMatch[] {
  const needle = query.pattern.toLowerCase();
  if (needle === '') return [];
  const matches: GrepMatch[] = [];
  for (const [path, blob] of [...files].toSorted(([a], [b]) => compareText(a, b))) {
    if (query.paths !== undefined && !query.paths.some((prefix) => path.startsWith(prefix)))
      continue;
    const lines = (query.blobs[blob] ?? '').split('\n');
    for (const [index, text] of lines.entries()) {
      if (!text.toLowerCase().includes(needle)) continue;
      matches.push({ path, line: index + 1, text });
      if (matches.length >= MAX_GREP_MATCHES) return matches;
    }
  }
  return matches;
}

function lineLog(
  repo: RepoSnapshot,
  query: {
    readonly sha: Sha;
    readonly paths: readonly string[] | undefined;
    readonly titles: ReadonlyMap<string, string>;
  },
): readonly RepoCommit[] {
  const end = repo.line.findIndex((commit) => commit.sha === query.sha);
  const upto = end === -1 ? [] : repo.line.slice(0, end + 1);
  const touches = (commit: LineCommitRecord) =>
    query.paths === undefined || commit.files.some((file) => query.paths?.includes(file.path));
  return upto
    .map((commit, position) => ({ commit, idx: commit.idx ?? position }))
    .filter(({ commit }) => touches(commit))
    .toReversed()
    .map(({ commit, idx }) => ({
      sha: commit.sha,
      parent: commit.parent,
      title: (commit.task === null ? undefined : query.titles.get(commit.task)) ?? commit.kind,
      task: commit.task,
      kind: commit.kind,
      idx,
      t: commit.t,
      files: commit.files.map(toFileStat),
    }));
}

function toFileStat(record: {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
}): FileStat {
  return {
    path: record.path,
    status: gitStatus(record.status),
    additions: record.additions,
    deletions: record.deletions,
  };
}

function gitStatus(code: string): FileStatus {
  if (code.startsWith('A')) return 'added';
  if (code.startsWith('D')) return 'deleted';
  return 'modified';
}
