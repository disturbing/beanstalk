import { describe, expect, it } from 'vitest';

import type { RunConfigInput } from '@beanstalk/shared-race/run-config';

import { buildSummary } from '../summary';
import { SEEDED_SCENARIOS, numbers } from '../testing/burst';
import type { FailRule } from '../testing/fake-world';
import type { RaceRun, RaceScenario } from '../testing/scenario';
import { eventsOf, runRace, soloTask, wellFormedProblems } from '../testing/scenario';
import { t032Loop } from '../testing/t032';

const V2: Partial<RunConfigInput> = { policy: 'beanstalk-v2', ci_seconds: 60 };
/** v2.5 as published: drop, with the 10-minute tail guard. */
const PARK_OFF: Partial<RunConfigInput> = { park: false, tail_guard_minutes: 10 };

function runV2(scenario: RaceScenario, config: Partial<RunConfigInput> = {}): RaceRun {
  return runRace({ ...scenario, config: { ...V2, ...scenario.config, ...config } });
}

/** Minutes from the race's start to its last green, its end and its final check. */
function tailOf(run: RaceRun): { lastGreen: number; end: number; final: number } {
  const greens = Object.values(run.state.tasks).flatMap((task) =>
    task.greenAt === null ? [] : [task.greenAt],
  );
  const at = (type: 'race.end' | 'final.check'): number =>
    Number(eventsOf(run.events, type)[0]?.t) / 60;
  return { lastGreen: Math.max(...greens) / 60, end: at('race.end'), final: at('final.check') };
}

/** t031's own invoice test pins $1000.00, which t005's separators change: both cannot hold. */
const contradiction: RaceScenario = {
  tasks: [soloTask('t005'), soloTask('t031', { stubborn: true })],
  rules: [
    {
      markers: ['impl:t005', 'impl:t031'],
      file: 'tests/t031.test.ts',
      name: 'prints $1000.00 on the invoice',
      reads: ['src/t005/index.ts', 'src/t031/index.ts'],
    },
  ],
  durations: { t005: 10_000, t031: 100_000 },
  config: { agents: 2 },
};

describe('parking: a bean that needs a person does not hold the race', () => {
  it('parks t032 after its re-execution is still red against the decided t005', () => {
    // Its search of six candidates costs a pre-land latency per probe batch (about 3 minutes):
    // the search's end counts as progress, so the demo's 3-minute bound lets the card decide,
    // and the card's verdict is what parks it.
    const scenario: RaceScenario = { ...t032Loop(), config: { agents: 4 } };
    const off = runV2(scenario, PARK_OFF);
    const on = runV2(scenario);

    expect(wellFormedProblems(on.events)).toEqual([]);
    expect(eventsOf(on.events, 'task.parked')).toEqual([
      expect.objectContaining({
        task: 't032',
        reason: 'needs a person: two specs disagree (t005)',
      }),
    ]);
    expect(on.state.tasks['t032']?.status).toBe('parked');
    // No rescue and no further rounds once the card's loser is red again.
    expect(eventsOf(on.events, 'rescue.start')).toEqual([]);
    expect(eventsOf(off.events, 'rescue.start')).toHaveLength(1);
    expect(eventsOf(on.events, 'task.drop')).toEqual([]);
    expect(eventsOf(on.events, 'final.check')[0]).toMatchObject({ correct: true });
    // Same greens, and the race ends sooner after the last of them (simulator: 3.3 min to the
    // last green; done at 12.3 min with park off, 11.0 with it on).
    expect(tailOf(on).lastGreen).toBeCloseTo(tailOf(off).lastGreen, 5);
    expect(tailOf(on).end).toBeLessThan(tailOf(off).end - 1);
    expect(tailOf(on).final - tailOf(on).end).toBeLessThan(0.2);
  });

  it('parks a genuine two-way contradiction and reports it in summary.json', () => {
    const off = runV2(contradiction, PARK_OFF);
    const on = runV2(contradiction);

    expect(on.state.tasks['t031']?.status).toBe('parked');
    expect(off.state.tasks['t031']?.status).toBe('dropped');
    expect(tailOf(on).end).toBeLessThan(tailOf(off).end - 1);
    const summary = buildSummary(on.state, on.env, on.state.endedAt ?? 0);
    expect(summary['tasks_dropped']).toBe(0);
    expect(summary['parked']).toEqual([
      { task: 't031', reason: 'needs a person: two specs disagree (t005)' },
    ]);
    expect(summary['tasks_green']).toBe(1);
    const offSummary = buildSummary(off.state, off.env, off.state.endedAt ?? 0);
    expect(offSummary).not.toHaveProperty('parked');
  });
});

