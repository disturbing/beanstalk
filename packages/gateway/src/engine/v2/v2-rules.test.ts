import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import { buildSummary } from '../summary';
import type { FailRule, FlakeInjector, ScriptedTask } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

/** The v2.2 rules (adaptive re-check, release on check, flake confirmation, re-executed losers). */
const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 2, ci_seconds: 60 };

function runV2(scenario: RaceScenario): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config } });
}

function stats(run: RaceRun): Record<string, unknown> {
  const block: unknown = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
  if (!isRecord(block)) throw new Error('summary has no beanstalk block');
  return block;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CHANGELOG_BASE = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');

/** A bean that writes its module and edits the changelog with `edit`. */
function changelogTask(id: string, edit: (base: string) => string): ScriptedTask {
  return soloTask(id, {
    writes: {
      [`src/${id}/index.ts`]: `export const ${id} = 1; // impl:${id}\n`,
      'CHANGELOG.md': edit(`${CHANGELOG_BASE}\n`),
    },
  });
}

const appendLine =
  (line: string) =>
  (base: string): string =>
    `${base}${line}\n`;
const prependLine =
  (line: string) =>
  (base: string): string =>
    `${line}\n${base}`;

/** Five quick beans that land first (their pre-land checks are the adaptive rule's window). */
const QUICK = ['t001', 't002', 't003', 't004', 't005'].map((id) => soloTask(id));
const QUICK_DURATIONS = { t001: 10_000, t002: 12_000, t003: 14_000, t004: 16_000, t005: 18_000 };

/** t006 and t007 edit the changelog; t007 is checked on a sprout without t006, then t006 lands. */
function overlapScenario(extra: Partial<RaceScenario> = {}): RaceScenario {
  return {
    tasks: [
      ...QUICK,
      changelogTask('t006', appendLine('t006 entry')),
      changelogTask('t007', appendLine('t007 entry')),
    ],
    baseFiles: { 'README.md': 'arena\n', 'CHANGELOG.md': `${CHANGELOG_BASE}\n` },
    durations: { ...QUICK_DURATIONS, t006: 30_000, t007: 32_000 },
    ...extra,
  };
}

const bugRule = (id: string): FailRule => ({
  markers: [`BUG:${id}`],
  file: `tests/${id}.test.ts`,
  name: `${id} works`,
});

/** t002's bug breaks t001's acceptance test once both are on the sprout (the test imports both). */
const BREAKS_T001: FailRule = {
  markers: ['impl:t001', 'BUG:t002'],
  file: 'tests/t001.test.ts',
  name: 't001 keeps working',
  reads: ['src/t001/index.ts', 'src/t002/index.ts'],
};

describe('v2.2: the adaptive re-check', () => {
  it('lands an overlapping bean without a re-check while recent pre-land checks are calm', () => {
    const run = runV2(overlapScenario({ config: { recheck: 'adaptive' } }));

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'preland.recheck')).toEqual([]);
    expect(eventsOf(run.events, 'preland.optimistic', { task: 't007' })).toHaveLength(1);
    expect(stats(run)).toMatchObject({
      preland_recheck_rule: 'adaptive',
      preland_skipped_rechecks: 1,
    });
    expect(run.state.tasks['t007']?.status).toBe('green');
  });

  it('falls back to the file rule once pre-land reds appear', () => {
    const tasks = overlapScenario().tasks.map((task) =>
      task.id === 't003'
        ? soloTask('t003', { writes: { 'src/t003/index.ts': '// impl:t003 BUG:t003\n' } })
        : task,
    );
    const run = runV2(
      overlapScenario({ tasks, rules: [bugRule('t003')], config: { recheck: 'adaptive' } }),
    );

    expect(eventsOf(run.events, 'preland.check', { task: 't003', green: false })).toHaveLength(1);
    expect(eventsOf(run.events, 'preland.recheck', { task: 't007' })).toHaveLength(1);
    expect(stats(run)).toMatchObject({ preland_skipped_rechecks: 0, preland_rechecks: 1 });
  });

  it('re-checks under the file rule, and never under the never rule', () => {
    const file = runV2(overlapScenario({ config: { recheck: 'file' } }));
    const never = runV2(overlapScenario({ config: { recheck: 'never' } }));

    expect(eventsOf(file.events, 'preland.recheck', { task: 't007' })).toHaveLength(1);
    expect(eventsOf(never.events, 'preland.recheck')).toEqual([]);
    expect(stats(never)).toMatchObject({ preland_skipped_rechecks: 0, preland_rechecks: 0 });
  });

  it('under the hunk rule, lands when the changed lines are apart and re-checks when they touch', () => {
    const scenario = (t006: (base: string) => string): RaceScenario =>
      overlapScenario({
        tasks: [
          ...QUICK,
          changelogTask('t006', t006),
          changelogTask('t007', prependLine('t007 at the top')),
        ],
        config: { recheck: 'hunk' },
      });

    const apart = runV2(scenario(appendLine('t006 at the bottom')));
    const touching = runV2(scenario(prependLine('t006 at the top too')));

    expect(eventsOf(apart.events, 'preland.optimistic', { task: 't007' })).toHaveLength(1);
    expect(stats(apart)).toMatchObject({ preland_hunk_disjoint: 1, preland_hunk_overlap: 0 });
    expect(eventsOf(touching.events, 'preland.recheck', { task: 't007' })).toHaveLength(1);
    expect(stats(touching)).toMatchObject({ preland_hunk_disjoint: 0, preland_hunk_overlap: 1 });
  });
});

