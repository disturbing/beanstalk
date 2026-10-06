import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import { InvocationId, RunId, SlotId, TaskId } from '@beanstalk/shared-race/ids';

import type { CreatedRun } from './helpers';
import { ADMIN, arenaTask, call, createRun, driveSlot, json, pushBase } from './helpers';

const BASE = 'e'.repeat(40);
const GIT_BASE = 'https://gateway.test/git';

/** Counts the RunDO's writes of a storage key while `work` runs. */
async function countingWrites<T>(
  run: CreatedRun,
  key: string,
  work: () => Promise<T>,
): Promise<{ writes: number; value: T }> {
  const stub = env.RUNS.getByName(run.run);
  const spy = await runInDurableObject(stub, (_, state) =>
    vi.spyOn(Object.getPrototypeOf(state.storage.kv), 'put'),
  );
  try {
    const before = spy.mock.calls.filter(([written]) => written === key).length;
    const value = await work();
    const after = spy.mock.calls.filter(([written]) => written === key).length;
    return { writes: after - before, value };
  } finally {
    spy.mockRestore();
  }
}

async function startedRun(config: Record<string, unknown>): Promise<CreatedRun> {
  const run = await createRun(config);
  await pushBase(run, BASE);
  const started = await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
  expect(started.status).toBe(200);
  return run;
}

describe('the RunDO stores only steps that change the run', () => {
  it('keeps poll bookkeeping and cost estimates in memory', async () => {
    const run = await startedRun({ agents: 3, tasks: [arenaTask('t001')] });
    const stub = env.RUNS.getByName(run.run);
    const first = await stub.next(SlotId.parse('a0'), GIT_BASE);
    const inv = InvocationId.parse(
      first.ok && 'invocation' in first.value ? first.value.invocation.inv : null,
    );

    const { writes, value: replaced } = await countingWrites(run, 'state', async () => {
      // a1 asks twice: the second poll replaces the first, which is answered `wait`.
      const held = stub.next(SlotId.parse('a1'), GIT_BASE);
      const replacing = stub.next(SlotId.parse('a1'), GIT_BASE);
      const answered = await held;
      await stub.progress(SlotId.parse('a0'), inv, { cost_usd: 0.25 });
      await stub.progress(SlotId.parse('a0'), inv, { cost_usd: 0.5 });
      return { answered, replacing };
    });
    await stub.stop('test over');
    await replaced.replacing;

    expect(replaced.answered).toEqual({ ok: true, value: { wait: true } });
    expect(writes).toBe(0);
    // The estimate held in memory reached the state the stop wrote: the kill charges it.
    const summary = await json<{ cost_usd: number }>(
      await call('GET', `/v1/runs/${run.run}/summary`, { token: ADMIN }),
    );
    expect(summary.cost_usd).toBeCloseTo(0.5, 6);
  });

  it('stores the infra meter with steps, not with every read', async () => {
    const run = await createRun();

    const { writes } = await countingWrites(run, 'infra-meter', async () => {
      for (let read = 0; read < 5; read += 1) {
        // oxlint-disable-next-line no-await-in-loop -- reads in turn, as a viewer makes them
        await call('GET', `/v1/runs/${run.run}`, { token: ADMIN });
      }
    });

    expect(writes).toBe(0);
  });
});

describe('a step that cannot be stored', () => {
  it('answers the held poll with wait and leaves the run as it was', async () => {
    const run = await startedRun({ tasks: [arenaTask('t001')] });
    const stub = env.RUNS.getByName(run.run);
    const spy = await runInDurableObject(stub, (_, state) => {
      const kv: SyncKvStorage = Object.getPrototypeOf(state.storage.kv);
      const put = kv.put.bind(state.storage.kv);
      return vi.spyOn(kv, 'put').mockImplementation((key: string, value: unknown) => {
        if (key === 'state') throw new Error('value too large');
        put(key, value);
      });
    });

    const refused = await stub.next(SlotId.parse('a0'), GIT_BASE).finally(() => spy.mockRestore());
    const retried = await stub.next(SlotId.parse('a0'), GIT_BASE);

    expect(refused).toEqual({ ok: true, value: { wait: true } });
    expect(retried).toMatchObject({
      ok: true,
      value: { invocation: { inv: 'inv0001-initial', task: 't001' } },
    });
  });
});

describe('the event log', () => {
  it('says done only on the page that reaches the end of a finished run', async () => {
    const run = await startedRun({});
    await call('POST', `/v1/runs/${run.run}/stop`, { token: ADMIN, body: { reason: 'x' } });
    const stub = env.RUNS.getByName(run.run);

    const first = await stub.events(0, 1);
    const all = await stub.events(0, 10_000);

    expect(first).toMatchObject({ ok: true, value: { done: false } });
    expect(all).toMatchObject({ ok: true, value: { done: true } });
  });
});

describe('a finished run', () => {
  it('reports its repos reaped as soon as the summary is read', async () => {
    const run = await startedRun({ policy: 'beanstalk-v2', agents: 1, tasks: [arenaTask('t001')] });
    await driveSlot(run, 'a0');

    const summary = await json<{ repos: { status: string } }>(
      await call('GET', `/v1/runs/${run.run}/summary`, { token: ADMIN }),
    );

    expect(summary.repos.status).toBe('reaped');
    const cached = await runInDurableObject(
      env.RUNS.getByName(run.run),
      (_, state) => state.storage.sql.exec('SELECT COUNT(*) AS n FROM git_objects').one()['n'],
    );
    expect(cached).toBe(0);
  });
});

describe('a sweep of a run this gateway never held', () => {
  it('deletes the orphan’s repos and leaves no storage behind', async () => {
    const orphan = RunId.parse(`o${crypto.randomUUID().replaceAll('-', '').slice(0, 11)}`);
    await env.ARTIFACTS.create(`race-${orphan}`);
    const stub = env.RUNS.getByName(orphan);

    const swept = await stub.sweep(orphan, Date.now(), [`race-${orphan}`]);

    expect(swept).toMatchObject({ ok: true, value: { deleted: [`race-${orphan}`] } });
    const tables = await runInDurableObject(stub, (_, state) =>
      state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((row) => row.name)
        .filter((name) => !name.startsWith('_cf_') && !name.startsWith('sqlite_')),
    );
    expect(tables).toEqual([]);
  });
});

describe('collaboration calls', () => {
  it('count toward the infra meter', async () => {
    const run = await createRun();
    const stub = env.RUNS.getByName(run.run);
    const requests = async (): Promise<number> => {
      const summary = await json<{ infra: { worker_requests: number } }>(
        await call('GET', `/v1/runs/${run.run}/summary`, { token: ADMIN }),
      );
      return summary.infra.worker_requests;
    };

    const before = await requests();
    await stub.beanDiscover({ bean: TaskId.parse('t001'), query: 'anything' });
    const after = await requests();

    // The second summary read and the discovery call.
    expect(after - before).toBe(2);
  });
});
