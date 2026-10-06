import { describe, expect, it } from 'vitest';

import { RunId, Sha, TaskId } from '@beanstalk/shared-race/ids';

import { CardId } from '../race/race-events';
import type { RepoTree } from '../repo/repo-types';
import type { ForgeSource } from './forge-source';
import { memoSource } from './memo-source';

const run = RunId.parse('k3x9q2m7ab');
const sha = Sha.parse('a'.repeat(40));

function unused(): Promise<never> {
  return Promise.reject(new Error('not used by these tests'));
}

/** A source that counts its calls; `repoTree` fails while `failing.tree` is set. */
function countingSource() {
  const calls: string[] = [];
  const failing = { tree: false };
  const source: ForgeSource = {
    listRuns: unused,
    runOptions: unused,
    runEvents: (_run, after, limit) => {
      calls.push(`runEvents ${after} ${limit}`);
      return Promise.resolve({ events: [], nextAfter: after, done: true });
    },
    repoTree: (_run, ref): Promise<RepoTree> => {
      calls.push(`repoTree ${ref}`);
      if (failing.tree) return Promise.reject(new Error('the gateway is busy'));
      return Promise.resolve({ ref, sha, files: [{ path: 'src/app.ts', size: 0 }] });
    },
    repoFile: unused,
    repoDiff: unused,
    repoLog: unused,
    repoGrep: (_run, ref, pattern, paths) => {
      calls.push(`repoGrep ${ref} ${pattern} ${(paths ?? []).join(',')}`);
      return Promise.resolve([]);
    },
    beansByPath: (_run, paths) => {
      calls.push(`beansByPath ${paths.join(',')}`);
      return Promise.resolve([]);
    },
    beanDetail: unused,
    decisions: unused,
    testsFor: unused,
    decide: () => {
      calls.push('decide');
      return Promise.resolve({ ok: true });
    },
  };
  return { source, calls, failing };
}

describe('the per-request memo of a source', () => {
  it('reads the same thing once, however many parts of the answer ask for it', async () => {
    const counting = countingSource();
    const memo = memoSource(counting.source);

    const [first, second] = await Promise.all([
      memo.repoTree(run, 'sprout'),
      memo.repoTree(run, 'sprout'),
    ]);
    await memo.beansByPath(run, []);
    await memo.beansByPath(run, []);
    await memo.runEvents(run, 0, 5000);
    await memo.runEvents(run, 0, 5000);

    expect(first).toBe(second);
    expect(counting.calls).toEqual(['repoTree sprout', 'beansByPath ', 'runEvents 0 5000']);
  });

  it('reads again when the arguments differ', async () => {
    const counting = countingSource();
    const memo = memoSource(counting.source);

    await memo.repoTree(run, 'sprout');
    await memo.repoTree(run, 'stalk');
    await memo.repoGrep(run, 'sprout', 'coupon');
    await memo.repoGrep(run, 'sprout', 'coupon', ['src/coupons.ts']);

    expect(counting.calls).toEqual([
      'repoTree sprout',
      'repoTree stalk',
      'repoGrep sprout coupon ',
      'repoGrep sprout coupon src/coupons.ts',
    ]);
  });

  it('does not keep a failed read, so the next call tries again', async () => {
    const counting = countingSource();
    const memo = memoSource(counting.source);
    counting.failing.tree = true;

    await expect(memo.repoTree(run, 'sprout')).rejects.toThrow('the gateway is busy');
    counting.failing.tree = false;
    const tree = await memo.repoTree(run, 'sprout');

    expect(tree.files).toHaveLength(1);
    expect(counting.calls).toEqual(['repoTree sprout', 'repoTree sprout']);
  });

  it('forgets every read after a decision, since the run has moved', async () => {
    const counting = countingSource();
    const memo = memoSource(counting.source);

    await memo.repoTree(run, 'sprout');
    await memo.decide(run, CardId.parse('D001'), { winner: TaskId.parse('t001'), actor: 'coop' });
    await memo.repoTree(run, 'sprout');

    expect(counting.calls).toEqual(['repoTree sprout', 'decide', 'repoTree sprout']);
  });
});
