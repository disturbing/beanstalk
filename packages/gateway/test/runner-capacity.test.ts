import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { PoolSnapshot } from '../src/capacity/runner-capacity';
import { ADMIN, call, createRun, driveSlot, json, pushBase } from './helpers';

/** A pool of its own per test, so the counts are this test's. */
function pool(name: string) {
  return env.RUNNER_CAPACITY.getByName(`test-${name}`);
}

function ask(engine: string, job: string, cap = 32) {
  return { engine, job, cap, base: 3, waitingSinceMs: Date.now() };
}

describe('the runner pool', () => {
  it('leases sandboxes lowest first, renews a job’s own, and reuses a released one', async () => {
    const capacity = pool('lease');
    expect(await capacity.acquire(ask('r1', 'job1'))).toMatchObject({ kind: 'granted', index: 0 });
    expect(await capacity.acquire(ask('r1', 'job2'))).toMatchObject({ kind: 'granted', index: 1 });
    expect(await capacity.acquire(ask('r1', 'job1'))).toMatchObject({
      kind: 'granted',
      index: 0,
      isRenewal: true,
    });
    await capacity.release({ engine: 'r1', job: 'job1' });
    expect(await capacity.acquire(ask('r1', 'job3'))).toMatchObject({ kind: 'granted', index: 0 });
    const snapshot = await capacity.snapshot();
    expect(snapshot.leases.map((lease) => lease.job)).toEqual(['job3', 'job2']);
    expect(snapshot.stats).toEqual([
      expect.objectContaining({ owner: 'r1', granted: 3, waits: 0, peak: 2 }),
    ]);
  });

  it('keeps what a race reserved from a busy repository, and gives it back when the race ends', async () => {
    const capacity = pool('race');
    // 48 - 2 headroom - 41 reserved - 3 base = 2: the repository's floor, and no more.
    await capacity.reserveRace({ run: 'race1', instances: 41, untilMs: Date.now() + 60_000 });
    for (const job of ['a', 'b']) {
      // oxlint-disable-next-line no-await-in-loop -- leases are taken in order
      expect((await capacity.acquire(ask('r1', job))).kind).toBe('granted');
    }
    expect(await capacity.acquire(ask('r1', 'c'))).toMatchObject({ kind: 'wait', reason: 'pool' });
    await capacity.releaseRace('race1');
    expect(await capacity.acquire(ask('r1', 'c'))).toMatchObject({ kind: 'granted', index: 2 });
    const stats = (await capacity.snapshot()).stats.find((owner) => owner.owner === 'r1');
    expect(stats).toMatchObject({ granted: 3, waits: 1 });
  });

  it('drops a reservation whose race never said it was done', async () => {
    const capacity = pool('expiry');
    await capacity.reserveRace({ run: 'gone', instances: 46, untilMs: Date.now() - 1 });
    expect((await capacity.snapshot()).races).toEqual([]);
  });

  it('counts suite timeouts per owner', async () => {
    const capacity = pool('timeouts');
    await capacity.noteTimeout('r9');
    await capacity.noteTimeout('r9');
    expect((await capacity.snapshot()).stats).toEqual([
      expect.objectContaining({ owner: 'r9', timeouts: 2 }),
    ]);
  });
});

describe("a race's runners in the shared pool", () => {
  it('are reserved while it races and released when it is done', async () => {
    const run = await createRun({ agents: 2, ci_slots: 1 });
    await pushBase(run, 'e'.repeat(40));
    await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    const reserved = await poolUntil((snapshot) =>
      snapshot.races.some((race) => race.run === run.run),
    );
    expect(reserved.races.find((race) => race.run === run.run)?.instances).toBe(2 + 1 + 1);

    await Promise.all([driveSlot(run, 'a0'), driveSlot(run, 'a1')]);

    await poolUntil((snapshot) => !snapshot.races.some((race) => race.run === run.run));
  });
});

/** Reads the gateway's pool until `holds` (the run's DO works between reads). */
async function poolUntil(holds: (snapshot: PoolSnapshot) => boolean): Promise<PoolSnapshot> {
  for (let read = 0; read < 200; read += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the pool changes between reads
    const response = await call('GET', '/v1/admin/capacity', { token: ADMIN });
    // oxlint-disable-next-line no-await-in-loop -- this read's body
    const snapshot = await json<PoolSnapshot>(response);
    if (holds(snapshot)) return snapshot;
  }
  throw new Error('the pool never reached the expected state');
}
