import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { cancelJob, startJob } from '../src/executor';
import { gunzip, standaloneSink } from '../src/sink/job-sink';
import { JOB_ID, spec } from './fake-ports';

const ADMIN = { authorization: 'Bearer test-admin-token-0123456789abcdef0123456789' };

describe('the executor contract', () => {
  it('refuses a spec that is not a JobSpec, naming the problem', async () => {
    const result = await startJob(env.ACTIONS_JOBS_DO, { jobId: 'not-a-uuid' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'invalid_request', status: 400 });
  });

  it('refuses a cancel reason outside the contract', async () => {
    const result = await cancelJob(env.ACTIONS_JOBS_DO, JOB_ID, 'because');
    expect(result.ok).toBe(false);
  });
});

describe('admin routes', () => {
  it('need the admin token', async () => {
    const response = await SELF.fetch('https://executor.test/v1/admin/jobs', {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(401);
  });

  it('answer health without it', async () => {
    const response = await SELF.fetch('https://executor.test/healthz');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('refuse a bad job with the reason', async () => {
    const response = await SELF.fetch('https://executor.test/v1/admin/jobs', {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({ jobId: JOB_ID }),
    });
    expect(response.status).toBe(400);
  });
});

describe('the standalone sink', () => {
  it('stores each batch as a gzip chunk and the result beside them', async () => {
    const sink = standaloneSink(spec(), env);
    await sink.logs({
      seq: 1,
      lines: [{ step: 1, at: '2026-10-08T00:00:00.000Z', text: 'hello' }],
      steps: [],
    });
    await sink.finished({
      conclusion: 'success',
      outputs: {},
      durationMs: 1,
      minutesBilled: 1,
      steps: [],
      error: null,
    });
    const prefix = `standalone/coop/app/${spec().runId}/${JOB_ID}`;
    const chunk = await env.ACTIONS_LOGS.get(`${prefix}/000001.json.gz`);
    expect(
      JSON.parse(await gunzip((await chunk?.arrayBuffer()) ?? new ArrayBuffer(0))),
    ).toMatchObject({
      seq: 1,
      lines: [{ text: 'hello' }],
    });
    expect(await (await env.ACTIONS_LOGS.get(`${prefix}/result.json`))?.json()).toMatchObject({
      conclusion: 'success',
    });
  });

  it('gives a job only the secrets it names', async () => {
    const sink = standaloneSink(spec({ secretNames: ['NPM_TOKEN'] }), env);
    expect(await sink.secrets()).toEqual({ NPM_TOKEN: 'npm-secret' });
  });
});