/** t002's first check is red against t001; t003 and t004 are long, so slots stay busy. */
function releaseScenario(releaseOnCheck: boolean): RaceScenario {
  return {
    tasks: [
      soloTask('t001'),
      soloTask('t002', { writes: { 'src/t002/index.ts': '// impl:t002 BUG:t002\n' } }),
      soloTask('t003'),
      soloTask('t004'),
    ],
    rules: [BREAKS_T001],
    durations: { t001: 20_000, t002: 100_000, t003: 200_000, t004: 210_000 },
    config: { agent: 'claude', release_on_check: releaseOnCheck },
  };
}

describe('v2.2: the agent is released while its bean is checked', () => {
  it('starts the next task meanwhile, and resumes the red bean’s author on the next free slot', () => {
    const run = runV2(releaseScenario(true));

    const started = eventsOf(run.events, 'task.start', { task: 't002' })[0];
    expect(started).toMatchObject({ agent: 'a1' });
    const rework = run.world.instructions.find(
      (instruction) => instruction.task === 't002' && instruction.kind === 'rework',
    );
    expect(rework).toMatchObject({ slot: 'a0', resume: 'session-t002' });
    expect(rework?.workspace.branch).toBe('beans/t002');
    const t003 = eventsOf(run.events, 'task.start', { task: 't003' })[0];
    const landedT001 = eventsOf(run.events, 'land', { task: 't001' })[0];
    expect(Number(t003?.t)).toBeLessThan(Number(landedT001?.t));
    expect(stats(run)).toMatchObject({ release_on_check: true, agent_waits: 1 });
    expect(Object.values(run.state.tasks).every((task) => task.status === 'green')).toBe(true);
  });

  it('keeps the agent bound to its bean when the release is off (the A/B arm)', () => {
    const run = runV2(releaseScenario(false));

    const rework = run.world.instructions.find(
      (instruction) => instruction.task === 't002' && instruction.kind === 'rework',
    );
    expect(rework).toMatchObject({ slot: 'a1' });
    const t003 = eventsOf(run.events, 'task.start', { task: 't003' })[0];
    const landedT001 = eventsOf(run.events, 'land', { task: 't001' })[0];
    expect(Number(t003?.t)).toBeGreaterThanOrEqual(Number(landedT001?.t));
    expect(stats(run)).toMatchObject({ release_on_check: false, agent_waits: 0 });
  });
});

