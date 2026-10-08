import { describe, expect, it } from 'vitest';

import type { LeaseRequest, PoolLimits, PoolState, SandboxLease } from './sandbox-pool';
import { WAITING_FRESH_MS, decideLease } from './sandbox-pool';

const LIMITS: PoolLimits = { instances: 48, headroom: 2, floor: 2 };
const NOW = 1_000_000;
const EMPTY: PoolState = { races: [], leases: [], engines: [] };

function ask(engine: string, job: string, cap = 32): LeaseRequest {
  return { engine, job, cap, base: 3, nowMs: NOW };
}

function leases(engine: string, count: number, from = 0): SandboxLease[] {
  return Array.from({ length: count }, (_, offset) => ({
    engine,
    job: `job-${engine}-${from + offset}`,
    index: from + offset,
    untilMs: NOW + 60_000,
  }));
}

describe('decideLease', () => {
  it('gives a bean in check its own sandbox, the lowest index free', () => {
    const state = { ...EMPTY, leases: [...leases('r1', 1), ...leases('r1', 1, 2)] };
    expect(decideLease(state, ask('r1', 'job9'), LIMITS)).toEqual({
      kind: 'granted',
      index: 1,
      isRenewal: false,
    });
  });

  it('answers a job that already holds a sandbox with the same one', () => {
    const state = { ...EMPTY, leases: leases('r1', 3) };
    expect(decideLease(state, ask('r1', 'job-r1-2'), LIMITS)).toEqual({
      kind: 'granted',
      index: 2,
      isRenewal: true,
    });
  });

  it('lets 32 beans of one repository check at once on an otherwise idle pool', () => {
    const held: SandboxLease[] = [];
    for (let bean = 0; bean < 32; bean += 1) {
      const decision = decideLease({ ...EMPTY, leases: held }, ask('r1', `job${bean}`), LIMITS);
      expect(decision.kind).toBe('granted');
      if (decision.kind === 'granted')
        held.push({ engine: 'r1', job: `job${bean}`, index: decision.index, untilMs: NOW + 1 });
    }
    const state: PoolState = { ...EMPTY, leases: held };
    expect(new Set(state.leases.map((lease) => lease.index)).size).toBe(32);
    expect(decideLease(state, ask('r1', 'job32'), LIMITS)).toEqual({ kind: 'wait', reason: 'cap' });
  });

  it("stops at the repository's own cap", () => {
    const state = { ...EMPTY, leases: leases('r1', 4) };
    expect(decideLease(state, ask('r1', 'next', 4), LIMITS)).toEqual({
      kind: 'wait',
      reason: 'cap',
    });
  });

  it('leaves what races reserved to the races', () => {
    // 48 - 2 headroom - 33 for a 30-agent race - 3 for the engine's base = 10 sandboxes.
    const races = [{ run: 'race1', instances: 33, untilMs: NOW + 60_000 }];
    const state = { ...EMPTY, races, leases: leases('r1', 10) };
    expect(decideLease(state, ask('r1', 'next'), LIMITS)).toEqual({
      kind: 'wait',
      reason: 'pool',
    });
    const fewer = { ...state, leases: leases('r1', 9) };
    expect(decideLease(fewer, ask('r1', 'next'), LIMITS).kind).toBe('granted');
  });

  it('always grants the floor, so races never stop a repository', () => {
    const races = [{ run: 'race1', instances: 46, untilMs: NOW + 60_000 }];
    const state = { ...EMPTY, races, leases: leases('r1', 1) };
    expect(decideLease(state, ask('r1', 'next'), LIMITS)).toMatchObject({ kind: 'granted' });
    const atFloor = { ...state, leases: leases('r1', 2) };
    expect(decideLease(atFloor, ask('r1', 'next'), LIMITS)).toEqual({
      kind: 'wait',
      reason: 'pool',
    });
  });

  it('counts the standing instances of other active repositories', () => {
    const engines = [{ engine: 'r2', base: 3, seenMs: NOW - 1000, waitingMs: null }];
    // 48 - 2 - 3 (r1) - 3 (r2) = 40 for leases: r2 holds 8, r1 holds 32 → full.
    const state = { ...EMPTY, engines, leases: [...leases('r1', 31), ...leases('r2', 8)] };
    expect(decideLease(state, ask('r1', 'next'), LIMITS).kind).toBe('granted');
    const full = { ...state, leases: [...leases('r1', 32), ...leases('r2', 8)] };
    expect(decideLease(full, ask('r1', 'next', 40), LIMITS)).toEqual({
      kind: 'wait',
      reason: 'pool',
    });
  });

  it('holds a busy repository at an equal share while another waits', () => {
    const waiting = { engine: 'r2', base: 3, seenMs: NOW, waitingMs: NOW - 1000 };
    // Budget 40 between two engines: a share of 20.
    const state = {
      ...EMPTY,
      engines: [waiting],
      leases: [...leases('r1', 20), ...leases('r2', 2)],
    };
    expect(decideLease(state, ask('r1', 'next'), LIMITS)).toEqual({
      kind: 'wait',
      reason: 'fair-share',
    });
    expect(decideLease(state, ask('r2', 'next'), LIMITS).kind).toBe('granted');
    const below = { ...state, leases: [...leases('r1', 19), ...leases('r2', 2)] };
    expect(decideLease(below, ask('r1', 'next'), LIMITS).kind).toBe('granted');
  });

  it('forgets a wait that is no longer fresh', () => {
    const stale = { engine: 'r2', base: 3, seenMs: NOW, waitingMs: NOW - WAITING_FRESH_MS - 1 };
    const state = { ...EMPTY, engines: [stale], leases: leases('r1', 25) };
    expect(decideLease(state, ask('r1', 'next'), LIMITS).kind).toBe('granted');
  });
});

