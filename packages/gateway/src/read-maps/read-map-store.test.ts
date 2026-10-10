import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { CheckReadMaps, CheckedTree, TestReadMap } from '@gitstalk/shared-race/read-maps';

import { migrateReadMaps, recordCheck, sqlReadMapIndex, treeKey } from './read-map-store';

const BEAN_TREE = 'a'.repeat(40);
const SPROUT = 'b'.repeat(40);
const ENV = 'node 25.9.0; runner abc';

function file(name: string, reads: readonly string[], extra: Partial<TestReadMap> = {}) {
  return {
    file: name,
    passed: true,
    tests: 3,
    failures: 0,
    seconds: 0.2,
    timed_out: false,
    traced: true,
    reads: [name, ...reads],
    probes: [],
    dirs: [],
    packages: [],
    hashes: {},
    ...extra,
  } satisfies TestReadMap;
}

const MAPS: CheckReadMaps = {
  status: 'traced',
  environment: ENV,
  files: [
    file('src/lib/money.test.ts', ['src/lib/money.ts']),
    file('src/cart/cart.test.ts', ['src/cart/service.ts', 'src/lib/money.ts']),
    file('src/orders/orders.test.ts', [], { traced: false }),
  ],
};

function tree(commit: string, blobs: Record<string, string>): CheckedTree {
  return { commit, extra_files: false, blobs };
}

const BLOBS = {
  'src/lib/money.ts': '1',
  'src/cart/service.ts': '2',
  'src/lib/money.test.ts': '3',
  'src/cart/cart.test.ts': '4',
};

async function inStore<T>(name: string, body: (sql: SqlStorage) => T): Promise<T> {
  const stub = env.RUNS.getByName(name);
  return runInDurableObject(stub, (_, state) => {
    migrateReadMaps(state.storage.sql);
    return body(state.storage.sql);
  });
}

describe('the read-map store', () => {
  it('answers which test files may observe a change, from the newest maps', async () => {
    const answer = await inStore('read-maps-answer', (sql) => {
      recordCheck(sql, { tree: tree(BEAN_TREE, BLOBS), readMaps: MAPS, atMs: 1 });
      return sqlReadMapIndex(sql).affectedTests({
        base: BEAN_TREE,
        changes: [{ path: 'src/cart/service.ts', op: 'M' }],
        tests: ['src/lib/money.test.ts', 'src/cart/cart.test.ts', 'src/orders/orders.test.ts'],
      });
    });

    expect(answer.affected).toEqual(['src/cart/cart.test.ts', 'src/orders/orders.test.ts']);
    expect(answer.unaffected).toEqual(['src/lib/money.test.ts']);
    expect(answer.unknown).toEqual(['src/orders/orders.test.ts']);
  });

  it('compares a map with the base through both manifests', async () => {
    const answer = await inStore('read-maps-stale', (sql) => {
      recordCheck(sql, { tree: tree(BEAN_TREE, BLOBS), readMaps: MAPS, atMs: 1 });
      // A validation of the sprout asked only for its manifest: money.ts differs there.
      recordCheck(sql, {
        tree: tree(SPROUT, { ...BLOBS, 'src/lib/money.ts': '9' }),
        readMaps: null,
        atMs: 2,
      });
      const index = sqlReadMapIndex(sql);
      return {
        onSprout: index.affectedTests({ base: SPROUT, changes: [] }),
        unknownBase: index.affectedTests({ base: 'c'.repeat(40), changes: [] }),
      };
    });

    expect(answer.onSprout.affected).toEqual(['src/cart/cart.test.ts', 'src/lib/money.test.ts']);
    expect(answer.onSprout.reasons['src/lib/money.test.ts']).toEqual({
      reason: 'stale',
      path: 'src/lib/money.ts',
    });
    expect(answer.unknownBase.unaffected).toEqual([]);
  });

  it("keeps each tree's maps apart and answers for one tree when asked", async () => {
    const result = await inStore('read-maps-trees', (sql) => {
      recordCheck(sql, { tree: tree(BEAN_TREE, BLOBS), readMaps: MAPS, atMs: 1 });
      const later: CheckReadMaps = {
        ...MAPS,
        files: [file('src/lib/money.test.ts', ['src/lib/money.ts', 'src/cart/service.ts'])],
      };
      recordCheck(sql, { tree: tree(SPROUT, BLOBS), readMaps: later, atMs: 2 });
      const index = sqlReadMapIndex(sql);
      const change = [{ path: 'src/cart/service.ts', op: 'M' as const }];
      return {
        newest: index.affectedTests({ base: SPROUT, changes: change }),
        fromBean: index.affectedTests({ base: BEAN_TREE, mapsFrom: BEAN_TREE, changes: change }),
        summary: index.summary(),
        hasMaps: [index.hasMaps(BEAN_TREE), index.hasMaps('c'.repeat(40))],
      };
    });

    expect(result.newest.affected).toEqual(['src/cart/cart.test.ts', 'src/lib/money.test.ts']);
    expect(result.fromBean.affected).toEqual(['src/cart/cart.test.ts']);
    expect(result.summary.tests).toBe(2);
    expect(result.summary.maps).toBe(3);
    expect(result.summary.manifests).toBe(2);
    expect(result.summary.environment).toBe(ENV);
    expect(result.hasMaps).toEqual([true, false]);
  });

  it('adds new default-pattern test files to the universe as unmapped', async () => {
    const answer = await inStore('read-maps-new-test', (sql) => {
      recordCheck(sql, { tree: tree(BEAN_TREE, BLOBS), readMaps: MAPS, atMs: 1 });
      return sqlReadMapIndex(sql).affectedTests({
        base: BEAN_TREE,
        changes: [
          { path: 'src/billing/coupon.test.ts', op: 'A' },
          { path: 'docs/notes.md', op: 'A' },
        ],
      });
    });

    expect(answer.affected).toEqual(['src/billing/coupon.test.ts']);
    expect(answer.reasons['src/billing/coupon.test.ts']?.reason).toBe('own-change');
  });

  it("shows one tree's maps and manifest, and nothing for an unknown tree", async () => {
    const views = await inStore('read-maps-tree-view', (sql) => {
      recordCheck(sql, { tree: tree(BEAN_TREE, BLOBS), readMaps: MAPS, atMs: 1 });
      const index = sqlReadMapIndex(sql);
      return [index.tree(BEAN_TREE), index.tree(SPROUT)];
    });

    expect(views[0]?.blobs).toEqual(BLOBS);
    expect(views[0]?.maps.map((entry) => entry.test).toSorted()).toEqual([
      'src/cart/cart.test.ts',
      'src/lib/money.test.ts',
    ]);
    expect(views[1]).toBeNull();
  });

  it('keys a tree with extra files apart from its commit', () => {
    const plain = tree(BEAN_TREE, BLOBS);
    const extra = { ...plain, extra_files: true, blobs: { ...BLOBS, 'x.test.ts': '5' } };

    expect(treeKey(plain)).toBe(BEAN_TREE);
    expect(treeKey(extra)).toMatch(new RegExp(`^${BEAN_TREE}\\+[0-9a-f]+$`));
  });
});
