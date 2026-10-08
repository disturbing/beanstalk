import { describe, expect, it } from 'vitest';

import {
  CAPACITY_BUDGET_MS,
  CAPACITY_RETRY_MS,
  REPORT_ATTEMPTS,
  SILENT_PROBE_MS,
  STOP_GRACE_MS,
} from '../src/job/lifecycle';
import { JOB_ID, SECRET_VALUE, harness, line, runnerResult, spec } from './fake-ports';
import type { Harness } from './fake-ports';

async function running(): Promise<Harness> {
  const h = harness();
  await h.lifecycle.accept(spec());
  await h.lifecycle.launch();
  return h;
}

describe('a job, start to finish', () => {
  it('starts a fresh container with the job and its secrets, and stores neither', async () => {
    const h = await running();

    const job = h.container.posts.find((post) => post.path === '/v1/job');
    expect(job?.body).toMatchObject({
      jobId: JOB_ID,
      secrets: { CLOUDFLARE_API_TOKEN: SECRET_VALUE },
      github: { repository: 'coop/app', serverUrl: 'http://bs.internal' },
      runnerLabels: expect.arrayContaining(['ubuntu-latest', 'ubuntu-24.04']),
      timeoutSeconds: 3600,
    });
    expect(h.record()?.phase).toBe('running');
    expect(JSON.stringify(h.saved)).not.toContain(SECRET_VALUE);
    expect(h.tasks.map((task) => task.task)).toEqual(['launch', 'timeout', 'watchdog']);
  });

  it('answers the same handle when the same job is started twice', async () => {
    const h = harness();
    const first = await h.lifecycle.accept(spec());
    const second = await h.lifecycle.accept(spec());
    expect(second).toEqual(first);
    expect(h.tasks.filter((task) => task.task === 'launch')).toHaveLength(1);
  });

  it('relays batches as numbered sink batches with step views, once each', async () => {
    const h = await running();
    const batch = {
      jobId: JOB_ID,
      index: 0,
      lines: [
        line(0, {
          kind: 'step-start',
          stage: 'Main',
          stepId: '1',
          step: 'npm ci',
          text: 'Run Main npm ci',
        }),
        line(1, { kind: 'output', stage: 'Main', stepId: '1', text: 'added 1 package' }),
        line(2, {
          kind: 'step-end',
          stage: 'Main',
          stepId: '1',
          text: 'Success - Main npm ci [1.9s]',
          result: 'success',
          durationMs: 1900,
        }),
      ],
    };

    expect((await h.lifecycle.fromRunner('/v1/batches', batch)).status).toBe(200);
    expect((await h.lifecycle.fromRunner('/v1/batches', batch)).body).toEqual({ duplicate: true });

    expect(h.sink.batches).toHaveLength(1);
    const [sent] = h.sink.batches;
    expect(sent?.seq).toBe(1);
    expect(sent?.lines.map((l) => [l.step, l.text])).toEqual([
      [2, 'Run npm ci'],
      [2, 'added 1 package'],
      [2, 'Success - npm ci [1.9s]'],
    ]);
    expect(sent?.steps).toEqual([
      expect.objectContaining({
        number: 2,
        name: 'npm ci',
        status: 'completed',
        conclusion: 'success',
      }),
    ]);
    expect(h.container.renewals).toBe(2);
  });

  it('treats an empty batch as a heartbeat and sends nothing on', async () => {
    const h = await running();
    h.advance(5000);
    await h.lifecycle.fromRunner('/v1/batches', { jobId: JOB_ID, index: 0, lines: [] });
    expect(h.sink.batches).toHaveLength(0);
    expect(h.record()?.lastHeardMs).toBe(h.now());
  });

  it('destroys the container, checks it is gone, and reports the result with billed minutes', async () => {
    const h = await running();
    h.advance(61_000);

    await h.lifecycle.fromRunner('/v1/result', runnerResult());

    expect(h.container.destroys).toBe(1);
    expect(h.container.running).toBe(false);
    expect(h.sink.results).toEqual([
      expect.objectContaining({
        conclusion: 'success',
        outputs: { node: 'v20.20.2' },
        durationMs: 29_000,
        minutesBilled: 2,
        error: null,
      }),
    ]);
    expect(h.record()).toMatchObject({ phase: 'done', containerGone: true, reported: true });
  });

  it('reports a result once, however often the runner posts it', async () => {
    const h = await running();
    await h.lifecycle.fromRunner('/v1/result', runnerResult());
    await h.lifecycle.fromRunner('/v1/result', runnerResult());
    await h.lifecycle.onContainerStopped({ exitCode: 137, reason: 'exit' });
    expect(h.sink.results).toHaveLength(1);
  });

  it('records a container that is still running after two destroys', async () => {
    const h = await running();
    h.container.isStuck = true;
    await h.lifecycle.fromRunner('/v1/result', runnerResult());
    expect(h.container.destroys).toBe(2);
    expect(h.record()?.containerGone).toBe(false);
  });
});

