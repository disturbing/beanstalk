import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import type { FailRule } from '../testing/fake-world';
import type { LooseEvent, RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

// v2.5 as published: beans that need a person are dropped (parking: v2-park.test.ts).
const V2: Partial<RunConfigInput> = {
  policy: 'beanstalk-v2',
  agents: 2,
  ci_seconds: 60,
  park: false,
  tail_guard_minutes: 10,
};

function runV2(scenario: RaceScenario): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config } });
}

/**
 * The real race's lost card (z7ma47bi23, D001): t005's own test pins the old order total,
 * which t032 legitimately changes (it adds shipping). The intents do not contradict; only the
 * pinned value does, and a test author can update it.
 */
const PINS_OLD_TOTAL: FailRule = {
  markers: ['impl:t005', 'impl:t032'],
  file: 'tests/t005.test.ts',
  name: 'leaves small orders unchanged',
  reads: ['src/t005/index.ts', 'src/t032/index.ts'],
  unless: 'total with shipping',
};
const RECONCILED_T005 = "test('t005'); // expects $45.10, the total with shipping\n";

function totalWithShipping(config: Partial<RunConfigInput> = {}, reconciles = true): RaceScenario {
  return {
    tasks: [
      soloTask('t005'),
      soloTask('t032', reconciles ? { reconcile: { 'tests/t005.test.ts': RECONCILED_T005 } } : {}),
    ],
    rules: [PINS_OLD_TOTAL],
    durations: { t005: 10_000, t032: 100_000 },
    config,
  };
}

describe('v2.4: reconcile before a card', () => {
  it('updates the landed test’s pinned value, carried by the arriving bean: both ship', () => {
    const run = runV2(totalWithShipping());

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'decision.reconcile')).toEqual([
      expect.objectContaining({
        task: 't032',
        against: 't005',
        outcome: 'reconciled',
        files: ['tests/t005.test.ts'],
      }),
    ]);
    expect(eventsOf(run.events, 'decision.request')).toEqual([]);
    const reconcile = run.world.instructions.find(
      (instruction) => instruction.kind === 'reconcile',
    );
    expect(reconcile?.workspace.acceptance).toHaveProperty('tests/t005.test.ts');
    expect(reconcile?.workspace.protect.map((file) => file.path)).not.toContain(
      'tests/t005.test.ts',
    );
    expect(run.state.tasks['t032']?.status).toBe('green');
    expect(run.state.tasks['t005']?.status).toBe('green');
    expect(run.state.amendedTests['t005']).toEqual({ 'tests/t005.test.ts': RECONCILED_T005 });
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('raises the card as v2.3 did when reconcile is off', () => {
    const run = runV2(totalWithShipping({ reconcile: false }));

    expect(eventsOf(run.events, 'decision.reconcile')).toEqual([]);
    expect(eventsOf(run.events, 'decision.request', { task: 't032' })).toHaveLength(1);
    expect(run.state.tasks['t032']?.status).not.toBe('green');
  });

  it('still raises a card on a genuine contradiction', () => {
    // t031's own invoice test pins $1000.00, which t005's separators change: both cannot hold.
    const run = runV2({
      tasks: [soloTask('t005'), soloTask('t031')],
      rules: [
        {
          markers: ['impl:t005', 'impl:t031'],
          file: 'tests/t031.test.ts',
          name: 'prints $1000.00 on the invoice',
          reads: ['src/t005/index.ts', 'src/t031/index.ts'],
        },
      ],
      durations: { t005: 10_000, t031: 100_000 },
    });

    const verdict = eventsOf(run.events, 'decision.reconcile')[0];
    expect(verdict).toMatchObject({ task: 't031', against: 't005', outcome: 'contradiction' });
    expect(String(verdict?.['reason'])).toMatch(/^CONTRADICTION/);
    const request = eventsOf(run.events, 'decision.request')[0];
    expect(request).toMatchObject({ task: 't031', against: ['t005'] });
    expect(Number(request?.seq)).toBeGreaterThan(Number(verdict?.seq));
  });

  it('shows the loser’s test author the winner’s failing tests after a contradiction', () => {
    const run = runV2(totalWithShipping({}, false));

    const author = run.world.instructions.find(
      (instruction) => instruction.kind === 'test-author' && instruction.task === 't032',
    );
    expect(author?.prompt).toContain('The failing tests of t005, as they are now:');
    expect(author?.prompt).toContain('tests/t005.test.ts:');
  });
});

