import { describe, expect, it } from 'vitest';

import { recordedRun } from '../recorded/recorded-runs';
import { recentFeed } from './race-feed';

function eventsOf(run: string) {
  const recorded = recordedRun(run);
  if (recorded === undefined) throw new Error(`no fixture ${run}`);
  return recorded.events;
}

describe('the event feed', () => {
  it('lists the newest lines first and skips routine events', () => {
    const lines = recentFeed(eventsOf('7z4j84eqvl'), 10);
    expect(lines).toHaveLength(10);
    expect(lines[0]?.text).toBe('Final check: the stalk is correct, 35 of 40 beans accepted.');
    expect(
      lines.every((line, index) => index === 0 || (lines[index - 1]?.seq ?? 0) > line.seq),
    ).toBe(true);
  });

  it('tells the decision in plain words, as a moment for a person', () => {
    const lines = recentFeed(eventsOf('7z4j84eqvl'), 1000).filter((line) => line.tone === 'human');
    expect(lines.map((line) => line.text).toReversed()).toEqual([
      'Decision D001: t032 and t005 disagree. A person decides.',
      'D001 decided: keep t005, decline t032.',
    ]);
  });

  it('announces the queue bisecting a red batch', () => {
    const lines = recentFeed(eventsOf('u0ntf65lbe'), 1000);
    expect(lines.some((line) => line.text.startsWith('Bisection blames t018'))).toBe(true);
  });
});
