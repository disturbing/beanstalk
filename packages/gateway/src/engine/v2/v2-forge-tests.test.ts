import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@gitstalk/shared-race/run-config';

import { STALK_REF } from '../refs';
import type { FailRule } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 2, ci_seconds: 60 };

function runV2(scenario: RaceScenario): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config } });
}

/** A file of the final stalk, as the run repo holds it. */
function stalkFile(run: RaceRun, path: string): string | undefined {
  const sha = run.world.repoRef(STALK_REF);
  return sha === undefined ? undefined : run.world.git.get(sha).files.get(path);
}

/**
 * E1's silent wrong green: t001's implementer rounds the refund per line (`BUG:t001`). The
 * given test never looks at rounding, so it passes; only a test that pins the rounding fails.
 */
const ROUNDS_PER_LINE: FailRule = {
  markers: ['BUG:t001'],
  file: 'tests/t001.test.ts',
  name: 'refunds round once per tax rate',
  reads: ['src/t001/index.ts'],
  onlyIf: 'pins the rounding',
};
const PINNING_TEST = "test('t001'); // pins the rounding of three $19.99 lines\n";

function weakTests(config: Partial<RunConfigInput>, authorTests?: Record<string, string>) {
  return runV2({
    tasks: [
      soloTask('t001', {
        writes: { 'src/t001/index.ts': 'export const t001 = 1; // impl:t001 BUG:t001\n' },
        ...(authorTests === undefined ? {} : { authorTests }),
      }),
    ],
    rules: [ROUNDS_PER_LINE],
    config: { agents: 1, ...config },
  });
}

describe('v2.5: tests first', () => {
  it('without it, the weak given test lets the bug onto the stalk with every signal green', () => {
    const run = weakTests({});

    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(eventsOf(run.events, 'preland.check', { green: false })).toEqual([]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
    expect(stalkFile(run, 'src/t001/index.ts')).toContain('BUG:t001');
  });

  it('a fail-first author pins the behaviour: the bug is caught before it lands', () => {
    const run = weakTests({ tests_first: true }, { 'tests/t001.test.ts': PINNING_TEST });

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'tests.first')).toEqual([
      expect.objectContaining({
        task: 't001',
        status: 'accepted',
        accepted: ['tests/t001.test.ts'],
        failing_tests: ['tests/t001.test.ts > t001 is implemented'],
        problems: [],
      }),
    ]);
    const [author, implementer] = run.world.instructions;
    expect(author).toMatchObject({ kind: 'test-first', task: 't001' });
    expect(author?.workspace).toMatchObject({ acceptance: {}, headSha: null });
    expect(author?.prompt).toContain('You write the acceptance tests for an issue');
    expect(implementer?.kind).toBe('initial');
    expect(implementer?.workspace.acceptance).toEqual({ 'tests/t001.test.ts': PINNING_TEST });
    const checks = eventsOf(run.events, 'preland.check', { task: 't001' });
    expect(checks.map((check) => check['green'])).toEqual([false, true]);
    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(stalkFile(run, 'src/t001/index.ts')).toContain('OK:t001');
    expect(run.state.authoredTests['t001']).toEqual({ 'tests/t001.test.ts': PINNING_TEST });
  });

  it('falls back to the given tests when the author’s tests pass before the change', () => {
    const vacuous = { 'tests/t001.test.ts': "test('t001'); // VACUOUS\n" };
    const run = weakTests({ tests_first: true }, vacuous);

    expect(eventsOf(run.events, 'tests.first')).toEqual([
      expect.objectContaining({
        status: 'fallback',
        files: ['tests/t001.test.ts'],
        accepted: [],
        problems: ['tests/t001.test.ts: passes on the base, where the task is not implemented'],
      }),
    ]);
    const implementer = run.world.instructions.find((inv) => inv.kind === 'initial');
    expect(implementer?.workspace.acceptance).toEqual({ 'tests/t001.test.ts': "test('t001');\n" });
    expect(run.state.authoredTests).toEqual({});
    expect(run.state.tasks['t001']?.status).toBe('green');
  });
});

/**
 * A semantic clash between files that do not overlap: t002's change is fine alone, but with
 * t001 on the sprout it breaks t001's test (`BUG:t002`). t001 lands while t002 is checked on
 * the old sprout, so t002's own check is green and the files shared with what landed are none.
 */
const BREAKS_T001: FailRule = {
  markers: ['impl:t001', 'BUG:t002'],
  file: 'tests/t001.test.ts',
  name: 't001 keeps working next to t002',
  reads: ['src/t001/index.ts', 'src/t002/index.ts'],
};

function clash(config: Partial<RunConfigInput>): RaceRun {
  return runV2({
    tasks: [
      soloTask('t001'),
      soloTask('t002', {
        writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
      }),
    ],
    rules: [BREAKS_T001],
    durations: { t001: 10_000, t002: 12_000 },
    config,
  });
}

describe('v2.5: a targeted check of the exact landing tree', () => {
  it('without it, the bean lands unchecked on the moved sprout and the stalk validation goes red', () => {
    const run = clash({});

    expect(eventsOf(run.events, 'preland.optimistic', { task: 't002' })).toHaveLength(1);
    expect(
      eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false }).length,
    ).toBeGreaterThan(0);
    expect(eventsOf(run.events, 'revert')).toHaveLength(1);
    expect(run.state.tasks['t002']?.status).toBe('dropped');
  });

  it('catches the clash before landing: the author repairs it and both ship', () => {
    const run = clash({ targeted_landing_check: true });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const checks = eventsOf(run.events, 'preland.check', { task: 't002' });
    expect(checks.map((check) => [check['green'], check['targets']])).toEqual([
      [true, undefined],
      [false, ['tests/t001.test.ts']],
      [true, undefined],
    ]);
    expect(run.world.jobs).toContainEqual(
      expect.objectContaining({ kind: 'check', only: ['tests/t001.test.ts'] }),
    );
    expect(eventsOf(run.events, 'rework.start', { task: 't002' })).toHaveLength(1);
    expect(eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false })).toEqual([]);
    expect(run.state.tasks['t001']?.status).toBe('green');
    expect(run.state.tasks['t002']?.status).toBe('green');
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('runs nothing extra when no known test reads both sides', () => {
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002')],
      durations: { t001: 10_000, t002: 12_000 },
      config: { targeted_landing_check: true },
    });

    expect(eventsOf(run.events, 'preland.optimistic', { task: 't002' })).toHaveLength(1);
    expect(eventsOf(run.events, 'preland.check').filter((check) => 'targets' in check)).toEqual([]);
  });
});