describe('v2.4: stale failures', () => {
  /** t002 breaks its own test next to t001, and is reverted while t003 is being checked. */
  const BREAKS_T002: FailRule = {
    markers: ['impl:t001', 'impl:t002'],
    file: 'tests/t002.test.ts',
    name: 't002 works next to t001',
    reads: ['src/t001/index.ts', 'src/t002/index.ts'],
  };
  const revertedMidCheck = (config: Partial<RunConfigInput>): RaceScenario => ({
    tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
    rules: [BREAKS_T002],
    durations: { t001: 10_000, t002: 12_000, t003: 100_000 },
    config: {
      agents: 3,
      flake_confirm: false,
      inherited_reds: 'off',
      early_tickets: false,
      ...config,
    },
  });

  it('checks again, without a round, when the failing test’s owner was reverted meanwhile', () => {
    const run = runV2(revertedMidCheck({}));

    expect(wellFormedProblems(run.events)).toEqual([]);
    const revert = eventsOf(run.events, 'revert', { task: 't002' })[0];
    const stale = eventsOf(run.events, 'preland.recheck', { task: 't003' })[0];
    expect(stale).toMatchObject({ stale: ['tests/t002.test.ts'] });
    expect(Number(stale?.t)).toBeGreaterThan(Number(revert?.t));
    expect(eventsOf(run.events, 'rework.start', { task: 't003' })).toEqual([]);
    expect(run.state.tasks['t003']?.status).toBe('green');
  });

  it('charges the round as v2.3 did when reconcile is off', () => {
    const run = runV2(revertedMidCheck({ reconcile: false }));

    expect(eventsOf(run.events, 'rework.start', { task: 't003' }).length).toBeGreaterThan(0);
  });
});

/** v2.4's rules for escalation and reconcile (v2.5 changes both), without v2.5's tail bounds. */
const V24_ESCALATION: Partial<RunConfigInput> = {
  escalate_after: 2,
  reconcile_parties: 1,
  max_bean_invocations: 0,
  tail_guard_minutes: 0,
};

/**
 * The real race's t032 (cf-v24-sonnet-12-s7): its shipping clashes with t005's pinned total
 * and with a third landed task's free-shipping threshold (t030 here). Reconciling t032 with
 * t005 alone cannot fix t030's test ("that rule comes from neither task").
 */
const PINS_FREE_SHIPPING: FailRule = {
  markers: ['impl:t030', 'impl:t032'],
  file: 'tests/t030.test.ts',
  name: 'ships free over $75',
  reads: ['src/t030/index.ts', 'src/t032/index.ts'],
  unless: 'threshold on goods',
};
const RECONCILED_T030 = "test('t030'); // the threshold on goods, before shipping\n";

export function threeWayClash(
  config: Partial<RunConfigInput> = {},
  reconciles = true,
): RaceScenario {
  const amendments = {
    'tests/t005.test.ts': RECONCILED_T005,
    'tests/t030.test.ts': RECONCILED_T030,
  };
  return {
    tasks: [
      soloTask('t005'),
      soloTask('t030'),
      soloTask('t032', reconciles ? { reconcile: amendments } : {}),
    ],
    rules: [PINS_OLD_TOTAL, PINS_FREE_SHIPPING],
    durations: { t005: 10_000, t030: 12_000, t032: 100_000 },
    config: { agents: 3, ...config },
  };
}

