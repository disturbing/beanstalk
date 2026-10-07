import { describe, expect, it } from 'vitest';

import { TaskId } from '@beanstalk/shared-race/ids';
import { RunConfig } from '@beanstalk/shared-race/run-config';
import { DEFAULT_SUITE, RunSuite, suiteCommand } from '@beanstalk/shared-race/suite';

import fastify from '../../test/fixtures/fastify-prompts.json';
import {
  fixerPrompt,
  informedConflictPrompt,
  informedRedPrompt,
  initialPrompt,
  prelandRedPrompt,
  reworkConflictPrompt,
  reworkRedPrompt,
  syncPrompt,
  testAuthorPrompt,
} from './prompts';

// Expected strings were produced by research/race/harness/prompts.py (and preland_red) for
// the same inputs; the cloud race must send byte-identical prompts.
const task = {
  id: 't002',
  title: 'Paged lists should report the total number of results',
  prompt: '  API clients cannot tell how many pages there are.\nUse `x-total-count`.  \n',
  acceptance_tests: { 'src/lib/pagination.test.ts': 'x', 'src/catalog/total-count.test.ts': 'y' },
  suite: DEFAULT_SUITE,
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

  it("builds v2 conflict prompt with both sides of each hunk and the other side's author", () => {
    const prompt = informedConflictPrompt(
      task,
      {
        files: ['src/lib/pagination.ts'],
        hunks: [{ path: 'src/lib/pagination.ts', sprout: 'const a = 1;\n', bean: 'const a = 2;' }],
        authors: [
          {
            task: 't001',
            title: 'Limit coupons',
            intent: '  Cap redemptions.\n Per coupon. ',
            paths: ['src/lib/pagination.ts'],
          },
        ],
      },
      true,
    );

    expect(prompt).toBe(
      'Your change could not be merged: the trunk moved on and conflicts with it. The merge of the ' +
        'trunk into your branch is in progress in this worktree; conflict markers are in: ' +
        "src/lib/pagination.ts.\n\nThe conflicting hunks (the trunk's side, then yours):\n" +
        'src/lib/pagination.ts:\n```\n<<<<<<< trunk\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> yours\n```\n\n' +
        "The trunk's side was written by these landed changes:\n" +
        '- t001 "Limit coupons" (src/lib/pagination.ts): Cap redemptions. Per coupon.\n\n' +
        'Resolve every conflict so that your change and the changes already on the trunk both keep ' +
        'working: keep both intents, never drop one side to make the merge compile, and remove all ' +
        'conflict markers. ' +
        ACCEPTANCE,
    );
  });

  it('says no more than the harness prompt when the runner sent no hunks', () => {
    const prompt = informedConflictPrompt(task, { files: ['a.ts'], hunks: [], authors: [] }, false);

    expect(prompt.startsWith(HEAD)).toBe(true);
    expect(prompt).not.toContain('hunks');
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
        { acceptance: ['src/a.test.ts'], suite: DEFAULT_SUITE },
      ),
    ).toBe(
      'The fast trunk is red. Repair ticket R001 (attempt 2).\n\nFailing tests:\n- src/a.test.ts > adds\n\n' +
        'Output:\n```\nboom\n```\n\nSuspect commits: unvalidated changes whose writes intersect what the ' +
        "failing tests read, plus any change that landed after a suspect's snapshot and wrote the same code " +
        '(marked):\n- 0123456789 t002: Paged\n  Intent: do it\n  Diff:\n```diff\n+x\n```\n\n' +
        `${rules} (src/a.test.ts). Don't stage or commit; the harness commits your changes.\n`,
    );
    expect(
      fixerPrompt({ id: 'R002', attempt: 1, failingTests: [], output: '' }, [], {
        acceptance: [],
        suite: DEFAULT_SUITE,
      }),
    ).toBe(
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
        'worktree. Fix your change so the whole suite passes. Acceptance tests (yours and those of ' +
        'changes that already landed) are protected: edits to them are discarded before landing, so make ' +
        'them pass by changing the code, not those tests. Other existing tests are not protected: you may ' +
        'update one whose expectations your change intentionally alters. Other ' +
        "teams' acceptance tests describe behaviour that must keep working. " +
        ACCEPTANCE,
    );
  });

  it('keeps the protection to the restored acceptance tests in the informed red prompt', () => {
    const prompt = informedRedPrompt(task, ['src/a.test.ts > adds'], 'out', [], true);

    expect(prompt).toContain('Acceptance tests (yours and those of changes that already landed)');
    expect(prompt).toContain('edits to them are discarded before landing');
    expect(prompt).toContain(
      'you may update one whose expectations your change intentionally alters',
    );
    expect(prompt).not.toContain('change the code, not the tests.');
  });
});

/**
 * A real-task arena: the run's suite as `remote.py` sends it, and prompts the harness rendered
 * for three fastify tasks with that suite active (`research/race/gateway_fixture.py`, which the
 * Python tests keep current). The GitHub arm sends the harness's prompts, so these are what
 * make the two arms' agents read the same words.
 */
describe('fastify prompts (byte-identical to the harness and the GitHub arm)', () => {
  const suite = RunSuite.parse(fastify.suite);
  const tasks = fastify.tasks.map((definition) => ({ ...definition, suite }));

  it('takes the suite remote.py sends, as a run config field', () => {
    const config = RunConfig.parse({
      policy: 'beanstalk-v2',
      suite: fastify.suite,
      tasks: fastify.tasks,
    });

    expect(config.suite).toEqual(suite);
    expect(suite.deps).toBe('fastify');
    expect(suiteCommand(suite)).toBe(fastify.suite_command);
  });

  it.each(tasks.map((task) => [task.id, task] as const))(
    'renders %s as the harness does',
    (id, task) => {
      const expected = fastify.prompts[id as keyof typeof fastify.prompts];
      const { failing, output } = fastify;

      expect(initialPrompt(task)).toBe(expected.initial);
      expect(reworkConflictPrompt(task, ['lib/route.js'], 'main', false)).toBe(
        expected.rework_conflict,
      );
      expect(reworkRedPrompt(task, failing, output, 'main', true)).toBe(expected.rework_red);
      expect(prelandRedPrompt(task, failing, output, false)).toBe(expected.preland_red);
    },
  );

  it('gives the test hint and the files command in beanstalk-only prompts too', () => {
    const [task] = tasks;
    if (task === undefined) throw new Error('fixture has no tasks');
    const sync = syncPrompt(
      task,
      [{ task: 't002', title: 'Other', files: ['lib/route.js'] }],
      true,
    );
    const author = testAuthorPrompt(
      { ...task, id: TaskId.parse('t001') },
      { card: 'C1', text: 'decided' },
      {
        winner: { task: 't002', title: 'Other', intent: 'x', diff: '+x' },
        failing: [],
        output: '',
        inForce: [],
        inPlace: true,
      },
    );

    expect(sync).toContain(`(no conflicts). ${suite.test_hint} If the merged changes`);
    expect(sync).not.toContain('Run `node --test`.');
    expect(author).toContain(
      '`node --no-use-env-proxy --test test/route.6.pr6372.test.js test/route.7.pr6372.test.js`',
    );
  });
});
