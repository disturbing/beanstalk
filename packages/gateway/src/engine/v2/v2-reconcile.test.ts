import { describe, expect, it } from 'vitest';

import { TaskId } from '@gitstalk/shared-race/ids';
import type { RunConfigInput } from '@gitstalk/shared-race/run-config';

import { SPROUT_REF } from '../refs';
import type { FailRule } from '../testing/fake-world';
import type { LooseEvent, RaceRun, RaceScenario } from '../testing/scenario';
import {
  eventsOf,
  landingFlowOf,
  redCheckOf,
  runRace,
  soloTask,
  v2StepAfter,
  wellFormedProblems,
} from '../testing/scenario';
import { decisionsInForce, isDecided, isReconciled } from './v2-decisions';
import { culpritTasks, startRepair } from './v2-repair';

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

function v2Stats(run: RaceRun): Record<string, unknown> {
  const policy = run.state.policy;
  return policy?.kind === 'beanstalk-v2' ? { ...policy.stats } : {};
}

describe('v2.5 review fixes: the reconcile author', () => {
  it('works on the bean’s branch with the landed line merged in, and the prompt says so', () => {
    const run = runV2(totalWithShipping());

    const reconcile = run.world.instructions.find(
      (instruction) => instruction.kind === 'reconcile',
    );
    const merge = reconcile?.workspace.merge;
    expect(merge).toMatchObject({ ref: SPROUT_REF, conflicts: [] });
    // The landed party's code is in the tree the author works on.
    expect(run.world.git.get(merge?.sha ?? '').files.has('src/t005/index.ts')).toBe(true);
    expect(reconcile?.prompt).toContain(
      "This tree is t032's branch with the landed line merged in (the sprout its pre-land check ran on): it holds t032's change and the code of the landed task below.",
    );
    expect(run.state.tasks['t032']?.status).toBe('green');
  });

  it('retries an author that crashed, instead of recording a contradiction', () => {
    const run = runV2({
      ...totalWithShipping(),
      tasks: [
        soloTask('t005'),
        soloTask('t032', {
          reconcile: { 'tests/t005.test.ts': RECONCILED_T005 },
          reconcileFails: 1,
        }),
      ],
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'invocation.retry', { task: 't032' })).toEqual([
      expect.objectContaining({ reason: 'reconcile failed: agent crashed' }),
    ]);
    expect(eventsOf(run.events, 'decision.reconcile')).toEqual([
      expect.objectContaining({ outcome: 'reconciled' }),
    ]);
    expect(eventsOf(run.events, 'decision.request')).toEqual([]);
    expect(v2Stats(run)).toMatchObject({ reconciles: 1, reconciled: 1, contradictions: 0 });
    expect(run.state.tasks['t032']?.status).toBe('green');
  });

  it('goes on to an informed repair after a second crash, leaving the pair unreconciled', () => {
    const run = runV2({
      ...totalWithShipping(),
      tasks: [
        soloTask('t005'),
        soloTask('t032', {
          reconcile: { 'tests/t005.test.ts': RECONCILED_T005 },
          reconcileFails: 2,
        }),
      ],
    });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const reconciles = run.world.instructions.filter(
      (instruction) => instruction.kind === 'reconcile',
    );
    // Two crashed authors, an informed repair, and a fresh reconcile at the next stuck red.
    expect(reconciles).toHaveLength(3);
    const repairs = eventsOf(run.events, 'rework.start', { task: 't032', reason: 'preland-red' });
    expect(repairs).toHaveLength(2);
    expect(repairs[1]).toMatchObject({ culprits: ['t005'] });
    expect(eventsOf(run.events, 'decision.reconcile')).toEqual([
      expect.objectContaining({ outcome: 'reconciled' }),
    ]);
    expect(v2Stats(run)).toMatchObject({ reconciles: 2, contradictions: 0, cards: 0 });
    expect(run.state.tasks['t032']?.status).toBe('green');
  });
});

/** t032 wins D001 against the landed t005: t005's test is amended in place, both land. */
function decidedForT032(): RaceRun {
  return runV2({
    ...totalWithShipping({ decision_oracle: 'arriving' }, false),
    tasks: [
      soloTask('t005', { amendTests: { 'tests/t005.test.ts': RECONCILED_T005 } }),
      soloTask('t032'),
    ],
  });
}

