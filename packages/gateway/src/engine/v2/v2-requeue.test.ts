import { describe, expect, it } from 'vitest';

import { DEMO_SETTINGS } from '@beanstalk/shared-race/run-config';

import { SEEDED_SCENARIOS, numbers } from '../testing/burst';
import type { LooseEvent, RaceRun } from '../testing/scenario';
import { eventsOf, runRace, wellFormedProblems } from '../testing/scenario';

/**
 * The burst's tail after the red-window reset (`docs/claude-opus/11`, "Check reuse and the
 * burst tail"), seed 3: two resets requeue the pair culprits t016 and t022, and without
 * `requeue_repair` every reset's suspects wait in one chain, each until the one before it
 * landed or left (t019's card held t010, t003, t022 and t016 back for ten minutes).
 */
function burstSeed3(requeueRepair: boolean): RaceRun {
  return runRace(SEEDED_SCENARIOS.burst(3, { ...DEMO_SETTINGS, requeue_repair: requeueRepair }));
}

/** The bean's events after `after`, in order. */
function eventsAfter(run: RaceRun, task: string, after: LooseEvent): LooseEvent[] {
  return run.events.filter((event) => event.seq > after.seq && event['task'] === task);
}

describe('requeue repair (`requeue_repair`)', () => {
  it('ends the burst sooner, with as many greens and a correct stalk', () => {
    const before = numbers(burstSeed3(false));
    const run = burstSeed3(true);
    const after = numbers(run);

    expect(wellFormedProblems(run.events)).toEqual([]);
    expect(after.correct).toBe(true);
    expect(after.green).toBeGreaterThanOrEqual(before.green);
    expect(after.done_minutes).toBeLessThan(before.done_minutes);
  });

  it('sends two suspects of one reset that are red against each other to reconcile at once', () => {
    const run = burstSeed3(true);

    const reset = eventsOf(run.events, 'sprout.reset').at(-1);
    expect(reset).toBeDefined();
    const requeued = eventsOf(run.events, 'bean.requeued').filter(
      (event) => event['ticket'] === reset?.['ticket'],
    );
    const firstReds = requeued.flatMap((event) => {
      const red = eventsAfter(run, String(event['task']), event).find(
        (later) => later.type === 'preland.check' && later['green'] === false,
      );
      return red === undefined ? [] : [{ task: String(event['task']), red }];
    });
    expect(firstReds.length).toBeGreaterThan(0);
    for (const { task, red } of firstReds) {
      const next = eventsAfter(run, task, red).find(
        (later) => later.type === 'invocation.start' || later.type === 'rework.start',
      );
      expect(next).toMatchObject({ type: 'invocation.start', kind: 'reconcile' });
    }
  });
});
