import { describe, expect, it } from 'vitest';

import type { PathChange } from '@beanstalk/shared-race/read-maps';

import type { AffectedInput, Manifest, StoredReadMap } from './affected-tests';
import { affectedTests, diffManifests, isDefaultTestFile } from './affected-tests';

const TREE = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const ENV = 'node 25.9.0; runner x';

function map(test: string, fields: Partial<StoredReadMap> = {}): StoredReadMap {
  return {
    test,
    tree: TREE,
    environment: ENV,
    reads: [test],
    probes: [],
    dirs: [],
    packages: [],
    ...fields,
  };
}

function input(
  maps: readonly StoredReadMap[],
  changes: readonly PathChange[],
  extra: Partial<AffectedInput> = {},
): AffectedInput {
  return {
    maps: new Map(maps.map((entry) => [entry.test, entry])),
    universe: maps.map((entry) => entry.test),
    changes,
    base: TREE,
    environment: ENV,
    manifestOf: () => null,
    ...extra,
  };
}

const MONEY = map('src/lib/money.test.ts', {
  reads: ['src/lib/money.test.ts', 'src/lib/money.ts', 'package.json'],
  probes: ['src/lib/package.json', 'src/package.json'],
});
const CART = map('src/cart/cart.test.ts', {
  reads: ['src/cart/cart.test.ts', 'src/cart/service.ts', 'data/catalog.json'],
  dirs: ['src/plugins'],
});

