import { describe, expect, it } from 'vitest';

import { importClosures, importSpecifiers, resolveImport } from './import-closure';

describe('import closures', () => {
  it('finds relative imports of every form, never packages', () => {
    const source = [
      "import { a } from './a';",
      "import type { B } from '../lib/b.js';",
      "export { c } from './c/index';",
      "import './side-effect';",
      "const d = require('./d');",
      "const e = await import('./e');",
      "import { test } from 'node:test';",
      "import zod from 'zod';",
    ].join('\n');

    expect(importSpecifiers(source).toSorted()).toEqual(
      ['./a', '../lib/b.js', './c/index', './side-effect', './d', './e'].toSorted(),
    );
  });

  it('resolves extensions, .js written for .ts, and index files; refuses to leave the repo', () => {
    const files = new Set(['src/a.ts', 'src/lib/b.ts', 'src/c/index.ts']);

    expect(resolveImport('src/x.test.ts', './a', files)).toBe('src/a.ts');
    expect(resolveImport('src/x.test.ts', './lib/b.js', files)).toBe('src/lib/b.ts');
    expect(resolveImport('src/x.test.ts', './c', files)).toBe('src/c/index.ts');
    expect(resolveImport('src/x.test.ts', '../../outside', files)).toBeNull();
  });

  it('walks the closure breadth-first, reading each file once and within the read budget', async () => {
    const tree: Record<string, string> = {
      'src/app.ts': "import { money } from './lib/money';\n",
      'src/lib/money.ts': 'export const money = 1;\n',
    };
    const reads: string[][] = [];

    const { closures, truncated } = await importClosures({
      known: { 'tests/app.test.ts': "import { app } from '../src/app';\n" },
      files: new Set(Object.keys(tree)),
      read: async (paths) => {
        reads.push([...paths]);
        return paths.map((path) => tree[path] ?? null);
      },
      maxReads: 10,
    });

    expect([...(closures.get('tests/app.test.ts') ?? [])].toSorted()).toEqual([
      'src/app.ts',
      'src/lib/money.ts',
      'tests/app.test.ts',
    ]);
    expect(reads).toEqual([['src/app.ts'], ['src/lib/money.ts']]);
    expect(truncated).toBe(false);
  });
});
