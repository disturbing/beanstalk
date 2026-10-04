import { describe, expect, it } from 'vitest';

import {
  RunConfig,
  errorBudget,
  prelandSeconds,
  releasesOnCheck,
  protectTestsMode,
  snapshotMode,
  unionPaths,
  usesUnionMerge,
} from './run-config';

const task = (id: string) => ({
  id,
  title: `Task ${id}`,
  prompt: 'Do it.',
  acceptance_tests: { [`src/${id}.test.ts`]: 'test' },
});

describe('RunConfig', () => {
  it('applies the harness RaceConfig defaults', () => {
    const config = RunConfig.parse({ policy: 'queue', tasks: [task('t001')] });

    expect(config).toMatchObject({
      agent: 'replay',
      agents: 4,
      ci_seconds: 60,
      ci_slots: 2,
      batch: 4,
      batch_wait: 0,
      budget_usd: 25,
      max_invocation_usd: 3,
      max_turns: 40,
      agent_timeout: 900,
      seed: 0,
      merge_drivers: 'auto',
      queue_hold: true,
      max_rework: 3,
      max_fix_attempts: 2,
      max_wall_minutes: 360,
      infra_retry_seconds: 10,
      rework_resume: true,
      preland_mode: 'optimistic',
      preland_seconds: null,
      decision_seconds: 30,
      decision_oracle: 'landed',
      decision_mode: 'oracle',
      human_timeout_seconds: null,
      decision_outcome: 'reexecute',
      recheck: 'adaptive',
      recheck_fallback: 'file',
      flake_confirm: true,
    });
    expect(releasesOnCheck(config)).toBe(false);
    expect(releasesOnCheck({ ...config, policy: 'beanstalk-v2' })).toBe(true);
    expect(releasesOnCheck({ policy: 'beanstalk-v2', release_on_check: false })).toBe(false);
    expect(protectTestsMode(config)).toBe('own');
    expect(snapshotMode(config)).toBe('green');
    expect(errorBudget(config)).toBe(3);
  });

  it('gives v2 its plan §6 settings: landed protection, sprout-head starts, fair pre-land checks', () => {
    const config = RunConfig.parse({
      policy: 'beanstalk-v2',
      ci_seconds: 60,
      tasks: [task('t001')],
    });

    expect(protectTestsMode(config)).toBe('landed');
    expect(snapshotMode(config)).toBe('head');
    expect(prelandSeconds(config)).toBe(60);
    expect(prelandSeconds({ ...config, preland_seconds: 0 })).toBe(0);
    expect(errorBudget(config)).toBe(999);
  });

  it('refuses v2 settings that contradict the policy', () => {
    const v2 = { policy: 'beanstalk-v2', tasks: [task('t001')] };

    expect(RunConfig.safeParse({ ...v2, protect_tests: 'own' }).success).toBe(false);
    expect(RunConfig.safeParse({ ...v2, snapshot: 'green' }).success).toBe(false);
    expect(RunConfig.safeParse({ ...v2, error_budget: 3 }).success).toBe(false);
    expect(RunConfig.safeParse({ ...v2, error_budget: 999 }).success).toBe(true);
  });

  it('rejects duplicate task ids', () => {
    const result = RunConfig.safeParse({ policy: 'queue', tasks: [task('t001'), task('t001')] });

    expect(result.success).toBe(false);
  });

  it('rejects footprints for tasks the run does not have', () => {
    const result = RunConfig.safeParse({
      policy: 'queue',
      tasks: [task('t001')],
      footprints: { t009: { method: 'predictor', selected: [], probs: {} } },
    });

    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(RunConfig.safeParse({ policy: 'queue', tasks: [task('t001')], agnets: 3 }).success).toBe(
      false,
    );
  });
});

describe('union merge driver', () => {
  it('is on for the beanstalk policies and off for the queue when left on auto', () => {
    expect(usesUnionMerge({ policy: 'queue', merge_drivers: 'auto' })).toBe(false);
    expect(usesUnionMerge({ policy: 'beanstalk', merge_drivers: 'auto' })).toBe(true);
    expect(usesUnionMerge({ policy: 'beanstalk-preland', merge_drivers: 'auto' })).toBe(true);
  });

  it('follows an explicit setting', () => {
    expect(unionPaths({ policy: 'queue', merge_drivers: 'union' })).toEqual([
      'CHANGELOG.md',
      'CHANGELOG*.md',
      '**/CHANGELOG.md',
    ]);
    expect(unionPaths({ policy: 'beanstalk', merge_drivers: 'none' })).toEqual([]);
  });
});
