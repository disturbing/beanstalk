import { describe, expect, it } from 'vitest';

import {
  fixerPrompt,
  initialPrompt,
  prelandRedPrompt,
  reworkConflictPrompt,
  reworkRedPrompt,
} from './prompts';

// Expected strings were produced by research/race/harness/prompts.py (and preland_red) for
// the same inputs; the cloud race must send byte-identical prompts.
const task = {
  id: 't002',
  title: 'Paged lists should report the total number of results',
  prompt: '  API clients cannot tell how many pages there are.\nUse `x-total-count`.  \n',
  acceptance_tests: { 'src/lib/pagination.test.ts': 'x', 'src/catalog/total-count.test.ts': 'y' },
};

const ACCEPTANCE =
  'Acceptance tests are in src/catalog/total-count.test.ts, src/lib/pagination.test.ts. Make them pass ' +
  "without breaking other tests. Run `node --test`. Don't edit the acceptance tests. Keep changes minimal. " +
  "Don't stage or commit; the harness commits your changes.\n";
const conflictBody = (files: string): string =>
  'Your change could not be merged: main moved on and conflicts with it. The merge of main into your ' +
  `branch is in progress in this worktree; conflict markers are in: ${files}.\n\nResolve every conflict ` +
  'so that your change and the changes already on main both keep working, and remove all conflict ' +
  'markers. ' +
  ACCEPTANCE;

const HEAD =
  'You are working on: Paged lists should report the total number of results\n\n' +
  'API clients cannot tell how many pages there are.\nUse `x-total-count`.\n\n';

describe('prompts (ported verbatim from prompts.py)', () => {
  it('builds the initial prompt', () => {
    expect(initialPrompt(task)).toBe(
      'Paged lists should report the total number of results\n\nAPI clients cannot tell how many pages ' +
        'there are.\nUse `x-total-count`.\n\n' +
        ACCEPTANCE,
    );
  });

  it('builds the conflict prompt for a fresh and a resumed session', () => {
    expect(
      reworkConflictPrompt(task, ['src/lib/pagination.ts', 'CHANGELOG.md'], 'main', false),
    ).toBe(HEAD + conflictBody('src/lib/pagination.ts, CHANGELOG.md'));
    expect(reworkConflictPrompt(task, ['src/lib/pagination.ts'], 'main', true)).toBe(
      conflictBody('src/lib/pagination.ts'),
    );
  });

  it('builds the red prompt, with a placeholder when no test is named', () => {
    const tail =
      'The latest main has been merged into this worktree. Fix your change so the whole suite passes ' +
      "(your acceptance tests and everyone else's). Other teams' acceptance tests describe behaviour that " +
      'must keep working. ' +
      ACCEPTANCE;

    expect(
      reworkRedPrompt(
        task,
        ['src/a.test.ts > adds', 'src/b.test.ts > keeps'],
        '\nfailing tests:\n  x\n',
        'main',
        false,
      ),
    ).toBe(
      `${HEAD}The merge queue rejected your change: merged with the latest main and the other queued changes, ` +
        'these tests failed:\n- src/a.test.ts > adds\n- src/b.test.ts > keeps\n\nOutput:\n```\nfailing tests:\n  x\n```\n\n' +
        tail,
    );
    expect(reworkRedPrompt(task, [], '', 'main', true)).toBe(
      'The merge queue rejected your change: merged with the latest main and the other queued changes, ' +
        'these tests failed:\n- (the suite failed; see the output)\n\nOutput:\n```\n\n```\n\n' +
        tail,
    );
  });

  it('builds the fixer prompt with and without suspects', () => {
    const rules =
      'Make the whole suite pass (`node --test`) with a minimal change that preserves the intent of every ' +
      "suspect change: don't revert features. Don't edit acceptance tests";

    expect(
      fixerPrompt(
        { id: 'R001', attempt: 2, failingTests: ['src/a.test.ts > adds'], output: ' boom \n' },
        [
          {
            sha: '0123456789abcdef',
            label: 't002',
            title: 'Paged',
            intent: ' do it \n',
            diff: '+x\n',
          },
        ],
        ['src/a.test.ts'],
      ),
    ).toBe(
      'The fast trunk is red. Repair ticket R001 (attempt 2).\n\nFailing tests:\n- src/a.test.ts > adds\n\n' +
        'Output:\n```\nboom\n```\n\nSuspect commits: unvalidated changes whose writes intersect what the ' +
        "failing tests read, plus any change that landed after a suspect's snapshot and wrote the same code " +
        '(marked):\n- 0123456789 t002: Paged\n  Intent: do it\n  Diff:\n```diff\n+x\n```\n\n' +
        `${rules} (src/a.test.ts). Don't stage or commit; the harness commits your changes.\n`,
    );
    expect(fixerPrompt({ id: 'R002', attempt: 1, failingTests: [], output: '' }, [], [])).toBe(
      'The fast trunk is red. Repair ticket R002 (attempt 1).\n\nFailing tests:\n- (see output)\n\n' +
        'Output:\n```\n\n```\n\nNo suspect could be isolated; the failure appeared between the last green ' +
        `commit and the head.\n\n${rules} (test files named in the tickets). Don't stage or commit; the ` +
        'harness commits your changes.\n',
    );
  });

  it('builds the pre-land red prompt', () => {
    expect(prelandRedPrompt(task, ['src/a.test.ts > adds'], 'out', false)).toBe(
      `${HEAD}Your change was not landed. Merged onto the latest trunk, these tests failed:\n` +
        '- src/a.test.ts > adds\n\nOutput:\n```\nout\n```\n\nThe latest trunk has been merged into this ' +
        "worktree. Fix your change so the whole suite passes. Acceptance tests (yours and other teams') are " +
        'protected: edits to them are discarded before landing, so change the code, not the tests. Other ' +
        "teams' acceptance tests describe behaviour that must keep working. " +
        ACCEPTANCE,
    );
  });
});
