import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import queueSummaryText from '../../fixtures/u0ntf65lbe/summary.json?raw';
import beanstalkSummaryText from '../../fixtures/j6boaclinn/summary.json?raw';
import { recordedRun } from '../recorded/recorded-runs';
import { costAt, kthGreenAt, raceCounters } from '@beanstalk/shared-ask/race/race-counters';
import { parseRaceEvents } from '@beanstalk/shared-ask/race/race-events';
import type { RaceState } from '@beanstalk/shared-ask/race/race-state';
import { mean, percentile, roundTo } from './race-stats';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';

const Minutes = z.object({ busy: z.number(), blocked: z.number(), idle: z.number() });

/** The fields of `summary.json` the canvas must reproduce. */
const Summary = z.object({
  wall_seconds: z.number(),
  tasks: z.number(),
  tasks_green: z.number(),
  tasks_landed: z.number(),
  tasks_dropped: z.number(),
  drops_by_reason: z.record(z.string(), z.number()),
  cost_usd: z.number(),
  red_validations: z.number(),
  textual_conflicts: z.number(),
  invocations: z.record(z.string(), z.number()),
  ci_runs: z.record(z.string(), z.number()),
  agent_minutes_per_agent: z.record(z.string(), Minutes),
  task_start_to_green_seconds: z.object({
    median: z.number().nullable(),
    p90: z.number().nullable(),
    mean: z.number().nullable(),
  }),
  final: z.object({ correct: z.boolean(), tasks_accepted: z.number() }),
  per_task: z.record(
    z.string(),
    z.object({
      status: z.string(),
      agent: z.string().nullable(),
      started_at: z.number().nullable(),
      landed_at: z.number().nullable(),
      green_at: z.number().nullable(),
      drop_reason: z.string().nullable(),
    }),
  ),
  beanstalk: z
    .object({
      cards: z.number(),
      release_on_check: z.boolean().optional(),
      card_details: z.array(z.object({ card: z.string(), task: z.string(), winner: z.string() })),
    })
    .optional(),
});
type Summary = z.infer<typeof Summary>;

const FIXTURES = [
  {
    name: 'beanstalk v2.5',
    run: 'j6boaclinn',
    summary: Summary.parse(JSON.parse(beanstalkSummaryText)),
  },
  { name: 'merge queue', run: 'u0ntf65lbe', summary: Summary.parse(JSON.parse(queueSummaryText)) },
];

function finalState(run: string): RaceState {
  const recorded = recordedRun(run);
  if (recorded === undefined) throw new Error(`no fixture ${run}`);
  return reduceRace(recorded.events, recorded.options);
}

function eventsOf(run: string) {
  const recorded = recordedRun(run);
  if (recorded === undefined) throw new Error(`no fixture ${run}`);
  return recorded.events;
}