describe('v2.2: a red check that belongs to the sprout', () => {
  /** t001 and t002 are fine alone and fail together; t003 arrives later and is innocent. */
  const CLASH: FailRule = {
    markers: ['impl:t001', 'impl:t002'],
    file: 'tests/clash.test.ts',
    name: 'both features together',
    reads: ['src/t001/index.ts', 'src/t002/index.ts'],
  };
  const sproutGoesRed = (inheritedReds: boolean): RaceScenario => ({
    tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
    rules: [CLASH],
    durations: { t001: 10_000, t002: 12_000, t003: 100_000 },
    config: { agents: 3, inherited_reds: inheritedReds ? 'validation' : 'off' },
  });

  it('lets an innocent bean wait out the red and land after the revert, without a rework', () => {
    const run = runV2(sproutGoesRed(true));

    expect(wellFormedProblems(run.events)).toEqual([]);
    const checks = eventsOf(run.events, 'preland.check', { task: 't003' });
    expect(checks.map((check) => [check['green'], check['inherited']])).toEqual([
      [false, true],
      [true, undefined],
    ]);
    expect(checks[0]?.['failing_files']).toEqual(['tests/clash.test.ts']);
    const revert = eventsOf(run.events, 'revert')[0];
    expect(Number(checks[1]?.t)).toBeGreaterThan(Number(revert?.t));
    expect(eventsOf(run.events, 'rework.start', { task: 't003' })).toEqual([]);
    expect(run.state.tasks['t003']?.status).toBe('green');
    expect(stats(run)).toMatchObject({ inherited_reds: 'validation', inherited_red_waits: 1 });
  });

  it('spends a rework round on the same red when the rule is off', () => {
    const run = runV2(sproutGoesRed(false));

    expect(eventsOf(run.events, 'preland.check', { task: 't003', inherited: true })).toEqual([]);
    expect(eventsOf(run.events, 'rework.start', { task: 't003' })).toEqual([
      expect.objectContaining({
        reason: 'preland-red',
        failing: ['tests/clash.test.ts > both features together'],
      }),
    ]);
    expect(stats(run)).toMatchObject({ inherited_reds: 'off', inherited_red_waits: 0 });
  });
});

