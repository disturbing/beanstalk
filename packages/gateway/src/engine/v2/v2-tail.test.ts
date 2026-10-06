import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import type { FailRule } from '../testing/fake-world';
import type { LooseEvent, RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 4, ci_seconds: 60 };

function runV2(scenario: RaceScenario): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config } });
}

function dropOf(run: RaceRun, task: string): LooseEvent | undefined {
  return eventsOf(run.events, 'task.drop', { task })[0];
}

function minutesOf(event: LooseEvent | undefined): number {
  return Number(event?.t) / 60;
}

/** Agent invocations the engine gave a task (sync turns and tests-first authors aside). */
function invocationsOf(run: RaceRun, task: string): number {
  return run.world.instructions.filter(
    (instruction) =>
      instruction.task === task && instruction.kind !== 'sync' && instruction.kind !== 'test-first',
  ).length;
}

/** Landed beans whose files t032's own test reads too: the search's decoys. */
const DECOYS = ['t040', 't041', 't042', 't043', 't044', 't045', 't046', 't047'];
const DECOY_READS = DECOYS.map((id) => `src/${id}/index.ts`);

/**
 * t032 of `cf-v25dep-sonnet-12-s7` and `-s11`: its shipping clashes with t005 (t005's own test
 * pins the old total, and the confirmation email of t032's test shows t005's separators) and
 * with t030's free-shipping threshold (t032's test expects shipping on a $100 order). Two
 * landed beans break t032's own test together, so leaving either out fixes nothing and no
 * dynamic culprit is ever confirmed. Neither clash can be reconciled, the card keeps t005,
 * and the loser stays red under every re-execution: the race looped until its 60-minute cap.
 */
const T032_RULES: readonly FailRule[] = [
  {
    markers: ['impl:t005', 'impl:t032'],
    file: 'tests/t005.test.ts',
    name: 'leaves small orders unchanged',
    reads: ['src/t005/index.ts', 'src/t032/index.ts'],
  },
  {
    markers: ['impl:t005', 'impl:t032'],
    file: 'tests/t032.test.ts',
    name: 'shows the new total in the confirmation email',
    reads: ['src/t005/index.ts', 'src/t032/index.ts', ...DECOY_READS],
  },
  {
    markers: ['impl:t030', 'impl:t032'],
    file: 'tests/t032.test.ts',
    name: 'includes shipping on top of goods and tax',
    reads: ['src/t030/index.ts', 'src/t032/index.ts', ...DECOY_READS],
  },
];

function t032Loop(config: Partial<RunConfigInput> = {}): RaceScenario {
  return {
    tasks: [
      soloTask('t005'),
      soloTask('t030'),
      ...DECOYS.map((id) => soloTask(id)),
      soloTask('t032', { stubborn: true }),
    ],
    rules: T032_RULES,
    durations: {
      t005: 10_000,
      t030: 12_000,
      ...Object.fromEntries(DECOYS.map((id, index) => [id, 14_000 + index * 1_000])),
      t032: 100_000,
    },
    config,
  };
}

describe('v2.5 tail fix: the t032 loop ends', () => {
  it('drops the decided loser that stays red, with one search and a bounded tail', () => {
    const run = runV2(t032Loop());

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'race.end')[0]).toMatchObject({ aborted: null });
    const others = ['t005', 't030', ...DECOYS].map((id) => run.state.tasks[id]?.status);
    expect(others.every((status) => status === 'green')).toBe(true);
    expect(dropOf(run, 't032')).toMatchObject({
      reason: 'pre-land check still red against t005 after its decision card',
    });
    // One card, one re-execution, one rescue, and the drop at the next red after it.
    expect(eventsOf(run.events, 'decision.made', { loser: 't032' })).toHaveLength(1);
    expect(eventsOf(run.events, 'rescue.start', { task: 't032' })).toHaveLength(1);
    expect(eventsOf(run.events, 'preland.check', { task: 't032', green: false })).toHaveLength(4);
    expect(invocationsOf(run, 't032')).toBe(6);
    expect(minutesOf(dropOf(run, 't032'))).toBeLessThan(15);
  });

  it('searches for dynamic culprits once, over at most 6 candidates', () => {
    const run = runV2(t032Loop());

    const searches = eventsOf(run.events, 'culprit.dynamic', { task: 't032' });
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({ confirmed: [] });
    expect(searches[0]?.['candidates']).toHaveLength(6);
    const block = run.state.policy;
    const stats = block?.kind === 'beanstalk-v2' ? block.stats : null;
    // The second red repeats the counterparts (the answer stands); the later ones name t005,
    // which the card decided.
    expect(stats).toMatchObject({ dynamic_culprit_runs: 1, dynamic_culprit_skips: 3 });
  });

  it('runs no more probes at once than the run has CI slots', () => {
    const run = runV2(t032Loop({ ci_slots: 1 }));

    const probes = run.world.jobs.filter(
      (job) => job.kind === 'check' && job.instance.kind === 'sandbox',
    );
    expect(probes.length).toBeGreaterThan(0);
    const reverts = run.world.jobs
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => job.kind === 'revert' && job.message.includes('probe'));
    expect(reverts).toHaveLength(6);
    // One at a time: each probe's suite runs before the next probe's revert is asked for.
    for (const [position, { index }] of reverts.slice(1).entries()) {
      const previous = reverts[position]?.index ?? 0;
      const between = run.world.jobs.slice(previous + 1, index);
      expect(between.some((job) => job.kind === 'check')).toBe(true);
    }
  });
});

