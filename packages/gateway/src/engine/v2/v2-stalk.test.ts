import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@gitstalk/shared-race/run-config';
import { V20_SETTINGS, V24_SETTINGS } from '@gitstalk/shared-race/run-config';

import { FLAKY_TEST, SEEDED_SCENARIOS, numbers, redStalkCommits } from '../testing/burst';
import { eventsOf, runRace, wellFormedProblems } from '../testing/scenario';

/**
 * The flaky burst, seed 9 (one CI run in twenty fails `tests/flaky.test.ts`), where the
 * simulator table reported v2.4's final stalk as wrong. The stalk was green: the last
 * promoted commit had passed its validation, and the final check's one suite run hit the
 * injected flake. The lab's own re-check ran on the flaky world too, and its first re-run
 * flaked again, so it looked confirmed. v2 now re-runs a red final suite once on a commit it
 * validated green (`rerunsRedFinalSuite`, with `flake_confirm`).
 */
const FLAKY_SEED_9 = (config: Partial<RunConfigInput>) => SEEDED_SCENARIOS.flaky(9, config);
/**
 * Seed 11 hits the same flake in the final suite since the window stopped counting a re-checking
 * bean as inbound (v2-landing's `recheck`): seed 9's v2.4 run now draws its final suite green.
 */
const FLAKY_SEED_11 = (config: Partial<RunConfigInput>) => SEEDED_SCENARIOS.flaky(11, config);

describe('the stalk never holds a red commit (flaky burst, seed 9)', () => {
  it.each([
    ['v2.4', V24_SETTINGS],
    ['v2.5', {}],
  ] as const)('%s: every promoted commit is green and the final check says so', (_, settings) => {
    const run = runRace(FLAKY_SEED_9(settings));

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(redStalkCommits(run)).toEqual([]);
    expect(numbers(run).correct).toBe(true);
  });

  it('v2.4: the final suite flaked once on the validated stalk, and its re-run is green (seed 11)', () => {
    const run = runRace(FLAKY_SEED_11(V24_SETTINGS));

    const finals = eventsOf(run.events, 'ci.end', { purpose: 'final', check: 'suite' });
    expect(finals.map((event) => [event['green'], event['rerun'] ?? false])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(finals[0]?.['failing_files']).toEqual([FLAKY_TEST]);
    const final = eventsOf(run.events, 'final.check')[0];
    expect(eventsOf(run.events, 'green.promote').at(-1)?.['sha']).toBe(final?.['sha']);
    expect(final).toMatchObject({ suite_green: true, correct: true });
  });

  it('a genuinely red final suite stays red after its re-run', () => {
    const run = runRace({
      ...FLAKY_SEED_9(V24_SETTINGS),
      // Every commit passes its first run and fails every later one: the final suite runs a
      // commit validated green, and its re-run cannot turn it green.
      flakes: ({ nth }) => (nth >= 2 ? { file: FLAKY_TEST, name: 'fails from then on' } : null),
    });

    const finals = eventsOf(run.events, 'ci.end', { purpose: 'final', check: 'suite' });
    expect(finals.map((event) => event['green'])).toEqual([false, false]);
    expect(eventsOf(run.events, 'final.check')[0]).toMatchObject({ suite_green: false });
  });

  it('v2.0 (replay parity) keeps the harness’s single final suite run', () => {
    const run = runRace(FLAKY_SEED_9(V20_SETTINGS));

    const finals = eventsOf(run.events, 'ci.end', { purpose: 'final', check: 'suite' });
    expect(finals).toHaveLength(1);
  });
});
