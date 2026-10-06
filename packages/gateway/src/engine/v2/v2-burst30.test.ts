import { describe, expect, it } from 'vitest';

import { DEMO_SETTINGS } from '@beanstalk/shared-race/run-config';

import { breakNumbers, burst30Scenario, redEpisodes } from '../testing/burst30';
import { eventsOf, runRace, wellFormedProblems } from '../testing/scenario';

/**
 * The 30-agent stall of `cf-demo-sonnet-30-s7` (`docs/claude-opus/11`, "30-agent
 * post-mortem"): a whole-suite break whose culprit cannot be reverted holds the sprout red
 * until a bean happens to fix it forward. The fixture other changes measure against.
 */
describe('burst30: the 30-agent stall, in the simulator', () => {
  it('reproduces the stall under the v2.5 demo preset (seed 7, 30 agents)', () => {
    const run = runRace(burst30Scenario(7, 30, { ...DEMO_SETTINGS }));

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(eventsOf(run.events, 'revert.conflict').length).toBeGreaterThanOrEqual(1);
    const [episode] = redEpisodes(run);
    expect(episode?.to).not.toBeNull();
    expect((episode?.to ?? 0) - (episode?.from ?? 0)).toBeGreaterThanOrEqual(5);
    const numbers = breakNumbers(run);
    expect(numbers).toMatchObject({ green: 37, parked: 3, dropped: 0, correct: true });
    expect(numbers.kth[30]).toBeGreaterThan(15);
    expect(numbers.kth[35]).toBeGreaterThan(25);
  });

  it('runs at 12 agents too', () => {
    const run = runRace(burst30Scenario(7, 12, { ...DEMO_SETTINGS }));

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(breakNumbers(run).correct).toBe(true);
  });
});
