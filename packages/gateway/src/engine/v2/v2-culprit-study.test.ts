import { describe, expect, it } from 'vitest';

import { EPISODES, LONE, WHOLE_SUITE_UNREVERTABLE, studyEpisode } from '../testing/culprit-study';
import type { Outcome } from '../testing/culprit-study';

/**
 * The culprit-isolation study of the 30-agent post-mortem (`docs/claude-opus/11`): a model,
 * not the engine. These pin the findings the recommendation rests on.
 */
function outcome(outcomes: readonly Outcome[], prefix: string): Outcome {
  const found = outcomes.find((candidate) => candidate.strategy.startsWith(prefix));
  if (found === undefined) throw new Error(`no strategy ${prefix}`);
  return found;
}

describe('culprit isolation, the simulation study', () => {
  it("matches the real stall under today's bisect: wrong blames and a late green", () => {
    const today = outcome(studyEpisode(WHOLE_SUITE_UNREVERTABLE), "today's bisect (");

    // Real race: two innocent beans reverted (t022, t009), green 16.9 minutes after the red.
    expect(today.wrongBlames).toBeGreaterThanOrEqual(2);
    expect(today.green ?? Infinity).toBeGreaterThanOrEqual(15 * 60);
  });

  it('leave-one-out cannot name an unrevertable culprit, in CI or in sandboxes', () => {
    const outcomes = studyEpisode(WHOLE_SUITE_UNREVERTABLE);

    expect(outcome(outcomes, 'leave-one-out, newest').isolate).toBeNull();
    expect(outcome(outcomes, 'leave-one-out in agent').isolate).toBeNull();
  });

  it('revert-then-requeue is green soonest with no wrong blame and no CI, in every episode', () => {
    for (const episode of EPISODES) {
      const outcomes = studyEpisode(episode);
      const requeue = outcome(outcomes, 'revert-then-requeue');
      expect(requeue).toMatchObject({ wrongBlames: 0, ciSeconds: 0 });
      for (const other of outcomes) {
        expect(requeue.green ?? Infinity).toBeLessThanOrEqual(other.green ?? Infinity);
      }
    }
  });

  it('a lone read-set suspect is as good as a requeue and displaces one bean, not the window', () => {
    const outcomes = studyEpisode(LONE);
    const lone = outcome(outcomes, 'lone-suspect');
    const requeue = outcome(outcomes, 'revert-then-requeue');

    expect(lone.displaced).toBe(1);
    expect(requeue.displaced).toBe(LONE.window);
    expect(lone.heldBeanMinutes ?? Infinity).toBeLessThanOrEqual(requeue.heldBeanMinutes ?? 0);
  });
});