/** `Counter(reason.split(":")[0].split(" after ")[0])`, as summary.py groups drops. */
function dropsByReason(state: RaceState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const bean of Object.values(state.beans)) {
    if (bean.phase !== 'dropped') continue;
    const reason = (bean.dropReason ?? '?').split(':')[0]?.split(' after ')[0] ?? '?';
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

describe.each(FIXTURES)('the reducer on the recorded $name run', ({ run, summary }) => {
  const state = finalState(run);
  const counters = raceCounters(state);

  it('reproduces the header counters of summary.json', () => {
    expect(counters.beans).toBe(summary.tasks);
    expect(counters.landed).toBe(summary.tasks_landed);
    expect(counters.green).toBe(summary.tasks_green);
    expect(counters.dropped).toBe(summary.tasks_dropped);
    expect(roundTo(counters.costUsd, 4)).toBe(summary.cost_usd);
    expect(counters.redValidations).toBe(summary.red_validations);
    expect(counters.cards).toBe(summary.beanstalk?.cards ?? 0);
    expect(counters.conflicts).toBe(summary.textual_conflicts);
  });

  it('measures the race from race.start to race.end as wall_seconds', () => {
    expect(counters.wallSeconds).not.toBeNull();
    expect(roundTo(counters.wallSeconds ?? 0, 2)).toBe(summary.wall_seconds);
  });

  it('counts invocations, CI runs and drop reasons like the summary', () => {
    expect(state.totals.invocations).toEqual(summary.invocations);
    expect(state.totals.ciRuns).toEqual(summary.ci_runs);
    expect(dropsByReason(state)).toEqual(summary.drops_by_reason);
  });

  it('times every bean like per_task: start, landing and green', () => {
    const t0 = state.meta?.startedAt ?? 0;
    const relative = (value: number | null) => (value === null ? null : roundTo(value - t0, 3));
    for (const [id, expected] of Object.entries(summary.per_task)) {
      const bean = state.beans[id];
      expect(bean, id).toBeDefined();
      expect({
        status: bean?.phase,
        agent: bean?.agent,
        started: relative(bean?.startedAt ?? null),
        landed: relative(bean?.landedAt ?? null),
        green: relative(bean?.greenAt ?? null),
        dropReason: bean?.dropReason,
      }).toEqual({
        status: expected.status,
        agent: expected.agent,
        started: expected.started_at,
        landed: expected.landed_at,
        green: expected.green_at,
        dropReason: expected.drop_reason,
      });
    }
  });

  it('reproduces task start to green: median, p90 and mean', () => {
    const spans = Object.values(state.beans).flatMap((bean) =>
      bean.greenAt === null || bean.startedAt === null ? [] : [bean.greenAt - bean.startedAt],
    );
    expect(percentile(spans, 0.5)).toBe(summary.task_start_to_green_seconds.median);
    expect(percentile(spans, 0.9)).toBe(summary.task_start_to_green_seconds.p90);
    expect(roundTo(mean(spans) ?? 0, 2)).toBe(summary.task_start_to_green_seconds.mean);
  });

  it('keeps each lane clock within a second of the harness (busy, blocked, idle)', () => {
    for (const lane of state.lanes) {
      const expected = summary.agent_minutes_per_agent[lane.slot];
      expect(expected, lane.slot).toBeDefined();
      for (const activity of ['busy', 'blocked', 'idle'] as const) {
        const laneMinutes = lane.totals[activity] / 60;
        expect(
          Math.abs(laneMinutes - (expected?.[activity] ?? 0)),
          `${lane.slot} ${activity}`,
        ).toBeLessThan(1 / 60 + 0.005);
      }
    }
  });

  it('draws each lane as contiguous segments that add up to its clock', () => {
    for (const lane of state.lanes) {
      const sums = { busy: 0, blocked: 0, idle: 0 };
      lane.segments.forEach((segment, index) => {
        sums[segment.activity] += segment.to - segment.from;
        const previous = lane.segments[index - 1];
        if (previous !== undefined) expect(segment.from).toBe(previous.to);
      });
      for (const activity of ['busy', 'blocked', 'idle'] as const) {
        expect(sums[activity]).toBeCloseTo(lane.totals[activity], 6);
      }
    }
  });

  it('ends with every agent idle, nothing in flight and the stalk at the line head', () => {
    expect(state.phase).toBe('ended');
    expect(state.lanes.every((lane) => lane.activity === 'idle' && lane.bean === null)).toBe(true);
    expect(counters.inFlight).toBe(0);
    expect(state.line.commits).toHaveLength(summary.tasks_landed);
    expect(state.line.stalkIdx).toBe(state.line.commits.length - 1);
    expect(state.final?.correct).toBe(summary.final.correct);
    expect(state.final?.tasksAccepted).toBe(summary.final.tasks_accepted);
  });

  it('never loses a green while the run replays', () => {
    const events = eventsOf(run);
    let previous = 0;
    for (let count = 0; count <= events.length; count += 25) {
      const greens = raceCounters(reduceRace(events.slice(0, count))).green;
      expect(greens).toBeGreaterThanOrEqual(previous);
      previous = greens;
    }
  });
});

function kthGreenMinutes(run: string, k: number): string | null {
  const at = kthGreenAt(raceCounters(finalState(run)), k);
  return at === null ? null : (at / 60).toFixed(1);
}

describe('time and money to the k-th green (research/race/kth_green.py, docs/claude-opus/12)', () => {
  it('puts beanstalk v2.5 at 7.7, 15.7 and 17.1 minutes to the 20th, 30th and 35th green', () => {
    expect([20, 30, 35].map((k) => kthGreenMinutes('j6boaclinn', k))).toEqual([
      '7.7',
      '15.7',
      '17.1',
    ]);
  });

  it('puts the merge queue at 13.0, 19.9 and 35.0 minutes', () => {
    expect([20, 30, 35].map((k) => kthGreenMinutes('u0ntf65lbe', k))).toEqual([
      '13.0',
      '19.9',
      '35.0',
    ]);
  });

  it('prices the 20th green from the invocations that ended by then', () => {
    const events = eventsOf('j6boaclinn');
    const at = kthGreenAt(raceCounters(reduceRace(events)), 20) ?? 0;
    expect(costAt(events, at).toFixed(2)).toBe('2.36');
  });
});

describe('the decision cards of the v2.5 run', () => {
  it('records the start card D001: t022 against t002, decided for t002 by the landed oracle', () => {
    const card = finalState('j6boaclinn').cards[0];
    expect(card).toMatchObject({
      card: 'D001',
      task: 't022',
      against: ['t002'],
      trigger: 'start',
      status: 'decided',
      winner: 't002',
      loser: 't022',
      oracle: 'landed',
      outcome: 'keep-landed',
    });
    expect(card?.specs).toEqual({
      t022: 'Customers cannot list their invoices',
      t002: 'Paged lists should report the total number of results',
    });
  });

  it('shows the card open, and the bean waiting on it, between request and answer', () => {
    const events = eventsOf('j6boaclinn');
    const requestAt = events.findIndex((event) => event.type === 'decision.request');
    const state = reduceRace(events.slice(0, requestAt + 1));
    expect(raceCounters(state).openCards).toBe(1);
    expect(state.beans['t022']?.phase).toBe('deciding');
  });

  it('matches the summary: 8 cards, 3 of them start cards, and the winner of each', () => {
    const state = finalState('j6boaclinn');
    expect(state.cards.filter((card) => card.trigger === 'start')).toHaveLength(3);
    const details = FIXTURES[0]?.summary.beanstalk?.card_details ?? [];
    expect(state.cards.map(({ card, task, winner }) => ({ card, task, winner }))).toEqual(
      details.map(({ card, task, winner }) => ({ card, task, winner })),
    );
  });

  it('keeps the steps of the v2.5 engine on each bean: rescue, culprit search, reconcile', () => {
    const steps = Object.values(finalState('j6boaclinn').beans).flatMap((bean) => bean.steps);
    const kinds = (kind: string) => steps.filter((step) => step.kind === kind).length;
    expect([kinds('rescue'), kinds('culprits'), kinds('reconcile'), kinds('window')]).toEqual([
      2, 7, 5, 20,
    ]);
    expect(steps.filter((step) => step.detail.includes('structural merge')).length).toBe(
      eventsOf('j6boaclinn').filter((event) => event.type === 'land' && event.resolved).length,
    );
  });
});

describe('the recorded options', () => {
  it('free the agent at the pre-land check exactly when the run did', () => {
    for (const { run, summary } of FIXTURES) {
      expect(recordedRun(run)?.options.releaseOnCheck ?? false, run).toBe(
        summary.beanstalk?.release_on_check ?? false,
      );
    }
  });
});

describe('parsing events', () => {
  it('skips unknown event types and malformed events instead of failing', () => {
    const parsed = parseRaceEvents([
      '{"seq":1,"t":0,"ts":"2026-10-03T00:00:00.000+00:00","type":"bean.release","task":"t001"}',
      '{"seq":2,"t":0.5,"ts":"2026-10-03T00:00:00.500+00:00","type":"abort","reason":"stop"}',
      'not json',
      { seq: 3, t: 1, ts: '2026-10-03T00:00:01.000+00:00', type: 'land', sha: 'nope' },
    ]);
    expect(parsed.events.map((event) => event.type)).toEqual(['abort']);
    expect(parsed.skipped.map((skip) => [skip.seq, skip.kind])).toEqual([
      [1, 'unknown'],
      [null, 'invalid'],
      [3, 'invalid'],
    ]);
    expect(parsed.skipped[0]?.reason).toBe('unknown type bean.release');
  });
});
