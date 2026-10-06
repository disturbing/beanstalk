import { describe, expect, it } from 'vitest';

import { raceCounters } from './race-counters';
import { parseRaceEvents } from './race-events';
import { reduceRace } from './reduce-race';

const BASE = '26eecce0d764943d0c89a6139e3491055e9ff00c';
const SHA_A = '822e661f90b8cd852d625acae8cc3ce36520d6cd';
const SHA_B = 'b8da0156785efc5e20d5ec34f9db8fce173beed6';

const START = {
  type: 'race.start',
  policy: 'beanstalk',
  agent: 'claude',
  model: 'sonnet',
  agents: 2,
  ci_seconds: 60,
  ci_slots: 2,
  batch: 4,
  tasks: ['t001', 't002'],
  budget_usd: 10,
  seed: 7,
  base: BASE,
};

function reduceRaw(raw: readonly Record<string, unknown>[]) {
  const events = raw.map((fields, index) => ({
    seq: index + 1,
    t: index * 10,
    ts: new Date(Date.UTC(2026, 9, 4, 10, 0, index * 10)).toISOString(),
    ...fields,
  }));
  const parsed = parseRaceEvents(events);
  expect(parsed.skipped).toEqual([]);
  return reduceRace(parsed.events);
}

describe('the reducer on events the engine emits', () => {
  it('does not count a parked bean as in flight', () => {
    const state = reduceRaw([
      START,
      { type: 'task.start', task: 't001', agent: 'a0', base: BASE },
      { type: 'task.start', task: 't002', agent: 'a1', base: BASE },
      { type: 'task.parked', task: 't002', reason: 'waiting for a person' },
    ]);
    expect(state.beans['t002']?.phase).toBe('parked');
    expect(raceCounters(state).inFlight).toBe(1);
  });

  it('folds ticket.stuck into an escalated ticket', () => {
    const state = reduceRaw([
      START,
      { type: 'ticket.open', ticket: 'T1', red_idx: 3, failing: ['src/a.test.ts'] },
      { type: 'ticket.stuck', ticket: 'T1', culprit_idx: 2 },
    ]);
    expect(state.tickets[0]).toMatchObject({ ticket: 'T1', status: 'escalated' });
  });

  it('keeps a reset sprout green after promotion without a validation', () => {
    const state = reduceRaw([
      START,
      { type: 'ticket.open', ticket: 'T1', red_idx: 1, failing: ['src/a.test.ts'] },
      {
        type: 'sprout.reset',
        ticket: 'T1',
        red_idx: 1,
        green_idx: 0,
        trunk_idx: 2,
        sha: SHA_B,
        requeued: [],
      },
      { type: 'green.promote', sha: SHA_B, trunk_idx: 2, tasks: [] },
    ]);
    expect(state.line.stalkIdx).toBe(2);
    expect(state.line.commits.find((commit) => commit.idx === 2)?.status).toBe('green');
  });

  it('accepts a sample of each event the engine adds beyond the first schema', () => {
    const parsed = parseRaceEvents(
      [
        {
          type: 'land',
          task: 't001',
          ticket: null,
          kind: 'task',
          sha: SHA_A,
          target: 'trunk',
          trunk_idx: 0,
          files: ['src/a.ts'],
          unvalidated: 1,
          prelanded: true,
          resolved: 'structural',
        },
        { type: 'bean.requeued', task: 't001', ticket: 'T1', trunk_idx: 0 },
        { type: 'rescue.start', task: 't001', why: 'unresolved conflict', rounds: 2 },
        { type: 'culprit.dynamic', task: 't001', candidates: ['t002'], confirmed: [] },
        {
          type: 'decision.reconcile',
          task: 't001',
          against: 't002',
          outcome: 'reconciled',
          files: [],
          reason: null,
          inv: 'inv0001-reconcile',
          parties: ['t002'],
        },
        {
          type: 'preland.check',
          task: 't001',
          sha: SHA_A,
          green: true,
          failing_tests: [],
          check_seconds: 3,
          targets: ['src/a.test.ts'],
        },
        { type: 'ci.start', ci: 'c1', sha: SHA_A, purpose: 'final', slot: 0, rerun: true },
        {
          type: 'ci.end',
          ci: 'c1',
          sha: SHA_A,
          purpose: 'final',
          green: true,
          slot: 0,
          rerun: true,
        },
      ].map((fields, index) => ({
        seq: index + 1,
        t: index,
        ts: '2026-10-04T10:00:00Z',
        ...fields,
      })),
    );
    expect(parsed.skipped).toEqual([]);
    expect(parsed.events).toHaveLength(8);
  });
});