describe('v2.5 review fixes: a decided pair, roles swapped', () => {
  const t005 = TaskId.parse('t005');
  const t032 = TaskId.parse('t032');

  it('t032 won its card against the landed t005: both ship', () => {
    const run = decidedForT032();

    expect(eventsOf(run.events, 'decision.made')).toEqual([
      expect.objectContaining({ card: 'D001', winner: 't032', outcome: 'adopt-in-place' }),
    ]);
    expect(run.state.tasks['t005']?.status).toBe('green');
    expect(run.state.tasks['t032']?.status).toBe('green');
  });

  it('asks no second card when t005 arrives red against the landed t032', () => {
    const step = v2StepAfter(decidedForT032());
    const { state } = step;
    const flow = landingFlowOf(step, t005, 'a1');
    // A reset requeued t005; it arrives red on t032's test, a repeat of its last red there.
    state.pairRepeats['t005|t032'] = { files: ['tests/t032.test.ts'], repeats: 0 };
    const cards = Object.keys(state.cards);

    expect(isDecided(state, t005, t032)).toBe(true);
    expect(isReconciled(state, t005, t032)).toBe(true);
    startRepair(step, flow, {
      head: state.sprout,
      red: redCheckOf('tests/t032.test.ts', ['src/t005/index.ts', 'src/t032/index.ts']),
      mine: null,
    });

    expect(Object.keys(state.cards)).toEqual(cards);
    expect(flow.step.kind === 'awaiting-agent' ? flow.step.work.kind : flow.step.kind).not.toBe(
      'reconcile',
    );
    expect(decisionsInForce(state, t005, '')).toEqual([
      expect.stringMatching(/^D001 \(t032 and t005\): /),
    ]);
  });
});

describe('v2.5 review fixes: confirmed culprits a reset took off the sprout', () => {
  it('names a confirmed culprit only while it is still on the sprout', () => {
    const step = v2StepAfter(runV2(totalWithShipping()));
    const t005 = TaskId.parse('t005');
    const t032 = TaskId.parse('t032');
    const check = {
      head: step.state.sprout,
      red: redCheckOf('tests/t032.test.ts', ['src/t005/index.ts']),
      mine: null,
      confirmed: [t005],
    };

    expect(culpritTasks(step, t032, check)).toEqual(['t005']);
    for (const commit of step.state.commits) {
      if (commit.task === 't005') commit.reverted = true;
    }
    expect(culpritTasks(step, t032, check)).toEqual([]);
  });
});

describe('v2.5 review fixes: a parked card keeps the reconcile’s amendments', () => {
  /**
   * t032 clashes with t005 (reconcilable: t005's pinned total) and with t030 (not). The
   * reconcile with t005 carries t005's amended test; the one with t030 is a contradiction,
   * whose card only a person answers: t032 parks, and the answer takes it up again.
   */
  const RED_WITH_T030: FailRule = {
    markers: ['impl:t030', 'impl:t032'],
    file: 'tests/t030.test.ts',
    name: 'ships free over $75',
    reads: ['src/t030/index.ts', 'src/t032/index.ts'],
  };
  const scenario = (injectAt: number | null): RaceScenario => ({
    tasks: [
      soloTask('t005'),
      soloTask('t030'),
      soloTask('t032', { reconcile: { 'tests/t005.test.ts': RECONCILED_T005 }, stubborn: true }),
      // Keeps the race going while the person answers.
      soloTask('t003'),
    ],
    rules: [PINS_OLD_TOTAL, RED_WITH_T030],
    durations: { t005: 10_000, t030: 12_000, t032: 100_000, t003: 900_000 },
    config: {
      agents: 4,
      park: true,
      decision_mode: 'human',
      reconcile_parties: 1,
      tail_guard_minutes: 0,
    },
    ...(injectAt === null
      ? {}
      : {
          injections: [
            {
              at: injectAt,
              input: (at: number) => ({
                kind: 'decision' as const,
                at,
                card: 'D001',
                winner: 't030',
                actor: 'coop',
                text: null,
              }),
            },
          ],
        }),
  });

  it('re-executes the loser with the amendment it carried before it was parked', () => {
    const parked = runV2(scenario(null));
    const request = eventsOf(parked.events, 'decision.request', { task: 't032' })[0];
    expect(request).toMatchObject({ against: ['t030'] });
    expect(eventsOf(parked.events, 'task.parked', { task: 't032' })).toHaveLength(1);

    const run = runV2(scenario(Math.round(Number(request?.t) * 1000) + 5_000));
    expect(run.refusals).toEqual([]);
    const answered = Number(eventsOf(run.events, 'decision.made')[0]?.t);
    const rolledBack = eventsOf(run.events, 'spec.amended', { status: 'rolled-back' });
    expect(rolledBack.filter((event) => event.t <= answered)).toEqual([]);
    const reexecution = run.world.instructions.find(
      (instruction) =>
        instruction.task === 't032' &&
        instruction.kind === 'rework' &&
        instruction.workspace.headSha === null,
    );
    expect(reexecution?.workspace.acceptance['tests/t005.test.ts']).toBe(RECONCILED_T005);
  });
});
