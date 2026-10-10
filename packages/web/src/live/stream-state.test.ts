import { describe, expect, it } from 'vitest';

import type {
  BeanStreamSocketMessage,
  BeanStreamSummary,
  StreamFile,
} from '@gitstalk/shared-ask/forge/bean-stream';
import { toFileDiff } from '@gitstalk/shared-ask/forge/bean-stream';

import type { LiveStreams } from './stream-state';
import { applyStreamMessage, beanView, seedStream, writingSummaries } from './stream-state';

const INV = 'inv0003-initial';

function summary(seq: number, inv = INV): BeanStreamSummary {
  return {
    type: 'bean.streaming',
    task: 't001',
    inv,
    agent: 'a0',
    seq,
    t: 10 + seq,
    files: [],
    additions: 0,
    deletions: 0,
    truncated: false,
    redacted: 0,
  };
}

function file(path: string, text: string): StreamFile {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    patch: `@@ -1 +1 @@\n-old\n+${text}\n`,
  };
}

function apply(messages: readonly BeanStreamSocketMessage[], from: LiveStreams = new Map()) {
  return messages.reduce(applyStreamMessage, from);
}

function fileA(streams: LiveStreams) {
  return beanView(streams.get('t001'))?.files.find((f) => f.path === 'src/a.ts');
}

function added(streams: LiveStreams): Record<string, string> {
  const files = beanView(streams.get('t001'))?.files ?? [];
  return Object.fromEntries(
    files.map((diff) => [
      diff.path,
      diff.hunks[0]?.lines.find((l) => l.kind === 'add')?.text ?? '',
    ]),
  );
}

describe('the live streams state', () => {
  const start: readonly BeanStreamSocketMessage[] = [
    summary(1),
    {
      type: 'bean.snapshot',
      task: 't001',
      inv: INV,
      seq: 1,
      files: [file('src/b.ts', 'b1'), file('src/a.ts', 'a1'), file('src/c.ts', 'c1')],
    },
  ];

  it('applies a patch to the held snapshot, re-parsing only the changed files', () => {
    const before = apply(start);
    const after = apply(
      [
        summary(2),
        {
          type: 'bean.patch',
          task: 't001',
          inv: INV,
          seq: 2,
          base_seq: 1,
          files: [file('src/b.ts', 'b2'), file('src/d.ts', 'd1')],
          removed: ['src/c.ts'],
        },
      ],
      before,
    );

    expect(added(after)).toEqual({ 'src/a.ts': 'a1', 'src/b.ts': 'b2', 'src/d.ts': 'd1' });
    expect(beanView(after.get('t001'))?.files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/d.ts',
    ]);
    expect(fileA(after)).toBe(fileA(before));
    expect(beanView(after.get('t001'))?.summary.seq).toBe(2);
  });

  it('skips a patch on a snapshot it does not hold, and takes a full one', () => {
    const before = apply(start);
    const skipped = apply(
      [
        {
          type: 'bean.patch',
          task: 't001',
          inv: INV,
          seq: 5,
          base_seq: 4,
          files: [file('src/a.ts', 'a5')],
          removed: [],
        },
      ],
      before,
    );
    const full = apply(
      [
        {
          type: 'bean.patch',
          task: 't001',
          inv: INV,
          seq: 6,
          base_seq: 0,
          files: [file('src/z.ts', 'z6')],
          removed: [],
        },
      ],
      skipped,
    );

    expect(skipped).toBe(before);
    expect(added(full)).toEqual({ 'src/z.ts': 'z6' });
  });

  it('keeps the last files after the end, and drops them for a new invocation', () => {
    const ended = apply(
      [...start, { type: 'bean.streaming.end', task: 't001', inv: INV, t: 30 }],
      new Map(),
    );
    const rework = apply([summary(1, 'inv0009-rework')], ended);

    expect(writingSummaries(ended).size).toBe(0);
    expect(beanView(ended.get('t001'))).not.toBeNull();
    expect(writingSummaries(rework).get('t001')?.inv).toBe('inv0009-rework');
    expect(beanView(rework.get('t001'))).toBeNull();
  });

  it('seeds the first paint unless the feed is already ahead', () => {
    const seeded = seedStream(apply([summary(2)]), {
      summary: summary(2),
      files: [toFileDiff(file('src/a.ts', 'seed'))],
    });
    const behind = seedStream(apply(start), {
      summary: summary(1),
      files: [toFileDiff(file('src/a.ts', 'old'))],
    });

    expect(added(seeded)).toEqual({ 'src/a.ts': 'seed' });
    expect(added(behind)).toEqual({ 'src/a.ts': 'a1', 'src/b.ts': 'b1', 'src/c.ts': 'c1' });
  });
});
