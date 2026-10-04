import { describe, expect, it } from 'vitest';

import type { ScriptedTask } from './testing/fake-world';
import type { RaceScenario } from './testing/scenario';
import { runRace, soloTask } from './testing/scenario';

const shared = (id: string): ScriptedTask => ({
  id,
  writes: { 'src/shared.ts': `export const owner = '${id}'; // impl:${id}\n` },
});

const contested = (seed: number): RaceScenario => {
  return {
    seed,
    tasks: [
      shared('t001'),
      shared('t002'),
      { id: 't003', writes: { 'src/t003.ts': "export const t003 = 'BUG:t003'; // impl:t003\n" } },
      soloTask('t004'),
      soloTask('t005', { flakyInitialRuns: 1 }),
    ],
    rules: [{ markers: ['BUG:t003'], file: 'tests/t003.test.ts', name: 't003 works' }],
    config: { agents: 3, ci_slots: 2, batch: 2 },
  };
};

describe('determinism', () => {
  it('replays the same race event for event from the same seed', () => {
    const first = runRace(contested(7));
    const second = runRace(contested(7));

    expect(second.events).toEqual(first.events);
    expect(second.state).toEqual(first.state);
  });

  it('changes the race when the seed changes the agents timings', () => {
    const first = runRace(contested(7));
    const other = runRace(contested(8));

    expect(other.events).not.toEqual(first.events);
  });
});