describe('parking: the tail bounds park instead of dropping', () => {
  const stuck = soloTask('t001', {
    writes: { 'src/t001/index.ts': 'export const t001 = 1; // impl:t001 BUG:t001\n' },
    stubborn: true,
  });
  const bug: FailRule = { markers: ['BUG:t001'], file: 'tests/t001.test.ts', name: 't001 works' };

  it('parks a bean at max_bean_invocations', () => {
    const run = runV2(
      { tasks: [stuck], rules: [bug] },
      { agents: 1, max_rework: 20, tail_guard_minutes: 0 },
    );

    expect(eventsOf(run.events, 'task.parked', { task: 't001' })[0]).toMatchObject({
      reason: 'needs a person: still failing after 10 attempts',
    });
    const block = run.state.policy;
    expect(block?.kind === 'beanstalk-v2' ? (block.stats.invocation_drops ?? 0) : -1).toBe(0);
  });

  it('parks a bean that made no progress for 3 minutes once only stuck beans are left', () => {
    const run = runV2({
      tasks: [stuck, soloTask('t002')],
      rules: [bug],
      durations: { t001: 10_000, t002: 300_000 },
      // No rescue: a replay agent's rescue would fix the bug, and this bean must stay stuck.
      config: { agents: 2, max_rework: 20, rescue: false, max_bean_invocations: 0 },
    });

    expect(run.state.tasks['t002']?.status).toBe('green');
    const parked = eventsOf(run.events, 'task.parked', { task: 't001' })[0];
    expect(parked).toMatchObject({ reason: 'needs a person: no progress for 3 minutes' });
    const landed = eventsOf(run.events, 'land', { task: 't002' })[0];
    expect(Number(parked?.t) - Number(landed?.t)).toBeGreaterThanOrEqual(180);
    expect(Number(parked?.t) - Number(landed?.t)).toBeLessThan(180 + 180);
  });
});

describe('parking: a card only a person answers', () => {
  const clash: RaceScenario = {
    tasks: [
      soloTask('t001'),
      soloTask('t002', {
        writes: { 'src/t002/index.ts': 'export const t002 = 1; // impl:t002 BUG:t002\n' },
        stubborn: true,
      }),
      soloTask('t003'),
    ],
    rules: [
      {
        markers: ['impl:t001', 'BUG:t002'],
        file: 'tests/t001.test.ts',
        name: 't001 keeps working',
        reads: ['src/t001/index.ts', 'src/t002/index.ts'],
      },
    ],
    durations: { t001: 20_000, t002: 100_000, t003: 900_000 },
    config: { agents: 3, decision_mode: 'human' },
  };

  it('parks the bean while its card waits, and the race finishes without the person', () => {
    const run = runV2(clash);

    const request = eventsOf(run.events, 'decision.request', { task: 't002' })[0];
    expect(eventsOf(run.events, 'task.parked', { task: 't002' })[0]).toMatchObject({
      t: request?.t,
      reason: 'needs a person: decision card D001 (t002 vs t001)',
    });
    expect(eventsOf(run.events, 'decision.made')).toEqual([]);
    expect(run.state.tasks['t003']?.status).toBe('green');
    expect(eventsOf(run.events, 'race.end')[0]).toMatchObject({ aborted: null });
  });

  it('takes the bean up again when the person answers during the race', () => {
    const cardAt = Number(eventsOf(runV2(clash).events, 'decision.request')[0]?.t);
    const run = runV2({
      ...clash,
      injections: [
        {
          at: Math.round(cardAt * 1000) + 5_000,
          input: (at: number) => ({
            kind: 'decision' as const,
            at,
            card: 'D001',
            winner: 't001',
            actor: 'coop',
            text: null,
          }),
        },
      ],
    });

    expect(run.refusals).toEqual([]);
    expect(eventsOf(run.events, 'decision.made')[0]).toMatchObject({ oracle: 'human:coop' });
    expect(run.state.tasks['t002']?.status).not.toBe('parked');
    expect(eventsOf(run.events, 'rework.start', { task: 't002', reason: 'decision' })).toHaveLength(
      1,
    );
  });
});

describe('parking changes nothing else', () => {
  it('leaves the queue byte-identical', () => {
    const scenario: RaceScenario = {
      tasks: [soloTask('t001'), soloTask('t002'), soloTask('t003')],
    };
    const off = runRace({ ...scenario, config: { park: false } });
    const on = runRace({ ...scenario, config: { park: true } });

    expect(on.events).toEqual(off.events);
  });

  it.each(['burst', 'calm', 'earlier', 'flaky'] as const)(
    'runs the %s race exactly as v2.5 did (seeds 1 and 7)',
    (name) => {
      for (const seed of [1, 7]) {
        const make = SEEDED_SCENARIOS[name];
        const off = numbers(runV2(make(seed, {}), PARK_OFF));
        const on = numbers(runV2(make(seed, {})));
        expect(on).toEqual(off);
      }
    },
  );
});
