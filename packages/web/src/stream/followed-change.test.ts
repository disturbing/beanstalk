import { describe, expect, it } from 'vitest';

import type { DiffHunk, FileDiff } from '@gitstalk/shared-ask/repo/repo-types';

import { followChange } from './followed-change';
import type { FollowedChange } from './followed-change';

/** A hunk from unified lines (`+x`, `-x`, ` x`) starting at `at` on both sides. */
function hunk(at: number, lines: readonly string[]): DiffHunk {
  const kinds = { '+': 'add', '-': 'del', ' ': 'context' } as const;
  return {
    oldStart: at,
    oldLines: lines.filter((line) => !line.startsWith('+')).length,
    newStart: at,
    newLines: lines.filter((line) => !line.startsWith('-')).length,
    lines: lines.map((line) => ({
      kind: kinds[line[0] === '+' || line[0] === '-' ? line[0] : ' '],
      text: line.slice(1),
      oldNo: null,
      newNo: null,
    })),
  };
}

function file(path: string, hunks: readonly DiffHunk[]): FileDiff {
  const count = (sign: string) =>
    hunks.flatMap((h) => h.lines).filter((l) => l.kind === (sign === '+' ? 'add' : 'del')).length;
  return { path, status: 'modified', additions: count('+'), deletions: count('-'), hunks };
}

const top = hunk(3, [' a', '-b', '+B', ' c']);
const middle = hunk(200, [' x', '+inserted one', '+inserted two', ' y']);

function stream(previous: FollowedChange | null, files: readonly FileDiff[], seq: number) {
  return followChange(previous, files, { key: `inv1:${seq}`, inv: 'inv1', mode: 'stream' });
}

function freshTexts(change: FollowedChange): string[] {
  return change.files.flatMap((f) => f.rows.filter((row) => row.fresh).map((row) => row.text));
}

function textOf(change: FollowedChange, id: number | null): string | undefined {
  return change.files.flatMap((f) => f.rows).find((row) => row.id === id)?.text;
}

function firstIds(change: FollowedChange): number[] | undefined {
  return change.files[0]?.rows.slice(0, 5).map((row) => row.id);
}

describe('followChange', () => {
  it('highlights nothing on the first snapshot seen and looks at the last hunk of the last file', () => {
    const first = stream(null, [file('a.ts', [top]), file('b.ts', [top, middle])], 1);
    expect(freshTexts(first)).toEqual([]);
    expect(first.focusPath).toBe('b.ts');
    expect(textOf(first, first.focusRow)).toBe('+inserted one');
  });

  it('follows a hunk added in the middle of a long file, not the end of the file', () => {
    const tail = hunk(400, [' p', '+appended earlier', ' q']);
    const first = stream(null, [file('shop.ts', [top, tail])], 1);
    const second = stream(first, [file('shop.ts', [top, middle, tail])], 2);
    expect(freshTexts(second)).toEqual(['+inserted one', '+inserted two']);
    expect(second.focusPath).toBe('shop.ts');
    expect(textOf(second, second.focusRow)).toBe('+inserted one');
  });

  it('keeps the ids of rows that survive, so the view updates in place', () => {
    const first = stream(null, [file('shop.ts', [top])], 1);
    const second = stream(first, [file('shop.ts', [top, middle])], 2);
    expect(firstIds(second)).toEqual(firstIds(first));
  });

  it('marks only the lines a modified hunk changed', () => {
    const first = stream(null, [file('shop.ts', [top, middle])], 1);
    const edited = hunk(3, [' a', '-b', '+Bee', ' c']);
    const second = stream(first, [file('shop.ts', [edited, middle])], 2);
    expect(freshTexts(second)).toEqual(['+Bee']);
    expect(textOf(second, second.focusRow)).toBe('+Bee');
  });

  it('moves to the file changed last and stays there while nothing changes', () => {
    const first = stream(null, [file('a.ts', [top]), file('b.ts', [middle])], 1);
    const second = stream(first, [file('a.ts', [top, middle]), file('b.ts', [middle])], 2);
    expect(second.focusPath).toBe('a.ts');
    const third = stream(second, [file('a.ts', [top, middle]), file('b.ts', [middle])], 3);
    expect(third.focusPath).toBe('a.ts');
    expect(third.focusRow).toBe(second.focusRow);
    expect(freshTexts(third)).toEqual([]);
  });

  it('starts a new invocation from nothing: its first snapshot is all fresh', () => {
    const first = stream(null, [file('shop.ts', [top])], 1);
    const rework = followChange(first, [file('shop.ts', [top])], {
      key: 'inv2:1',
      inv: 'inv2',
      mode: 'stream',
    });
    expect(freshTexts(rework)).toEqual(['-b', '+B']);
  });

  it('swaps in the committed diff without highlighting or moving the focus', () => {
    const first = stream(null, [file('shop.ts', [top])], 1);
    const second = stream(first, [file('shop.ts', [top, middle])], 2);
    const test = file('test/t1.test.ts', [hunk(1, ['+test("x")'])]);
    const committed = followChange(second, [file('shop.ts', [top, middle]), test], {
      key: 'commit',
      inv: 'inv1',
      mode: 'commit',
    });
    expect(freshTexts(committed)).toEqual([]);
    expect(committed.focusPath).toBe('shop.ts');
    expect(committed.focusRow).toBe(second.focusRow);
    expect(committed.files[0]?.rows.map((row) => row.id)).toEqual(
      second.files[0]?.rows.map((row) => row.id),
    );
  });
});
