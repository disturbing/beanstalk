import { describe, expect, it } from 'vitest';

import { Sha, TaskId } from '@gitstalk/shared-race/ids';
import type { RunConfigInput } from '@gitstalk/shared-race/run-config';

import { buildSummary } from '../summary';
import type { FailRule } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, v2StepAfter, wellFormedProblems } from '../testing/scenario';
import { maybeValidate } from './v2-validator';

const REUSE: Partial<RunConfigInput> = {
  policy: 'beanstalk-v2',
  agents: 2,
  ci_seconds: 60,
  reuse_checks: true,
};

function runV2(scenario: RaceScenario, config: Partial<RunConfigInput> = REUSE): RaceRun {
  return runRace({ ...scenario, config: { ...config, ...scenario.config } });
}

function validationsOf(run: RaceRun, idx: number): number {
  return eventsOf(run.events, 'ci.start', { purpose: 'validate', trunk_idx: idx }).length;
}

/** Each bean is fine alone; together they fail a test that reads both. */
const CLASH: FailRule = {
  markers: ['impl:t001', 'impl:t002'],
  file: 'tests/clash.test.ts',
  name: 'both features together',
  reads: ['src/t001/index.ts', 'src/t002/index.ts'],
};

describe('v2: check reuse (`reuse_checks`)', () => {
  it('counts a bean landed on the head it was checked on as green without CI', () => {
    const run = runV2({ tasks: [soloTask('t001')], config: { agents: 1 } });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const land = eventsOf(run.events, 'land')[0];
    const check = eventsOf(run.events, 'preland.check')[0];
    expect(land?.['sha']).toBe(check?.['sha']);
    expect(eventsOf(run.events, 'check.reused')).toEqual([
      expect.objectContaining({
        sha: land?.['sha'],
        trunk_idx: 0,
        task: 't001',
        source: 'preland',
        cancelled: [],
      }),
    ]);
    expect(validationsOf(run, 0)).toBe(0);
    expect(eventsOf(run.events, 'green.promote')[0]).toMatchObject({
      sha: land?.['sha'],
      tasks: ['t001'],
    });
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('validates every head on CI when it is off', () => {
    const run = runV2(
      { tasks: [soloTask('t001')], config: { agents: 1 } },
      { ...REUSE, reuse_checks: false },
    );

    expect(eventsOf(run.events, 'check.reused')).toEqual([]);
    expect(validationsOf(run, 0)).toBe(1);
  });

  it('still validates a bean that landed on a moved sprout without a re-check', () => {
    // t002 lands first; t001 was checked on the base, so its landed commit is a re-squash.
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002')],
      durations: { t001: 30_000, t002: 20_000 },
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'preland.optimistic', { task: 't001' })).toHaveLength(1);
    expect(eventsOf(run.events, 'check.reused').map((event) => event['task'])).toEqual(['t002']);
    expect(validationsOf(run, 1)).toBe(1);
    expect(run.state.tasks['t001']?.status).toBe('green');
  });

  it('never reuses a red: a red validation still waits for its flake re-run', () => {
    const run = runV2({
      tasks: [soloTask('t001'), soloTask('t002')],
      rules: [CLASH],
      durations: { t001: 30_000, t002: 20_000 },
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const red = eventsOf(run.events, 'ci.end', { purpose: 'validate', green: false });
    expect(red.length).toBeGreaterThanOrEqual(1);
    const redIdx = Number(red[0]?.['trunk_idx']);
    expect(validationsOf(run, redIdx)).toBe(2);
    expect(eventsOf(run.events, 'check.reused', { trunk_idx: redIdx })).toEqual([]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('reports what it reused in the summary', () => {
    const run = runV2({ tasks: [soloTask('t001'), soloTask('t002')] });

    const block = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
    expect(block).toMatchObject({
      reuse_checks: true,
      checks_reused: eventsOf(run.events, 'check.reused').length,
      ci_superseded: 0,
    });
    expect(block).toHaveProperty('variant', 'v2.5');
  });

  it('takes no reused green while a reset rewrites the sprout', () => {
    const step = v2StepAfter(runV2({ tasks: [soloTask('t001')], config: { agents: 1 } }));
    const { state } = step;
    const sha = Sha.parse('a'.repeat(40));
    const idx = state.commits.length;
    state.commits.push({
      idx,
      sha,
      parent: state.sprout,
      kind: 'task',
      task: TaskId.parse('t001'),
      ticket: null,
      files: [],
      landedAt: 0,
      reverted: false,
    });
    state.greenChecks = { [sha]: TaskId.parse('t001') };
    state.reverts['R901'] = { phase: 'reset', head: state.sprout, jobId: 'job9001' };

    maybeValidate(step);

    expect(state.validated[idx]).toBeUndefined();
    expect(state.greenChecks[sha]).toBe('t001');

    delete state.reverts['R901'];
    maybeValidate(step);

    expect(state.validated[idx]).toBe(true);
    expect(state.greenChecks[sha]).toBeUndefined();
  });
});