describe('affectedTests', () => {
  it('selects the readers of a modified file and proves the rest unaffected', () => {
    const answer = affectedTests(input([MONEY, CART], [{ path: 'src/lib/money.ts', op: 'M' }]));

    expect(answer.affected).toEqual(['src/lib/money.test.ts']);
    expect(answer.unaffected).toEqual(['src/cart/cart.test.ts']);
    expect(answer.reasons['src/lib/money.test.ts']).toEqual({
      reason: 'read',
      path: 'src/lib/money.ts',
    });
  });

  it('selects a test whose data file changed', () => {
    const answer = affectedTests(input([MONEY, CART], [{ path: 'data/catalog.json', op: 'M' }]));

    expect(answer.affected).toEqual(['src/cart/cart.test.ts']);
  });

  it('selects a test that probed a path a change adds', () => {
    const answer = affectedTests(input([MONEY, CART], [{ path: 'src/package.json', op: 'A' }]));

    expect(answer.reasons['src/lib/money.test.ts']?.reason).toBe('probe');
    expect(answer.unaffected).toEqual(['src/cart/cart.test.ts']);
  });

  it('selects through the missing ancestors an added file creates', () => {
    // Adding src/lib/package.json/x would create src/lib/package.json as a directory.
    const nested = affectedTests(
      input([MONEY], [{ path: 'src/lib/package.json/inner.json', op: 'A' }]),
    );
    const listed = affectedTests(input([CART], [{ path: 'src/plugins/new/index.ts', op: 'A' }]));

    expect(nested.reasons['src/lib/money.test.ts']?.reason).toBe('probe');
    expect(listed.reasons['src/cart/cart.test.ts']?.reason).toBe('listing');
  });

  it('selects on a delete of a read file or of an entry of a listed directory', () => {
    const read = affectedTests(input([CART], [{ path: 'src/cart/service.ts', op: 'D' }]));
    const listed = affectedTests(input([CART], [{ path: 'src/plugins/fees.ts', op: 'D' }]));
    const elsewhere = affectedTests(input([CART], [{ path: 'src/other/fees.ts', op: 'D' }]));

    expect(read.affected).toEqual(['src/cart/cart.test.ts']);
    expect(listed.reasons['src/cart/cart.test.ts']?.reason).toBe('listing');
    expect(elsewhere.affected).toEqual([]);
  });

  it('always selects a changed test file, an unmapped one and one from another toolchain', () => {
    const answer = affectedTests(
      input([MONEY, map('src/old.test.ts', { environment: 'node 24' })], [], {
        universe: ['src/lib/money.test.ts', 'src/new.test.ts', 'src/old.test.ts'],
        changes: [{ path: 'src/lib/money.test.ts', op: 'M' }],
      }),
    );

    expect(answer.reasons).toEqual({
      'src/lib/money.test.ts': { reason: 'own-change', path: 'src/lib/money.test.ts' },
      'src/new.test.ts': { reason: 'unmapped', path: null },
      'src/old.test.ts': { reason: 'stale', path: null },
    });
    expect(answer.unknown).toEqual(['src/new.test.ts']);
  });

  it('treats a lockfile change as touching every test that loads packages', () => {
    const loader = map('test/a.test.js', { packages: ['node_modules/fastify-plugin'] });
    const prober = map('test/b.test.js', { probes: ['test/node_modules/x'] });
    const plain = map('test/c.test.js');
    const changes: PathChange[] = [{ path: 'package-lock.json', op: 'M' }];

    const answer = affectedTests(input([loader, prober, plain], changes));

    expect(answer.affected).toEqual(['test/a.test.js', 'test/b.test.js']);
    expect(answer.reasons['test/a.test.js']?.reason).toBe('dependency');
    expect(answer.unaffected).toEqual(['test/c.test.js']);
  });

  it('selects a test that loaded a package a change edits in place', () => {
    const loader = map('test/a.test.js', { packages: ['src/node_modules/@shop/utils'] });

    const answer = affectedTests(
      input([loader], [{ path: 'src/node_modules/@shop/utils/x.js', op: 'M' }]),
    );

    expect(answer.reasons['test/a.test.js']?.reason).toBe('dependency');
  });

  describe('a map traced on another tree', () => {
    const traced: Manifest = new Map([
      ['src/lib/money.ts', '1'],
      ['src/cart/service.ts', '2'],
      ['data/catalog.json', '3'],
    ]);

    it('holds when the trees differ only where the test did not look', () => {
      const base: Manifest = new Map([...traced, ['src/cart/service.ts', '9']]);
      const manifests = new Map([
        [TREE, traced],
        [BASE, base],
      ]);

      const answer = affectedTests(
        input([MONEY, CART], [], {
          base: BASE,
          manifestOf: (tree) => manifests.get(tree) ?? null,
        }),
      );

      expect(answer.affected).toEqual(['src/cart/cart.test.ts']);
      expect(answer.reasons['src/cart/cart.test.ts']).toEqual({
        reason: 'stale',
        path: 'src/cart/service.ts',
      });
      expect(answer.unaffected).toEqual(['src/lib/money.test.ts']);
    });

    it('is stale when either manifest is unknown', () => {
      const answer = affectedTests(input([MONEY], [], { base: BASE }));

      expect(answer.reasons['src/lib/money.test.ts']?.reason).toBe('stale');
    });
  });
});

describe('diffManifests', () => {
  it('names additions, modifications and deletions', () => {
    const before: Manifest = new Map([
      ['a', '1'],
      ['b', '2'],
    ]);
    const after: Manifest = new Map([
      ['a', '1'],
      ['b', '3'],
      ['c', '4'],
    ]);

    expect(diffManifests(before, after)).toEqual([
      { path: 'b', op: 'M' },
      { path: 'c', op: 'A' },
    ]);
    expect(diffManifests(after, before)).toEqual([
      { path: 'b', op: 'M' },
      { path: 'c', op: 'D' },
    ]);
  });
});

describe('isDefaultTestFile', () => {
  it("follows node's default test patterns", () => {
    for (const path of [
      'src/a.test.ts',
      'lib/b_test.cjs',
      'c-test.mjs',
      'test.js',
      'test-x.js',
      'test/helper.js',
    ])
      expect(isDefaultTestFile(path), path).toBe(true);
    for (const path of ['src/a.ts', 'node_modules/x/a.test.js', 'src/test.md', 'testing.js'])
      expect(isDefaultTestFile(path), path).toBe(false);
  });
});
