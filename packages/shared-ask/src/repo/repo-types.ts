/**
 * The repository as the explorer reads it: trees, files, diffs, the line's history and grep
 * hits at a ref. Both data sources (the gateway binding and the recorded runs) return these.
 */
import type { Sha, TaskId } from '@gitstalk/shared-race/ids';

/** A line by name, or a commit. */
export type RefName = 'sprout' | 'stalk' | 'base' | Sha;

export type TreeFile = { readonly path: string; readonly size: number };

export type RepoTree = {
  readonly ref: RefName;
  readonly sha: Sha;
  readonly files: readonly TreeFile[];
};

export type RepoFile = {
  readonly ref: RefName;
  readonly sha: Sha;
  readonly path: string;
  readonly text: string;
};

export type FileStatus = 'added' | 'modified' | 'deleted';

/** What a commit did to one file (`git diff --numstat`). */
export type FileStat = {
  readonly path: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
};

export type DiffLine = {
  readonly kind: 'context' | 'add' | 'del';
  readonly text: string;
  readonly oldNo: number | null;
  readonly newNo: number | null;
};

export type DiffHunk = {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
};

export type FileDiff = FileStat & { readonly hunks: readonly DiffHunk[] };

export type RepoDiff = {
  readonly from: Sha;
  readonly to: Sha;
  readonly files: readonly FileDiff[];
};

/** A commit of the line (or the base), newest first in a log. */
export type RepoCommit = {
  readonly sha: Sha;
  readonly parent: Sha | null;
  readonly title: string;
  /** The bean it lands, if any. */
  readonly task: TaskId | null;
  readonly kind: string;
  /** Position on the line; null for the base. */
  readonly idx: number | null;
  /** Race seconds when it landed; null for the base. */
  readonly t: number | null;
  readonly files: readonly FileStat[];
};

export type GrepMatch = {
  readonly path: string;
  readonly line: number;
  readonly text: string;
};