describe('Actions job leases (one container per job, their own class)', () => {
  const WITH_ACTIONS: PoolLimits = { ...LIMITS, actionsInstances: 4 };

  it('count against the Actions class, not the runner pool', () => {
    const racesFill = { ...EMPTY, races: [{ run: 'race', instances: 46, untilMs: NOW + 1 }] };
    expect(decideLease(racesFill, ask('actions:r1', 'j1', 4), WITH_ACTIONS).kind).toBe('granted');
    const actionsFull = {
      ...EMPTY,
      leases: [...leases('actions:r1', 2), ...leases('actions:r2', 2)],
    };
    expect(decideLease(actionsFull, ask('actions:r3', 'j1', 4), WITH_ACTIONS)).toEqual({
      kind: 'wait',
      reason: 'pool',
    });
    const busyActions = { ...EMPTY, leases: leases('actions:r1', 4) };
    expect(decideLease(busyActions, ask('r9', 'check', 32), WITH_ACTIONS).kind).toBe('granted');
  });

  it('hold a repository to its concurrent-jobs cap', () => {
    const state = { ...EMPTY, leases: leases('actions:r1', 2) };
    expect(decideLease(state, ask('actions:r1', 'j3', 2), WITH_ACTIONS)).toEqual({
      kind: 'wait',
      reason: 'cap',
    });
  });

  it('get no instance when the Actions class has none configured', () => {
    expect(decideLease(EMPTY, ask('actions:r1', 'j1', 4), LIMITS)).toEqual({
      kind: 'wait',
      reason: 'pool',
    });
  });

  it('keep one repository from taking every Actions instance while another waits', () => {
    const waiting = { engine: 'actions:r2', base: 0, seenMs: NOW, waitingMs: NOW };
    const state = { ...EMPTY, engines: [waiting], leases: leases('actions:r1', 2) };
    expect(decideLease(state, ask('actions:r1', 'j3', 4), WITH_ACTIONS)).toEqual({
      kind: 'wait',
      reason: 'fair-share',
    });
  });
});