describe('v2.3: the sprout window', () => {
  const eight = ['t001', 't002', 't003', 't004', 't005', 't006', 't007', 't008'];
  const together = Object.fromEntries(eight.map((id, index) => [id, 10_000 + index * 500]));

  it('holds green beans beyond the window, and opens it by 2 per green validation', () => {
    const run = runV2({
      tasks: eight.map((id) => soloTask(id)),
      durations: together,
      config: { agents: 8 },
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const wait = eventsOf(run.events, 'window.wait')[0];
    expect(wait).toMatchObject({ window: 4 });
    expect(Number(wait?.['unvalidated'])).toBeLessThanOrEqual(4);
    const firstResize = eventsOf(run.events, 'window.resize')[0];
    expect(firstResize).toMatchObject({ previous: 4, window: 6, reason: 'green' });
    const early = eventsOf(run.events, 'land').filter((land) => land.t < Number(firstResize?.t));
    expect(early.every((land) => Number(land['unvalidated']) <= 4)).toBe(true);
    expect(Object.values(run.state.tasks).every((task) => task.status === 'green')).toBe(true);
  });

  it('lands every green bean at once when the window is off (v2.2)', () => {
    const run = runV2({
      tasks: eight.map((id) => soloTask(id)),
      durations: together,
      config: { agents: 8, window: 'off' },
    });

    expect(eventsOf(run.events, 'window.wait')).toEqual([]);
    expect(
      Math.max(...eventsOf(run.events, 'land').map((land) => Number(land['unvalidated']))),
    ).toBe(8);
  });
});

describe('v2.3: reds the bean did not cause, before any validation sees them', () => {
  /** t001 and t002 clash; t003 and t004 are innocent; CI is slow, so validations lag. */
  const CLASH: FailRule = {
    markers: ['impl:t001', 'impl:t002'],
    file: 'tests/clash.test.ts',
    name: 'both features together',
    reads: ['src/t001/index.ts', 'src/t002/index.ts'],
  };
  const slowCi = (config: Partial<RunConfigInput>): RaceScenario => ({
    tasks: ['t001', 't002', 't003', 't004'].map((id) => soloTask(id)),
    rules: [CLASH],
    durations: { t001: 10_000, t002: 12_000, t003: 90_000, t004: 92_000 },
    config: { agents: 4, ci_seconds: 300, preland_seconds: 60, ...config },
  });

  it('clears a failing test the bean did not touch by its read set: no rework round', () => {
    const run = runV2(slowCi({ early_tickets: false }));

    const firstRed = eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false })[0];
    const inherited = eventsOf(run.events, 'preland.check', { task: 't003', inherited: true });
    expect(Number(inherited[0]?.t)).toBeLessThan(Number(firstRed?.t));
    expect(eventsOf(run.events, 'rework.start', { task: 't003' })).toEqual([]);
    expect(run.state.tasks['t003']?.status).toBe('green');
  });

  it('opens the ticket when two beans see the same red sprout, before the validation', () => {
    const run = runV2(slowCi({}));

    const opened = eventsOf(run.events, 'ticket.open')[0];
    const firstRed = eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false })[0];
    expect(opened).toMatchObject({ early: true, failing: ['tests/clash.test.ts'] });
    expect(Number(opened?.t)).toBeLessThan(firstRed?.t ?? Infinity);
    expect(stats(run)).toMatchObject({ early_tickets_opened: 1 });
    expect(eventsOf(run.events, 'rework.start', { task: 't004' })).toEqual([]);
    expect(run.state.tasks['t004']?.status).toBe('green');
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('waits for the validation when the read set cannot clear the bean (v2.2)', () => {
    const run = runV2(slowCi({ inherited_reds: 'validation', early_tickets: false }));

    expect(
      eventsOf(run.events, 'rework.start', { task: 't003', reason: 'preland-red' }).length,
    ).toBeGreaterThan(0);
  });
});

