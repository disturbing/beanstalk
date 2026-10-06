import { describe, expect, it } from 'vitest';

import { TaskId } from '@beanstalk/shared-race/ids';

import { EPISODES, LONE, WHOLE_SUITE_UNREVERTABLE, studyEpisode } from '../testing/culprit-study';
import type { Outcome } from '../testing/culprit-study';
import type { RaceRun } from '../testing/scenario';
import { eventsOf, landingFlowOf, redCheckOf, runRace, v2StepAfter } from '../testing/scenario';
import { DECOYS, t032Loop } from '../testing/t032';
import { repairWithCulprits } from './v2-culprits';

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

describe('dynamic culprits: a search already answered empty is not run again', () => {
  /** The t032 loop: one search of six decoys, `confirmed: []` (two beans break t032 together). */
  const run: RaceRun = runRace({
    ...t032Loop(),
    config: { policy: 'beanstalk-v2', agents: 4, ci_seconds: 60, park: false },
  });
  const t032 = TaskId.parse('t032');

  /**
   * t032 red again, naming other counterparts than its searched red did (its test now reads
   * only the decoys: `cf-demo2-sonnet-30-s7`'s t032 searched three times under three named
   * sets), so the repeat rule does not apply; the candidates are the six already probed.
   */
  function redAgain(forget: 'keep' | 'forget-empty') {
    const step = v2StepAfter(run);
    if (forget === 'forget-empty') delete step.state.emptySearches;
    const flow = landingFlowOf(step, t032, 'a1');
    const before = { ...step.state.stats };
    repairWithCulprits(step, flow, {
      head: step.state.sprout,
      red: redCheckOf(
        'tests/t032.test.ts',
        DECOYS.map((id) => `src/${id}/index.ts`),
      ),
      mine: null,
      candidate: step.state.sprout,
    });
    return { step, flow, before };
  }

  it('records the six candidates the search probed without a culprit', () => {
    const search = eventsOf(run.events, 'culprit.dynamic', { task: 't032' });
    expect(search).toHaveLength(1);
    const policy = run.state.policy;
    const empty = policy?.kind === 'beanstalk-v2' ? policy.emptySearches?.['t032'] : undefined;
    const candidates = search[0]?.['candidates'];
    expect(Array.isArray(candidates)).toBe(true);
    expect(empty).toEqual([Array.isArray(candidates) ? candidates.map(String).toSorted() : []]);
  });

  it('skips a search over the same candidates, counted in dynamic_culprit_skips', () => {
    const { step, flow, before } = redAgain('keep');

    expect(flow.step.kind).not.toBe('culprit-probe');
    expect(step.state.stats.dynamic_culprit_runs).toBe(before.dynamic_culprit_runs);
    expect(step.state.stats.dynamic_culprit_skips).toBe((before.dynamic_culprit_skips ?? 0) + 1);
  });

  it('would have searched them again without the record', () => {
    const { step, flow, before } = redAgain('forget-empty');

    expect(flow.step.kind).toBe('culprit-probe');
    expect(step.state.stats.dynamic_culprit_runs).toBe(before.dynamic_culprit_runs + 1);
  });
});
