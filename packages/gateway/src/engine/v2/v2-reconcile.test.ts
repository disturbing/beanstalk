import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import type { FailRule } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', agents: 2, ci_seconds: 60 };

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