describe('v2.2: a red validation is confirmed before revert-first', () => {
  /** Each bean is fine alone; together they fail a test that reads both. */
  const CLASH: FailRule = {
    markers: ['impl:t001', 'impl:t002'],
    file: 'tests/clash.test.ts',
    name: 'both features together',
    reads: ['src/t001/index.ts', 'src/t002/index.ts'],
  };

  it('reverts only after the same test file fails twice', () => {
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002')],
      rules: [CLASH],
      durations: { t001: 30_000, t002: 20_000 },
    });

    const red = eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false });
    expect(red).toHaveLength(2);
    expect(red[0]?.['sha']).toBe(red[1]?.['sha']);
    const opened = eventsOf(run.events, 'ticket.open')[0];
    expect(Number(opened?.seq)).toBeGreaterThan(Number(red[1]?.seq));
    expect(eventsOf(run.events, 'revert')).toHaveLength(1);
    expect(eventsOf(run.events, 'flake.suspected')).toEqual([]);
    expect(stats(run)).toMatchObject({
      validation_reruns: 1,
      flakes_suspected: 0,
      revert_first: 1,
    });
  });

  it('never takes a red re-run for a flake because a newer ticket covers its failures', () => {
    // Two validations of the red sprout overlap: the first one's confirmation opens a ticket
    // while the second one's re-run is still running. That re-run is red again, not a flake.
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
      rules: [CLASH],
      durations: { t001: 20_000, t002: 22_000, t003: 26_000 },
      config: {
        agents: 3,
        recheck: 'adaptive',
        window: 'off',
        inherited_reds: 'validation',
        early_tickets: false,
      },
    });

    expect(eventsOf(run.events, 'flake.suspected')).toEqual([]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('records a flake when the re-run fails a different test, and promotes instead of reverting', () => {
    const flaky = { sha: '', runs: 0 };
    const flakes: FlakeInjector = ({ sha, instance }) => {
      if (instance.kind !== 'ci' || (flaky.sha !== '' && sha !== flaky.sha)) return null;
      flaky.sha = sha;
      flaky.runs += 1;
      if (flaky.runs === 1) return { file: 'tests/t001.test.ts', name: 'times out now and then' };
      if (flaky.runs === 2)
        return { file: 'src/base.test.ts', name: 'also times out now and then' };
      return null;
    };

    const run = runV2({
      tasks: [soloTask('t001')],
      baseFiles: { 'README.md': 'arena\n', 'src/base.test.ts': "test('base');\n" },
      flakes,
      config: { agents: 1 },
    });

    expect(eventsOf(run.events, 'flake.suspected')).toEqual([
      expect.objectContaining({
        sha: flaky.sha,
        failing: ['tests/t001.test.ts'],
        rerun_failing: ['src/base.test.ts'],
        flaky: ['tests/t001.test.ts'],
      }),
    ]);
    expect(eventsOf(run.events, 'green.promote', { sha: flaky.sha })).toHaveLength(1);
    expect(eventsOf(run.events, 'ticket.open')).toEqual([]);
    expect(eventsOf(run.events, 'revert')).toEqual([]);
    expect(stats(run)).toMatchObject({
      validation_reruns: 1,
      flakes_suspected: 1,
      flaky_tests: { 'tests/t001.test.ts': 1 },
    });
    expect(Object.values(run.state.tasks).every((task) => task.status === 'green')).toBe(true);
  });
});