describe('v2.5 tail fix: a hard ceiling on a bean’s invocations', () => {
  const stuck = soloTask('t001', {
    writes: { 'src/t001/index.ts': 'export const t001 = 1; // impl:t001 BUG:t001\n' },
    stubborn: true,
  });
  const bug: FailRule = {
    markers: ['BUG:t001'],
    file: 'tests/t001.test.ts',
    name: 't001 works',
  };

  it('drops a bean after max_bean_invocations, whatever resets its rounds', () => {
    const run = runV2({
      tasks: [stuck],
      rules: [bug],
      config: { agents: 1, max_rework: 20, tail_guard_minutes: 0 },
    });

    expect(dropOf(run, 't001')).toMatchObject({
      reason: 'still failing after 10 agent invocations (max_bean_invocations 10)',
    });
    expect(invocationsOf(run, 't001')).toBe(10);
    const block = run.state.policy;
    expect(block?.kind === 'beanstalk-v2' ? block.stats.invocation_drops : -1).toBe(1);
  });

  it('spends every max_rework round as before with the ceiling off', () => {
    const config = { agents: 1, max_rework: 12, rescue: false, tail_guard_minutes: 0 };
    const off = runV2({
      tasks: [stuck],
      rules: [bug],
      config: { ...config, max_bean_invocations: 0 },
    });
    const on = runV2({ tasks: [stuck], rules: [bug], config });

    expect(dropOf(off, 't001')).toMatchObject({
      reason: 'pre-land check still red after --max-rework attempts',
    });
    // The initial run and 12 reworks, against 10 invocations in all with the ceiling.
    expect(invocationsOf(off, 't001')).toBe(13);
    expect(invocationsOf(on, 't001')).toBe(10);
  });
});

describe('v2.5 tail fix: the tail guard', () => {
  const stuck = soloTask('t001', {
    writes: { 'src/t001/index.ts': 'export const t001 = 1; // impl:t001 BUG:t001\n' },
    stubborn: true,
  });
  const scenario = (config: Partial<RunConfigInput>): RaceScenario => ({
    tasks: [stuck, soloTask('t002')],
    rules: [{ markers: ['BUG:t001'], file: 'tests/t001.test.ts', name: 't001 works' }],
    durations: { t001: 10_000, t002: 300_000 },
    // No rescue: a replay agent's rescue would fix the bug, and this bean must stay stuck.
    config: { agents: 2, max_rework: 20, rescue: false, max_bean_invocations: 0, ...config },
  });

  it('drops a bean that makes no progress once only stuck beans are left', () => {
    const run = runV2(scenario({}));

    expect(run.state.tasks['t002']?.status).toBe('green');
    const drop = dropOf(run, 't001');
    expect(drop).toMatchObject({
      reason: 'no progress for 10 minutes with only stuck beans left (tail_guard_minutes)',
    });
    // The clock runs from the last landing: t001 kept failing the same way all along.
    const landed = eventsOf(run.events, 'land', { task: 't002' })[0];
    expect(Number(drop?.t) - Number(landed?.t)).toBeGreaterThanOrEqual(600);
    expect(Number(drop?.t) - Number(landed?.t)).toBeLessThan(600 + 180);
    const block = run.state.policy;
    expect(block?.kind === 'beanstalk-v2' ? block.stats.tail_drops : -1).toBe(1);
  });

  it('lets the bean spend its rounds when the guard is off', () => {
    const run = runV2(scenario({ tail_guard_minutes: 0 }));

    expect(dropOf(run, 't001')).toMatchObject({
      reason: 'pre-land check still red after --max-rework attempts',
    });
    expect(minutesOf(dropOf(run, 't001'))).toBeGreaterThan(
      minutesOf(dropOf(runV2(scenario({})), 't001')) + 10,
    );
  });
});