function dropOf(run: RaceRun): LooseEvent | undefined {
  return eventsOf(run.events, 'task.drop', { task: 't032' })[0];
}

describe('v2.5: escalate after one repeated red, reconcile every landed party', () => {
  it('reconciles a three-way clash in one step: all three ship', () => {
    const run = runV2(threeWayClash());

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'rework.start', { task: 't032' })).toHaveLength(1);
    expect(eventsOf(run.events, 'decision.reconcile')).toEqual([
      expect.objectContaining({
        task: 't032',
        against: 't005',
        parties: ['t005', 't030'],
        outcome: 'reconciled',
        files: ['tests/t005.test.ts', 'tests/t030.test.ts'],
      }),
    ]);
    const reconcile = run.world.instructions.find(
      (instruction) => instruction.kind === 'reconcile',
    );
    expect(Object.keys(reconcile?.workspace.acceptance ?? {}).toSorted()).toEqual([
      'tests/t005.test.ts',
      'tests/t030.test.ts',
      'tests/t032.test.ts',
    ]);
    expect(reconcile?.prompt).toContain('You are the test author for tasks t032, t005 and t030.');
    expect(reconcile?.prompt).toContain('Task t030 ("Task t030") has already landed:');
    expect(eventsOf(run.events, 'decision.request')).toEqual([]);
    expect(run.state.amendedTests['t030']).toEqual({ 'tests/t030.test.ts': RECONCILED_T030 });
    expect(['t005', 't030', 't032'].map((id) => run.state.tasks[id]?.status)).toEqual([
      'green',
      'green',
      'green',
    ]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('v2.4 reconciles with t005 alone, finds a contradiction and drops t032', () => {
    const run = runV2(threeWayClash(V24_ESCALATION));

    const verdict = eventsOf(run.events, 'decision.reconcile')[0];
    expect(verdict).toMatchObject({ against: 't005', outcome: 'contradiction' });
    expect(verdict).not.toHaveProperty('parties');
    expect(run.state.tasks['t032']?.status).toBe('dropped');
  });

  it('names every party on the card when the clash stays a contradiction', () => {
    const run = runV2(threeWayClash({}, false));

    const request = eventsOf(run.events, 'decision.request', { task: 't032' })[0];
    expect(request).toMatchObject({ against: ['t005'], parties: ['t005', 't030'], attempts: 2 });
    expect(String(request?.['reason'])).toMatch(/^CONTRADICTION/);
  });

  it('reconciles after one failed informed repair, a round sooner than v2.4', () => {
    const v24 = runV2(totalWithShipping(V24_ESCALATION));
    const v25 = runV2(totalWithShipping());

    expect(eventsOf(v24.events, 'rework.start', { task: 't032' })).toHaveLength(2);
    expect(eventsOf(v25.events, 'rework.start', { task: 't032' })).toHaveLength(1);
    expect(v25.state.tasks['t032']?.status).toBe('green');
    expect(Number(v25.state.tasks['t032']?.greenAt)).toBeLessThan(
      Number(v24.state.tasks['t032']?.greenAt),
    );
  });

  it('drops a bean still red against a counterpart already reconciled and decided', () => {
    const v24 = runV2(totalWithShipping(V24_ESCALATION, false));
    const v25 = runV2(totalWithShipping({}, false));

    expect(dropOf(v25)).toMatchObject({
      reason: 'pre-land check still red against t005 after its decision card',
    });
    const policy = v25.state.policy;
    expect(policy?.kind === 'beanstalk-v2' ? policy.stats.stuck_drops : -1).toBe(1);
    expect(dropOf(v24)).toMatchObject({
      reason: 'pre-land check still red after --max-rework attempts',
    });
    expect(Number(dropOf(v25)?.t)).toBeLessThan(Number(dropOf(v24)?.t));
  });
});
