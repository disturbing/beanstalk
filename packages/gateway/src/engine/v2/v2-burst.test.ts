import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';
import { V22_SETTINGS } from '@beanstalk/shared-race/run-config';

import { buildSummary } from '../summary';
import { PAIRS, burstScenario, calmScenario, declaredBurst, numbers } from '../testing/burst';
import type { RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, wellFormedProblems } from '../testing/scenario';

/**
 * The burst that sank v2.2 in its first real race (cloud run qpucqup50w, seed 7): twelve
 * agents released during their checks produce beans faster than two CI slots validate them,
 * coupled beans land unchecked and turn the sprout red, and innocent beans then spend their
 * rework rounds on reds that are not theirs.
 */
export const V22_RULES: Partial<RunConfigInput> = V22_SETTINGS;

/** The E6 rules off, the rest of the v2.5 defaults on. */
const WITHOUT_E6: Partial<RunConfigInput> = {
  start_cards: false,
  rescue: false,
  dynamic_culprits: false,
};

/** The burst with each coupled pair declared in the tasks' `couplings`, as the arena does. */
function declaredCouplings(scenario: RaceScenario): RaceScenario {
  const partners = new Map<string, string>(PAIRS.map(({ first, culprit }) => [first, culprit]));
  return {
    ...scenario,
    tasks: scenario.tasks.map((task) => {
      const partner = partners.get(task.id);
      return partner === undefined ? task : { ...task, coupledWith: [partner] };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('the v2.2 burst, in the simulator', () => {
  it('reproduces the failure: v2.2 drops innocent beans on reds that are not theirs', () => {
    const run = runRace(burstScenario(V22_RULES));

    expect(wellFormedProblems(run.events)).toEqual([]);
    const v22 = numbers(run);
    expect(v22.dropped).toBeGreaterThanOrEqual(8);
    expect(v22.preland_still_red).toBeGreaterThanOrEqual(6);
    // Two v2.2 bugs this race found: a red re-run covered by a newer ticket promoted a red
    // commit, and a leave-one-out search lost a probe and never ended.
    expect(v22.correct).toBe(true);
    expect(v22.done_minutes).toBeLessThan(60);
  });

  it('v2.3 keeps the beans: at least 36 green, a correct final check, little speed given back', () => {
    const v22 = numbers(runRace(burstScenario(V22_RULES)));
    const run = runRace(burstScenario());

    expect(wellFormedProblems(run.events)).toEqual([]);
    const v23 = numbers(run);
    expect(v23.green).toBeGreaterThanOrEqual(36);
    expect(v23.correct).toBe(true);
    expect(v23.preland_still_red).toBeLessThanOrEqual(1);
    expect(v23.done_minutes).toBeLessThanOrEqual(v22.done_minutes * 1.25);
  });

  it('v2.3 re-checks overlaps until five come back green in a row, then skips and samples', () => {
    const run = runRace(calmScenario());

    const block = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
    const count = (key: string): number => {
      const value: unknown = isRecord(block) ? block[key] : null;
      return typeof value === 'number' ? value : -1;
    };
    expect(block).toMatchObject({ preland_recheck_rule: 'sampled' });
    expect(count('preland_rechecks')).toBeGreaterThanOrEqual(5);
    expect(count('preland_skipped_rechecks')).toBeGreaterThan(0);
    expect(eventsOf(run.events, 'preland.check', { green: false })).toEqual([]);
  });

  it('the E6 rules change nothing on the burst', () => {
    const v24 = numbers(runRace(burstScenario(WITHOUT_E6)));

    expect(numbers(runRace(burstScenario()))).toEqual(v24);
  });

  it('declared couplings finish the burst sooner: cards at the first red', () => {
    const declared = numbers(runRace(declaredCouplings(burstScenario())));

    expect(declared.green).toBe(40);
    expect(declared.correct).toBe(true);
    expect(declared.done_minutes).toBeLessThan(19.2);
  });

  it('the rescue keeps v2.2’s beans that were still red after their reworks', () => {
    const rescued = numbers(runRace(burstScenario({ ...V22_RULES, rescue: true })));

    expect(rescued.preland_still_red).toBe(0);
    expect(rescued.green).toBeGreaterThanOrEqual(35);
    expect(rescued.correct).toBe(true);
  });

  it('v2.3 keeps v2.2’s speed on a calm repo', () => {
    const v22 = numbers(runRace(calmScenario(V22_RULES)));
    const v23 = numbers(runRace(calmScenario()));

    expect(v23.green).toBe(40);
    expect(v22.green).toBe(40);
    expect(v23.done_minutes).toBeLessThanOrEqual(v22.done_minutes * 1.15);
  });
});

describe('v2.5 (forge-owned tests) on the burst and the calm race', () => {
  const FORGE_TESTS: Partial<RunConfigInput> = { tests_first: true, targeted_landing_check: true };

  it('keeps every green and a correct stalk on the burst, no slower than v2.4', () => {
    const v24 = numbers(runRace(burstScenario()));
    const run = runRace(burstScenario(FORGE_TESTS));

    expect(wellFormedProblems(run.events)).toEqual([]);
    const v25 = numbers(run);
    expect(v25.green).toBeGreaterThanOrEqual(v24.green);
    expect(v25.red_validations).toBeLessThanOrEqual(v24.red_validations);
    expect(v25.correct).toBe(true);
    expect(v25.done_minutes).toBeLessThanOrEqual(v24.done_minutes);
  });

  it('keeps every green on the calm race; the author step costs under a third more time', () => {
    // Both validate every head on CI: the ratio measures the author step, not check reuse.
    const v24 = numbers(runRace(calmScenario({ reuse_checks: false })));
    const v25 = numbers(runRace(calmScenario({ ...FORGE_TESTS, reuse_checks: false })));

    expect(v25.green).toBe(40);
    expect(v25.correct).toBe(true);
    expect(v25.done_minutes).toBeLessThanOrEqual(v24.done_minutes * 1.3);
  });

  it('decides exactly as v2.4 when only the targeted check is on and no test reads both sides', () => {
    const v24 = runRace(calmScenario());
    const targeted = runRace(calmScenario({ targeted_landing_check: true }));

    expect(targeted.events.map((event) => event.type)).toEqual(
      v24.events.map((event) => event.type),
    );
  });
});

const DEPENDENCY: Partial<RunConfigInput> = { start_order: 'dependency' };

describe('dependency-aware starts on the burst (start_order)', () => {
  it('fifo is the default and starts beans in priority order', () => {
    const run = runRace(calmScenario());

    const rules = new Set(eventsOf(run.events, 'placement.decision').map((event) => event.rule));
    expect([...rules]).toEqual(['fifo']);
  });

  it('starts culprits after their partners: all 40 green, the 30th green twice as soon', () => {
    const fifo = numbers(runRace(declaredBurst({})));
    const run = runRace(declaredBurst(DEPENDENCY));
    const dependency = numbers(run);

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(dependency).toMatchObject({ green: 40, dropped: 0, correct: true });
    expect(dependency.done_minutes).toBeLessThanOrEqual(fifo.done_minutes);
    expect(dependency.green30_minutes ?? Infinity).toBeLessThan((fifo.green30_minutes ?? 0) * 0.6);
    const block = buildSummary(run.state, run.env, run.state.clock)['beanstalk'];
    expect(block).toMatchObject({ start_order: 'dependency' });
  });

  it('ignores modules most beans predict, so coarse footprints decide as exact ones', () => {
    const exact = numbers(runRace(declaredBurst(DEPENDENCY)));
    const coarse = numbers(runRace(declaredBurst(DEPENDENCY, 'coarse')));

    expect(coarse).toEqual(exact);
  });

  it('under the v2.2 rules keeps most of the beans fifo drops', () => {
    const fifo = numbers(runRace(declaredBurst(V22_RULES)));
    const dependency = numbers(runRace(declaredBurst({ ...V22_RULES, ...DEPENDENCY })));

    expect(fifo.dropped).toBeGreaterThanOrEqual(10);
    expect(dependency.dropped).toBeLessThanOrEqual(4);
    expect(dependency.red_validations).toBeLessThan(fifo.red_validations);
  });
});
