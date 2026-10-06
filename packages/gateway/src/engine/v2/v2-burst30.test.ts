import { describe, expect, it } from 'vitest';

import { DEMO_SETTINGS, STALL_FIX_OFF } from '@beanstalk/shared-race/run-config';

import { breakNumbers, burst30Scenario, redEpisodes } from '../testing/burst30';
import { eventsOf, runRace, wellFormedProblems } from '../testing/scenario';

/**
 * The 30-agent stall of `cf-demo-sonnet-30-s7` (`docs/claude-opus/11`, "30-agent
 * post-mortem"): a whole-suite break whose culprit cannot be reverted holds the sprout red
 * until a bean happens to fix it forward. The fixture other changes measure against.
 */
describe('burst30: the 30-agent stall, in the simulator', () => {
  // These simulations can exceed 5 s under parallel suite load, like the dependency-chain fixtures.
  it(
    'reproduces the stall under the v2.5 demo preset (seed 7, 30 agents)',
    { timeout: 30_000 },
    () => {
      const run = runRace(burst30Scenario(7, 30, { ...DEMO_SETTINGS, ...STALL_FIX_OFF }));

      expect(wellFormedProblems(run.events)).toEqual([]);
      expect(eventsOf(run.events, 'revert.conflict').length).toBeGreaterThanOrEqual(1);
      const [episode] = redEpisodes(run);
      expect(episode?.to).not.toBeNull();
      expect((episode?.to ?? 0) - (episode?.from ?? 0)).toBeGreaterThanOrEqual(5);
      const numbers = breakNumbers(run);
      // With the scheduler starvation fix (age and stall bounds) one more task parks: 36 green, 4 parked.
      expect(numbers).toMatchObject({ green: 36, parked: 4, dropped: 0, correct: true });
      expect(numbers.kth[30]).toBeGreaterThan(15);
      // The 35th green came at about 27 min before the starvation fix, about 20.5 min after it.
      expect(numbers.kth[35]).toBeGreaterThan(18);
    },
  );

  it(
    'the red-window reset ends the stall: green again at once, the culprits repaired by their authors',
    { timeout: 30_000 },
    () => {
      const before = breakNumbers(
        runRace(burst30Scenario(7, 30, { ...DEMO_SETTINGS, ...STALL_FIX_OFF })),
      );
      const run = runRace(burst30Scenario(7, 30, { ...DEMO_SETTINGS }));

      expect(wellFormedProblems(run.events)).toEqual([]);
      expect(eventsOf(run.events, 'sprout.reset').length).toBeGreaterThanOrEqual(1);
      expect(eventsOf(run.events, 'ticket.escalate')).toHaveLength(
        eventsOf(run.events, 'ticket.open').length,
      );
      expect(eventsOf(run.events, 'revert')).toEqual([]);
      expect(eventsOf(run.events, 'ci.start', { purpose: 'bisect' })).toEqual([]);
      for (const episode of redEpisodes(run)) {
        expect((episode.to ?? Infinity) - episode.from).toBeLessThan(2);
      }
      const [reset] = eventsOf(run.events, 'sprout.reset');
      const lateVerdicts = eventsOf(run.events, 'ci.end', { purpose: 'validate' }).filter(
        (event) =>
          event.t > (reset?.t ?? Infinity) &&
          event['cancelled'] !== true &&
          Number(event['trunk_idx']) < Number(reset?.['trunk_idx']),
      );
      expect(lateVerdicts).toEqual([]);
      const after = breakNumbers(run);
      expect(after.correct).toBe(true);
      expect(after.green).toBeGreaterThan(before.green);
      expect(after.kth[30] ?? Infinity).toBeLessThan(before.kth[30] ?? 0);
      expect(after.kth[35] ?? Infinity).toBeLessThan(before.kth[35] ?? 0);
      // Seed 7 as measured (README, "Fixes and simulator scenarios"): 39 green, t023 parked.
      expect(after).toMatchObject({ green: 39, parked: 1, dropped: 0 });
      expect(after.kth[30]).toBeCloseTo(12.84, 1);
      expect(after.done).toBeCloseTo(22.04, 1);
    },
  );

  it(
    'a red check on a tree the reset discarded is re-checked: no round, no culprit',
    { timeout: 30_000 },
    () => {
      const run = runRace(burst30Scenario(7, 30, { ...DEMO_SETTINGS }));

      const [reset] = eventsOf(run.events, 'sprout.reset');
      const stale = eventsOf(run.events, 'preland.recheck').filter(
        (event) => event.t >= Number(reset?.t) && event['stale'] !== undefined,
      );
      expect(stale.length).toBeGreaterThanOrEqual(1);
      // t031 was checked on the discarded window: it no longer blames t001 and t002 for it.
      const blamed = eventsOf(run.events, 'rework.start', { task: 't031' }).flatMap((event) =>
        Array.isArray(event['culprits']) ? event['culprits'] : [],
      );
      expect(blamed).not.toContain('t001');
      expect(blamed).not.toContain('t002');
      expect(eventsOf(run.events, 'rework.start')).toHaveLength(12);
    },
  );

  it('runs at 12 agents too', () => {
    const run = runRace(burst30Scenario(7, 12, { ...DEMO_SETTINGS }));

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(breakNumbers(run).correct).toBe(true);
  });
});
