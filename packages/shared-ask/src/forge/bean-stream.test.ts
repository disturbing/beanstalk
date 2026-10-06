import { describe, expect, it } from 'vitest';

import { beanStreamView, currentStreams } from './bean-stream';

const SUMMARY = {
  type: 'bean.streaming',
  task: 't001',
  inv: 'inv0001-initial',
  agent: 'a0',
  seq: 2,
  t: 12.5,
  files: [{ path: 'src/cart.ts', status: 'modified', additions: 1, deletions: 1 }],
  additions: 1,
  deletions: 1,
  truncated: false,
  redacted: 0,
};

function binding(answer: unknown) {
  return {
    beanStreams: () => Promise.resolve({ ok: true, value: [SUMMARY] }),
    beanStream: () => Promise.resolve({ ok: true, value: answer }),
  };
}

describe('streamed bean changes', () => {
  it('turns a snapshot’s hunk text into numbered diff lines', async () => {
    const view = await beanStreamView(
      binding({
        summary: SUMMARY,
        files: [
          {
            path: 'src/cart.ts',
            status: 'modified',
            additions: 1,
            deletions: 1,
            binary: false,
            patch:
              '@@ -1,2 +1,2 @@\n export const a = 1;\n-export const b = 2;\n+export const b = 3;\n',
          },
          {
            path: 'logo.png',
            status: 'added',
            additions: 0,
            deletions: 0,
            binary: true,
            patch: null,
          },
        ],
      }),
      'r1',
      't001',
    );

    const lines = view?.files[0]?.hunks[0]?.lines ?? [];
    expect(lines.map((line) => [line.kind, line.text, line.newNo])).toEqual([
      ['context', 'export const a = 1;', 1],
      ['del', 'export const b = 2;', null],
      ['add', 'export const b = 3;', 2],
    ]);
    expect(view?.files[1]?.hunks).toEqual([]);
  });

  it('reads nothing from a gateway that predates streaming', async () => {
    expect(await currentStreams({}, 'r1')).toEqual([]);
    expect(await beanStreamView({}, 'r1', 't001')).toBeNull();
    expect(await currentStreams(binding(null), 'r1')).toHaveLength(1);
  });
});
