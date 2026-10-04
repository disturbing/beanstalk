import { describe, expect, it } from 'vitest';

import { ArenaTask, acceptancePaths, couplingPartners, isSafeRepoPath } from './task';

const arenaTask = {
  id: 't002',
  title: 'Paged lists should report the total number of results',
  prompt: 'Change the shared `paginate()` helper so that it returns `{ items, total }`.',
  acceptance_tests: {
    'src/lib/pagination.test.ts': "import assert from 'node:assert/strict';\n",
    'src/catalog/total-count.test.ts': "import { describe } from 'node:test';\n",
  },
  oracle_paths: ['src/lib/pagination.ts'],
  oracle_modules: ['src/lib'],
  kind: 'feature',
  difficulty: 2,
  couplings: [
    { with: 't022', type: 'semantic', note: 'new caller of paginate()' },
    { with: 't040', type: 'textual', note: 'same lines' },
  ],
  extra_field_from_a_newer_arena: true,
};

describe('ArenaTask', () => {
  it('parses a task in the arena file format and drops unknown keys', () => {
    const task = ArenaTask.parse(arenaTask);

    expect(task.id).toBe('t002');
    expect(task).not.toHaveProperty('extra_field_from_a_newer_arena');
    expect(task.couplings).toHaveLength(2);
  });

  it('fills the optional fields with the loader defaults', () => {
    const task = ArenaTask.parse({
      id: 't1',
      title: 'T',
      prompt: 'P',
      acceptance_tests: { 'a.test.ts': '' },
    });

    expect(task).toMatchObject({ oracle_paths: [], kind: '', difficulty: 1, couplings: [] });
  });

  it('rejects acceptance tests that would be written outside the worktree', () => {
    for (const path of ['/etc/passwd', '../escape.ts', 'src/../../x.ts', '.git/config', 'a//b']) {
      const result = ArenaTask.safeParse({ ...arenaTask, acceptance_tests: { [path]: '' } });

      expect(result.success, path).toBe(false);
    }
  });

  it('rejects a task without acceptance tests', () => {
    expect(ArenaTask.safeParse({ ...arenaTask, acceptance_tests: {} }).success).toBe(false);
  });
});

describe('task helpers', () => {
  it('lists acceptance paths sorted, as the harness prompts do', () => {
    expect(acceptancePaths(ArenaTask.parse(arenaTask))).toEqual([
      'src/catalog/total-count.test.ts',
      'src/lib/pagination.test.ts',
    ]);
  });

  it('lists coupling partners, optionally of one type', () => {
    const task = ArenaTask.parse(arenaTask);

    expect(couplingPartners(task)).toEqual(['t022', 't040']);
    expect(couplingPartners(task, 'semantic')).toEqual(['t022']);
  });

  it('accepts ordinary nested paths', () => {
    expect(isSafeRepoPath('src/db/user-tax-exempt-migration.test.ts')).toBe(true);
  });
});
