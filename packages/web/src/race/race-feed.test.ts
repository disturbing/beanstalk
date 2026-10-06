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
    const lines = recentFeed(eventsOf('j6boaclinn'), 10);
    expect(lines).toHaveLength(10);
    expect(lines[0]?.text).toBe('Final check: the stalk is correct, 39 of 40 beans accepted.');
    expect(
      lines.every((line, index) => index === 0 || (lines[index - 1]?.seq ?? 0) > line.seq),
    ).toBe(true);
  });

  it('tells a start card and its decision in plain words, as moments for a person', () => {
    const lines = recentFeed(eventsOf('j6boaclinn'), 1000).filter((line) => line.tone === 'human');
    const texts = lines.map((line) => line.text).toReversed();
    expect(texts[0]).toBe(
      'Start card D001: t022 would undo t002. A person decides before it starts.',
    );
    expect(texts[1]).toMatch(/^D001 decided: keep t002, re-execute t022\. "Where the two specs/);
  });

  it('shows the v2.5 moments: a rescue, a structural merge, the sprout window', () => {
    const texts = recentFeed(eventsOf('j6boaclinn'), 1000).map((line) => line.text);
    expect(texts).toContain(
      't015 is rescued: re-executed once on the sprout head (unresolved conflict).',
    );
    expect(texts).toContain('t034 lands on the sprout as #12, after a structural merge.');
    expect(texts).toContain('The sprout window grows to 10.');
  });

  it('announces the queue bisecting a red batch', () => {
    const lines = recentFeed(eventsOf('u0ntf65lbe'), 1000);
    expect(lines.some((line) => line.text.startsWith('Bisection blames t018'))).toBe(true);
  });
});