describe('the ways a job is stopped', () => {
  it('passes a timeout to the runner and reports timed_out from its result', async () => {
    const h = await running();
    await h.lifecycle.onTimeout();
    expect(h.container.posts.at(-1)).toEqual({ path: '/v1/cancel', body: { reason: 'timeout' } });

    await h.lifecycle.fromRunner(
      '/v1/result',
      runnerResult({ conclusion: 'failure', reason: 'timeout' }),
    );
    expect(h.sink.results[0]?.conclusion).toBe('timed_out');
  });

  it('destroys a container whose runner never answers the stop', async () => {
    const h = await running();
    await h.lifecycle.cancel('cancelled');
    expect(h.tasks.at(-1)).toEqual({ delayMs: STOP_GRACE_MS, task: 'force-stop' });

    await h.lifecycle.onForceStop();
    expect(h.container.running).toBe(false);
    expect(h.sink.results[0]).toMatchObject({ conclusion: 'cancelled' });
  });

  it('stops the job when the control plane asks in its answer to a batch', async () => {
    const h = await running();
    h.sink.cancelRequested = true;
    await h.lifecycle.fromRunner('/v1/batches', {
      jobId: JOB_ID,
      index: 0,
      lines: [line(0, { kind: 'output', stage: 'Main', stepId: '0', text: 'x' })],
    });
    expect(h.container.posts.at(-1)).toEqual({ path: '/v1/cancel', body: { reason: 'cancelled' } });
    expect(h.record()?.phase).toBe('stopping');
  });

  it('cancels a job that has not started without starting a container', async () => {
    const h = harness();
    await h.lifecycle.accept(spec());
    await h.lifecycle.cancel('cancelled');
    await h.lifecycle.launch();
    expect(h.container.starts).toHaveLength(0);
    expect(h.container.posts).toHaveLength(0);
    expect(h.sink.results[0]).toMatchObject({ conclusion: 'cancelled', minutesBilled: 0 });
  });
});

describe('infrastructure failures are reported, never silent', () => {
  it('reports a container that stops mid-job (a deploy, a host restart)', async () => {
    const h = await running();
    h.container.running = false;
    await h.lifecycle.onContainerStopped({ exitCode: 137, reason: 'exit' });
    expect(h.sink.results).toEqual([
      expect.objectContaining({
        conclusion: 'infrastructure_failure',
        error: expect.stringContaining('before the job finished'),
      }),
    ]);
  });

  it('finds a dead container on the watchdog round', async () => {
    const h = await running();
    h.container.running = false;
    await h.lifecycle.onWatchdog();
    expect(h.sink.results[0]?.conclusion).toBe('infrastructure_failure');
  });

  it('recovers a result whose post was lost from the runner’s status', async () => {
    const h = await running();
    h.container.status = {
      state: 'finished',
      result: runnerResult({ conclusion: 'failure', reason: 'steps' }),
    };
    h.advance(SILENT_PROBE_MS);
    await h.lifecycle.onWatchdog();
    expect(h.sink.results[0]).toMatchObject({ conclusion: 'failure', error: null });
  });

  it('waits for capacity, then gives up as infrastructure without billing', async () => {
    const h = harness();
    h.container.starts = [
      { kind: 'no-capacity', reason: 'Maximum number of running container instances exceeded' },
      { kind: 'no-capacity', reason: 'Maximum number of running container instances exceeded' },
    ];
    await h.lifecycle.accept(spec());
    await h.lifecycle.launch();
    expect(h.tasks.at(-1)).toEqual({ delayMs: CAPACITY_RETRY_MS, task: 'launch' });

    h.advance(CAPACITY_BUDGET_MS);
    await h.lifecycle.launch();
    expect(h.sink.results[0]).toMatchObject({
      conclusion: 'infrastructure_failure',
      minutesBilled: 0,
    });
    expect(h.record()?.containerGone).toBeNull();
  });

  it('keeps trying to report a result until the control plane takes it', async () => {
    const h = await running();
    h.sink.failFinished = 1;
    await h.lifecycle.fromRunner('/v1/result', runnerResult());
    expect(h.record()?.reported).toBe(false);
    expect(h.tasks.at(-1)?.task).toBe('report');

    await h.lifecycle.onReport();
    expect(h.sink.results).toHaveLength(1);
    expect(h.record()?.reported).toBe(true);
    expect(REPORT_ATTEMPTS).toBeGreaterThan(1);
  });

  it('refuses a batch that is not the runner’s shape', async () => {
    const h = await running();
    const answer = await h.lifecycle.fromRunner('/v1/batches', { lines: 'nope' });
    expect(answer.status).toBe(400);
  });
});
