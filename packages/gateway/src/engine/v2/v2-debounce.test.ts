import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';
import { DEMO_SETTINGS } from '@beanstalk/shared-race/run-config';

import { SEEDED_SCENARIOS } from '../testing/burst';
import type { LooseEvent, RaceRun } from '../testing/scenario';
import { eventsOf, runRace, wellFormedProblems } from '../testing/scenario';

/** Validations on CI for every head (no reuse), so their timing shows. */
const BASE: Partial<RunConfigInput> = { ...DEMO_SETTINGS, reuse_checks: false };

function calm(config: Partial<RunConfigInput>): RaceRun {
  return runRace(SEEDED_SCENARIOS.calm(3, { ...BASE, ...config }));
}

function validationStarts(run: RaceRun): LooseEvent[] {
  return eventsOf(run.events, 'ci.start', { purpose: 'validate' });
}

function isAt(events: readonly LooseEvent[], t: number): boolean {
  return events.some((event) => Math.abs(event.t - t) < 0.01);
}

describe('v2: validation debounce (`validation_debounce`)', () => {
  it('starts a validation a landing asks for at the next tick or 15 s later, one a validation asks for at once', () => {
    const run = calm({ validation_debounce: true });

    expect(wellFormedProblems(run.events)).toEqual([]);
    const ends = eventsOf(run.events, 'ci.end');
    const lands = eventsOf(run.events, 'land');
    const starts = validationStarts(run);
    expect(starts.length).toBeGreaterThan(0);
    for (const start of starts) {
      const isAfterEnd = isAt(ends, start.t);
      const isTick = Math.abs(start.t / 60 - Math.round(start.t / 60)) * 60 < 0.01;
      const isAfterWait = lands.some((land) => start.t - land.t > 0 && start.t - land.t <= 15.01);
      expect(isAfterEnd || isTick || isAfterWait, `validation at ${start.t}`).toBe(true);
    }
    const block = run.state.policy?.kind === 'beanstalk-v2' ? run.state.policy.stats : undefined;
    expect(block?.debounced ?? 0).toBeGreaterThan(0);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ correct: true });
  });

  it('shares one validation among landings close together', () => {
    const immediate = validationStarts(calm({}));
    const debounced = validationStarts(calm({ validation_debounce: true }));

    expect(debounced.length).toBeLessThan(immediate.length);
  });

  it('adds `ci_overhead_seconds` to every CI run but the final check', () => {
    const run = calm({ ci_overhead_seconds: 12 });

    const ends = eventsOf(run.events, 'ci.end', { purpose: 'validate' }).filter(
      (event) => event['cancelled'] !== true,
    );
    expect(ends.length).toBeGreaterThan(0);
    for (const end of ends) expect(Number(end['ci_seconds'])).toBeGreaterThanOrEqual(72);
    for (const end of eventsOf(run.events, 'ci.end', { purpose: 'final' })) {
      expect(Number(end['ci_seconds'])).toBeLessThan(12);
    }
  });
});
