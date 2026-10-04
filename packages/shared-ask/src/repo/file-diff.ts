/**
 * Line diffs between two versions of a file, as unified hunks with line numbers. Used for
 * ranges the recorded runs did not precompute; the per-commit numbers come from git.
 */
import { structuredPatch } from 'diff';

import type { DiffHunk, DiffLine, FileDiff, FileStatus } from './repo-types';

/** Lines of context around each change, as `git diff` prints by default. */
const CONTEXT_LINES = 3;

/** The diff of one path from `before` to `after` (undefined: the file does not exist there). */
export function diffFile(
  path: string,
  before: string | undefined,
  after: string | undefined,
): FileDiff | undefined {
  if (before === after) return undefined;
  const patch = structuredPatch(path, path, before ?? '', after ?? '', undefined, undefined, {
    context: CONTEXT_LINES,
  });
  const hunks = patch.hunks.map(toHunk);
  const lines = hunks.flatMap((hunk) => hunk.lines);
  return {
    path,
    status: fileStatus(before, after),
    additions: lines.filter((line) => line.kind === 'add').length,
    deletions: lines.filter((line) => line.kind === 'del').length,
    hunks,
  };
}

function fileStatus(before: string | undefined, after: string | undefined): FileStatus {
  if (before === undefined) return 'added';
  if (after === undefined) return 'deleted';
  return 'modified';
}

export type RawHunk = {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
};

/** A jsdiff hunk with old and new line numbers on every line. */
export function toHunk(hunk: RawHunk): DiffHunk {
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  const lines: DiffLine[] = [];
  for (const raw of hunk.lines) {
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === '+') {
      lines.push({ kind: 'add', text, oldNo: null, newNo: newNo++ });
    } else if (marker === '-') {
      lines.push({ kind: 'del', text, oldNo: oldNo++, newNo: null });
    } else if (marker === ' ') {
      lines.push({ kind: 'context', text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return { ...hunk, lines };
}

/** New-side line numbers a diff adds or changes (for highlighting a file view). */
export function changedLines(diff: FileDiff | undefined): ReadonlySet<number> {
  const numbers = (diff?.hunks ?? []).flatMap((hunk) =>
    hunk.lines.flatMap((line) => (line.kind === 'add' && line.newNo !== null ? [line.newNo] : [])),
  );
  return new Set(numbers);
}

/** A file's lines; a trailing newline ends the last line rather than starting another. */
export function textLines(text: string): readonly string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}
