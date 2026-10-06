import { describe, expect, it } from 'vitest';

import { raceCounters } from './race-counters';
import type { RaceEvent } from './race-events';
import { parseRaceEvents } from './race-events';
import { reduceRace } from './reduce-race';

const BASE = '26eecce0d764943d0c89a6139e3491055e9ff00c';
const SPROUT_1 = '822e661f90b8cd852d625acae8cc3ce36520d6cd';
const HEAD = 'b8da0156785efc5e20d5ec34f9db8fce173beed6';

/** A v2.2 race in a few events, as the gateway logs them. */
function v22Race(): readonly RaceEvent[] {
  const raw = [
    {
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
    },
    { type: 'task.start', task: 't001', agent: 'a0', base: BASE },
    {
      type: 'invocation.start',
      inv: 'inv0001-initial',
      kind: 'initial',
      task: 't001',
      agent: 'a0',
      attempt: 1,
    },
    {
      type: 'invocation.end',
      inv: 'inv0001-initial',
      kind: 'initial',
      task: 't001',
      agent: 'a0',
      ok: true,
      cost_usd: 0.1,
    },
    {
      type: 'task.commit',
      task: 't001',
      sha: HEAD,
      kind: 'initial',
      new_commit: true,
      files: ['src/a.ts'],
    },
    {
      type: 'preland.check',
      task: 't001',
      sha: HEAD,
      green: false,
      failing_tests: ['src/a.test.ts > works'],
      check_seconds: 61,
      inherited: true,
    },
    {
      type: 'decision.request',
      card: 'D001',
      task: 't002',
      against: ['t001'],
      specs: { t001: 'Spec one', t002: 'Spec two' },
      failing: ['src/a.test.ts > works'],
      attempts: 2,
    },
    {
      type: 'decision.made',
      card: 'D001',
      winner: 't001',
      loser: 't002',
      oracle: 'human:coop',
      wait_seconds: 12,
      outcome: 'keep-landed',
      text: 'Amounts keep separators everywhere.',
    },
    {
      type: 'invocation.start',
      inv: 'inv0002-test-author',
      kind: 'test-author',
      task: 't002',
      agent: 'a1',
      attempt: 1,
    },
    {
      type: 'invocation.end',
      inv: 'inv0002-test-author',
      kind: 'test-author',
      task: 't002',
      agent: 'a1',
      ok: true,
      cost_usd: 0.05,
    },
    {
      type: 'spec.amended',
      card: 'D001',
      task: 't002',
      status: 'amended',
      paths: ['src/b.test.ts'],
      in_place: false,
      fail_first: null,
      problems: [],
      inv: 'inv0002-test-author',
    },
    {
      type: 'land',
      task: 't001',
      ticket: null,
      kind: 'task',
      sha: SPROUT_1,
      target: 'trunk',
      trunk_idx: 0,
      files: ['src/a.ts'],
      unvalidated: 1,
    },
    {
      type: 'ci.end',
      ci: 'ci0001',
      sha: SPROUT_1,
      purpose: 'validate',
      green: false,
      slot: 0,
      failing_files: ['src/flaky.test.ts'],
      failing_tests: [],
      trunk_idx: 0,
    },
    {
      type: 'flake.suspected',
      trunk_idx: 0,
      sha: SPROUT_1,
      failing: ['src/flaky.test.ts'],
      rerun_failing: [],
      flaky: ['src/flaky.test.ts'],
    },
  ];
  const events = raw.map((fields, index) =>
    Object.assign(
      {
        seq: index + 1,
        t: index * 10,
        ts: new Date(Date.UTC(2026, 9, 4, 10, 0, index * 10)).toISOString(),
      },
      fields,
    ),
  );
  const parsed = parseRaceEvents(events);
  expect(parsed.skipped).toEqual([]);
  return parsed.events;
}

describe('the reducer on v2.2 events', () => {
  it('frees the agent once its bean is submitted when the run releases on check', () => {
    const events = v22Race();
    const atCheck = events.slice(0, 6);
    expect(reduceRace(atCheck).lanes[0]?.activity).toBe('blocked');
    const released = reduceRace(atCheck, { releaseOnCheck: true });
    expect(released.lanes[0]).toMatchObject({ activity: 'idle', bean: null });
    expect(released.beans['t001']?.phase).toBe('checking');
  });

  it('marks an inherited red as the sprout’s, without a rework', () => {
    const bean = reduceRace(v22Race()).beans['t001'];
    expect(bean?.reworks).toBe(0);
    expect(bean?.steps.find((step) => step.kind === 'check-red')?.detail).toContain(
      'inherited from the sprout',
    );
  });

  it('keeps the decision’s outcome, wording and the test author’s amendment on the card', () => {
    const state = reduceRace(v22Race());
    expect(state.cards[0]).toMatchObject({
      status: 'decided',
      winner: 't001',
      oracle: 'human:coop',
      outcome: 'keep-landed',
      text: 'Amounts keep separators everywhere.',
      amendment: { status: 'amended', paths: ['src/b.test.ts'] },
    });
  });

  it('counts the test author like any agent invocation', () => {
    const state = reduceRace(v22Race());
    expect(state.totals.invocations).toEqual({ initial: 1, 'test-author': 1 });
    expect(raceCounters(state).costUsd).toBeCloseTo(0.15, 10);
  });

  it('does not blame a commit for a red that a re-run did not repeat', () => {
    const state = reduceRace(v22Race());
    expect(state.flaky).toEqual(['src/flaky.test.ts']);
    expect(state.line.commits[0]?.status).not.toBe('red');
  });
});

describe('the reducer on a parked bean', () => {
  it('shows the bean as needing a person and frees its lane', () => {
    const parsed = parseRaceEvents([
      {
        seq: 999,
        t: 600,
        ts: new Date(Date.UTC(2026, 9, 4, 10, 10)).toISOString(),
        type: 'task.parked',
        task: 't001',
        reason: 'needs a person: two specs disagree (t002)',
      },
    ]);
    expect(parsed.skipped).toEqual([]);
    const state = reduceRace([...v22Race().slice(0, 6), ...parsed.events]);
    const bean = state.beans['t001'];
    expect(bean?.phase).toBe('parked');
    expect(bean?.steps.at(-1)).toMatchObject({
      kind: 'parked',
      detail: 'needs a person: two specs disagree (t002)',
    });
    expect(state.lanes[0]).toMatchObject({ bean: null });
  });
});
