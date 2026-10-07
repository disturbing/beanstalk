import { describe, expect, it } from 'vitest';

import { firstSteps, isStarted, sessionsPollMs } from './first-steps';

describe('the first-visit checklist', () => {
  it('starts with nothing done', () => {
    const steps = firstSteps({ sessions: 0, repositories: 0, repositoriesWithBeans: 0 });
    expect(steps.map((step) => [step.id, step.done])).toEqual([
      ['connect', false],
      ['repository', false],
      ['bean', false],
    ]);
    expect(isStarted(steps)).toBe(false);
  });

  it('ticks each step from its own fact, and is gone once all three are done', () => {
    expect(
      firstSteps({ sessions: 1, repositories: 1, repositoriesWithBeans: 0 }).map((s) => s.done),
    ).toEqual([true, true, false]);
    expect(isStarted(firstSteps({ sessions: 2, repositories: 1, repositoriesWithBeans: 1 }))).toBe(
      true,
    );
  });
});

describe('how often Home asks for sessions', () => {
  it('asks every 3 s until a session is connected and settled, then every 30 s', () => {
    expect(sessionsPollMs([])).toBe(3000);
    expect(sessionsPollMs([{ settling: true }])).toBe(3000);
    expect(sessionsPollMs([{ settling: false }, {}])).toBe(30_000);
  });
});