describe('v2.2: decision cards re-execute the loser', () => {
  const AMENDED_T002 = "test('t002 under D001');\n";

  it('amends the loser’s tests (proven to fail first), then re-executes it under the decision', () => {
    const run = runV2({
      tasks: [
        soloTask('t001'),
        soloTask('t002', {
          writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
          stubborn: true,
          amendTests: { 'tests/t002.test.ts': AMENDED_T002 },
        }),
      ],
      rules: [BREAKS_T001],
      durations: { t001: 20_000, t002: 100_000 },
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'decision.made')[0]).toMatchObject({
      card: 'D001',
      winner: 't001',
      loser: 't002',
      oracle: 'landed',
      outcome: 'keep-landed',
      text: expect.stringContaining("t001's behaviour stands"),
    });
    const author = run.world.instructions.find((instruction) => instruction.kind === 'test-author');
    expect(author).toMatchObject({ task: 't002', resume: null });
    expect(author?.prompt).toContain('You are the test author for task t002');
    expect(author?.prompt).toContain('t002 is not implemented in this tree');
    expect(eventsOf(run.events, 'spec.amended')[0]).toMatchObject({
      card: 'D001',
      task: 't002',
      status: 'amended',
      paths: ['tests/t002.test.ts'],
      in_place: false,
      fail_first: { failing_files: ['tests/t002.test.ts'] },
    });
    expect(eventsOf(run.events, 'rework.start', { reason: 'decision' })[0]).toMatchObject({
      task: 't002',
      card: 'D001',
      resumed: false,
    });
    const reexecution = run.world.instructions.find(
      (instruction) =>
        instruction.task === 't002' &&
        instruction.workspace.headSha === null &&
        instruction.kind === 'rework',
    );
    expect(reexecution?.resume).toBeNull();
    expect(reexecution?.workspace.acceptance).toEqual({ 'tests/t002.test.ts': AMENDED_T002 });
    expect(reexecution?.prompt).toContain('Product decision D001 (decided by the product owner)');
    expect(reexecution?.prompt).toContain('Your earlier attempt was discarded');
    expect(reexecution?.prompt).toContain(
      'Your acceptance tests were amended by the test author to match the decision (tests/t002.test.ts).',
    );
    expect(run.state.tasks['t002']?.status).toBe('green');
    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
    expect(stats(run)).toMatchObject({ amendments: 1, reexecutions: 1, cards: 1 });
  });

  it('rejects an amendment that does not parse, and re-executes the loser on its own tests', () => {
    const run = runV2({
      tasks: [
        soloTask('t001'),
        soloTask('t002', {
          writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
          stubborn: true,
          amendTests: { 'tests/t002.test.ts': 'test(SYNTAX ERROR\n' },
        }),
      ],
      rules: [BREAKS_T001],
      durations: { t001: 20_000, t002: 100_000 },
    });

    expect(eventsOf(run.events, 'spec.amended')[0]).toMatchObject({
      status: 'rejected',
      problems: ['does not parse: tests/t002.test.ts'],
    });
    expect(run.state.amendedTests['t002']).toBeUndefined();
    expect(run.state.tasks['t002']?.status).toBe('green');
  });

  it('composes decisions: a later amendment and re-execution see the earlier decision', () => {
    const run = runV2({
      tasks: [
        soloTask('t001'),
        soloTask('t002'),
        soloTask('t003', {
          writes: { 'src/t003/index.ts': '// impl:t003 BUG:t003 FOO:t003\n' },
          stubborn: true,
          amendTests: { 'tests/t003.test.ts': "test('t003 under the decisions');\n" },
          reexecutions: [
            { 'src/t003/index.ts': '// impl:t003 FOO:t003\n' },
            { 'src/t003/index.ts': '// impl:t003\n' },
          ],
        }),
      ],
      rules: [
        { markers: ['impl:t001', 'BUG:t003'], file: 'tests/t001.test.ts', name: 't001 works' },
        { markers: ['impl:t002', 'FOO:t003'], file: 'tests/t002.test.ts', name: 't002 works' },
      ],
      durations: { t001: 20_000, t002: 25_000, t003: 100_000 },
    });

    expect(eventsOf(run.events, 'decision.made').map((event) => event['winner'])).toEqual([
      't001',
      't002',
    ]);
    const authors = run.world.instructions.filter(
      (instruction) => instruction.kind === 'test-author',
    );
    expect(authors).toHaveLength(2);
    expect(authors[1]?.prompt).toContain('Earlier decisions about t003 are still in force');
    expect(authors[1]?.prompt).toContain(
      "D001 (t003 and t001): Where the two specs disagree, t001's",
    );
    const reexecutions = run.world.instructions.filter(
      (instruction) =>
        instruction.task === 't003' &&
        instruction.workspace.headSha === null &&
        instruction.kind === 'rework',
    );
    expect(reexecutions).toHaveLength(2);
    expect(reexecutions[1]?.prompt).toContain('Other decisions in force for this task:\n- D001');
    expect(run.state.tasks['t003']?.status).toBe('green');
    expect(stats(run)).toMatchObject({ cards: 2, reexecutions: 2 });
  });

  it('waits for a human, then lets the oracle answer after the timeout', () => {
    const run = runV2({
      tasks: [
        soloTask('t001'),
        soloTask('t002', {
          writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
          stubborn: true,
        }),
      ],
      rules: [BREAKS_T001],
      durations: { t001: 20_000, t002: 100_000 },
      config: { decision_mode: 'human', human_timeout_seconds: 600 },
    });

    const request = eventsOf(run.events, 'decision.request')[0];
    const made = eventsOf(run.events, 'decision.made')[0];
    expect(made).toMatchObject({ oracle: 'timeout:landed', winner: 't001', wait_seconds: 600 });
    expect(Number(made?.t) - Number(request?.t)).toBeCloseTo(600, 0);
    expect(eventsOf(run.events, 'spec.amended')[0]).toMatchObject({ status: 'none' });
    expect(run.state.tasks['t002']?.status).toBe('green');
  });
});
