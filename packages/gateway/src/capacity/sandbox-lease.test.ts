import { describe, expect, it } from 'vitest';

import { Sha } from '@gitstalk/shared-race/ids';

import { createLogger } from '../log';
import type { AcquireInput, AcquireResult } from './runner-capacity';
import type { SandboxPoolPort } from './sandbox-lease';
import { leaseSandbox, needsSandboxLease, releaseSandbox } from './sandbox-lease';

const LOG = createLogger('error');
const REQUEST = { engine: 'r1', job: 'job0007', cap: 32, base: 3 };

/** A clock whose sleeps only move virtual time (no real waiting in tests). */
function virtualClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let nowMs = 0;
  return {
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms;
    },
  };
}

/** A pool that says wait `waits` times, then grants index 5; it keeps what it was asked. */
function scriptedPool(
  waits: number,
): SandboxPoolPort & { asked: AcquireInput[]; released: number } {
  const asked: AcquireInput[] = [];
  const pool = {
    asked,
    released: 0,
    async acquire(input: AcquireInput): Promise<AcquireResult> {
      asked.push(input);
      return asked.length <= waits
        ? { kind: 'wait', reason: 'pool', inUse: 46 }
        : { kind: 'granted', index: 5, isRenewal: false, inUse: 46 };
    },
    async release(): Promise<void> {
      pool.released += 1;
    },
  };
  return pool;
}

describe('leaseSandbox', () => {
  it('waits for the pool without running anything, then hands over the sandbox', async () => {
    const pool = scriptedPool(4);
    const clock = virtualClock();

    const held = await leaseSandbox(pool, REQUEST, { clock, log: LOG });

    expect(held).toEqual({ index: 5, waitedMs: 1000 + 2000 + 4000 + 5000 });
    expect(pool.asked).toHaveLength(5);
    // Every ask carries when the job first asked, so the pool can count the whole wait.
    expect(new Set(pool.asked.map((input) => input.waitingSinceMs))).toEqual(new Set([0]));
  });

  it('falls back to a floor sandbox when the pool cannot be reached', async () => {
    const pool: SandboxPoolPort = {
      acquire: async () => {
        throw new Error('pool unreachable');
      },
      release: async () => {},
    };

    const held = await leaseSandbox(pool, REQUEST, { clock: virtualClock(), log: LOG });

    expect([0, 1]).toContain(held.index);
  });
});

describe('releaseSandbox', () => {
  it('gives the sandbox back, and only logs a failure', async () => {
    const pool = scriptedPool(0);
    await releaseSandbox(pool, { engine: 'r1', job: 'job0007' }, LOG);
    expect(pool.released).toBe(1);
    const failing: SandboxPoolPort = {
      acquire: async (input) => pool.acquire(input),
      release: async () => {
        throw new Error('pool unreachable');
      },
    };
    await expect(releaseSandbox(failing, { engine: 'r1', job: 'job1' }, LOG)).resolves.toBe(
      undefined,
    );
  });
});

describe('needsSandboxLease', () => {
  const check = {
    kind: 'check',
    sha: Sha.parse('a'.repeat(40)),
    extraFiles: null,
    instance: { kind: 'sandbox', slot: 'a3' },
  } as const;

  it("leases a repository engine's sandbox checks only", () => {
    expect(needsSandboxLease(check, { continuous: true })).toBe(true);
    expect(needsSandboxLease(check, { continuous: false })).toBe(false);
    expect(
      needsSandboxLease({ ...check, instance: { kind: 'ci', slot: 0 } }, { continuous: true }),
    ).toBe(false);
  });
});
