/**
 * Streaming diffs (`stream_diffs`): which lines of a bean's streamed change are new since the
 * previous snapshot, and where the reader's eye should go. Every diff row keeps a stable id
 * across snapshots (rows that survive keep theirs, new rows get new ones), so the view updates
 * in place, a new row can be highlighted once, and the view can follow the hunk the agent
 * changed last instead of the end of the file.
 */
import { diffArrays } from 'diff';

import type { FileDiff } from '@beanstalk/shared-ask/repo/repo-types';

/** A unified-diff row: hunk header, added, deleted or context line. */
export type RowKind = 'h' | 'a' | 'd' | 'c';

export type DiffRow = {
  readonly id: number;
  readonly kind: RowKind;
  readonly text: string;
  /** Added or deleted by the newest snapshot (never on the first one seen, never on the commit). */
  readonly fresh: boolean;
};

export type FollowedFile = { readonly file: FileDiff; readonly rows: readonly DiffRow[] };

/** One snapshot of a bean's change as the view draws it, with where to look. */
export type FollowedChange = {
  /** The snapshot it was built from (`inv:seq`, or `commit` for the committed diff). */
  readonly key: string;
  readonly inv: string;
  readonly files: readonly FollowedFile[];
  /** The file changed last: open and followed. */
  readonly focusPath: string | null;
  /** The row to bring into view: the first changed row of the hunk changed last. */
  readonly focusRow: number | null;
  readonly nextId: number;
};

/**
 * `stream`: a new snapshot; rows it adds or deletes are fresh and the focus moves to them.
 * `commit`: the committed diff replacing the stream; rows carry over, nothing is fresh and
 * the focus stays, so the swap moves nothing on screen.
 */
export type FollowMode = 'stream' | 'commit';

/** The next state of the view for `files`, carried over from the previous one when there is one. */
export function followChange(
  previous: FollowedChange | null,
  files: readonly FileDiff[],
  snapshot: { readonly key: string; readonly inv: string; readonly mode: FollowMode },
): FollowedChange {
  // A new invocation (a rework) starts from nothing: its first snapshot is all fresh.
  const base =
    previous !== null && snapshot.mode === 'stream' && previous.inv !== snapshot.inv
      ? { ...previous, files: [] }
      : previous;
  const highlight = base !== null && snapshot.mode === 'stream';
  let nextId = base?.nextId ?? 0;
  const issue = () => nextId++;
  const followed = files.map((file) => ({
    file,
    rows: carryRows(
      base?.files.find((old) => old.file.path === file.path)?.rows ?? [],
      rowsOf(file),
      { issue, highlight },
    ),
  }));
  const focus = snapshot.mode === 'stream' ? freshFocus(followed) : null;
  const kept = focus ?? keptFocus(base, followed) ?? fallbackFocus(followed);
  return { key: snapshot.key, inv: snapshot.inv, files: followed, ...kept, nextId };
}

/** A file's hunks as unified-diff rows, without ids. */
export function rowsOf(file: FileDiff): ReadonlyArray<Omit<DiffRow, 'id' | 'fresh'>> {
  return file.hunks.flatMap((hunk) => [
    {
      kind: 'h' as const,
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    },
    ...hunk.lines.map((line) => ({
      kind: KIND[line.kind],
      text: `${PREFIX[line.kind]}${line.text}`,
    })),
  ]);
}

const KIND = { add: 'a', del: 'd', context: 'c' } as const;
const PREFIX = { add: '+', del: '-', context: ' ' } as const;

type Focus = { readonly focusPath: string | null; readonly focusRow: number | null };

/**
 * Rows of the new snapshot with ids: rows matched to the old snapshot's (a line diff over the
 * rows; hunk headers match each other whatever their numbers) keep their ids.
 */
function carryRows(
  old: readonly DiffRow[],
  next: ReadonlyArray<Omit<DiffRow, 'id' | 'fresh'>>,
  ids: { readonly issue: () => number; readonly highlight: boolean },
): DiffRow[] {
  const parts = diffArrays(old.map(matchKey), next.map(matchKey));
  const rows: DiffRow[] = [];
  let oldAt = 0;
  for (const part of parts) {
    if (part.removed) {
      oldAt += part.count;
      continue;
    }
    for (let i = 0; i < part.count; i += 1) {
      const row = next[rows.length];
      if (row === undefined) break;
      const kept = part.added ? undefined : old[oldAt + i];
      const isNew = kept === undefined;
      rows.push({
        ...row,
        id: kept?.id ?? ids.issue(),
        fresh: isNew && ids.highlight && row.kind !== 'h' && row.kind !== 'c',
      });
    }
    if (!part.added) oldAt += part.count;
  }
  return rows;
}

function matchKey(row: Omit<DiffRow, 'id' | 'fresh'>): string {
  return row.kind === 'h' ? 'h' : `${row.kind}${row.text}`;
}

/** The last file with fresh rows, at the first fresh row of its last changed hunk. */
function freshFocus(files: readonly FollowedFile[]): Focus | null {
  const changed = files.findLast((followed) => followed.rows.some((row) => row.fresh));
  if (changed === undefined) return null;
  const rows = changed.rows;
  const lastFresh = rows.findLastIndex((row) => row.fresh);
  const hunkStart = rows.slice(0, lastFresh).findLastIndex((row) => row.kind === 'h');
  const first = rows.slice(hunkStart + 1).find((row) => row.fresh);
  return { focusPath: changed.file.path, focusRow: first?.id ?? null };
}

/** The previous focus, when its file and row are still there. */
function keptFocus(previous: FollowedChange | null, files: readonly FollowedFile[]): Focus | null {
  if (previous === null || previous.focusPath === null) return null;
  const file = files.find((followed) => followed.file.path === previous.focusPath);
  if (file === undefined) return null;
  const row = file.rows.some((candidate) => candidate.id === previous.focusRow)
    ? previous.focusRow
    : lastHunkStart(file.rows);
  return { focusPath: previous.focusPath, focusRow: row };
}

/** With nothing to go on (the first snapshot seen): the last file's last hunk. */
function fallbackFocus(files: readonly FollowedFile[]): Focus {
  const last = files.at(-1);
  if (last === undefined) return { focusPath: null, focusRow: null };
  return { focusPath: last.file.path, focusRow: lastHunkStart(last.rows) };
}

function lastHunkStart(rows: readonly DiffRow[]): number | null {
  const header = rows.findLastIndex((row) => row.kind === 'h');
  const change = rows.slice(header + 1).find((row) => row.kind === 'a' || row.kind === 'd');
  return change?.id ?? rows[Math.max(header, 0)]?.id ?? null;
}
