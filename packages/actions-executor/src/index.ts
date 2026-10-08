import { WorkerEntrypoint } from 'cloudflare:workers';
import { Hono } from 'hono';
import { z } from 'zod';

import { adminToken } from './config';
import type { ActionsExecutor, JobHandle, RpcResult } from './contract';
import { cancelJob, startJob } from './executor';
import { gunzip } from './sink/job-sink';

export { ActionsJobContainer } from './job/job-container';
// Required by @cloudflare/containers for outbound interception (executor.internal, bs.internal).
export { ContainerProxy } from '@cloudflare/containers';

type AppEnv = { Bindings: Env; Variables: Record<string, never> };

/**
 * beanstalk-actions-executor: runs GitHub Actions jobs, one fresh container each. The control
 * plane calls `startJob` and `cancelJob` over a service binding (`ActionsExecutor`); `fetch`
 * serves health and, behind ADMIN_TOKEN, the routes a test stack drives jobs with.
 */
export default class ActionsExecutorWorker
  extends WorkerEntrypoint<Env>
  implements ActionsExecutor
{
  override fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  async startJob(spec: unknown): Promise<RpcResult<JobHandle>> {
    return startJob(this.env.ACTIONS_JOBS_DO, spec);
  }

  async cancelJob(
    jobId: string,
    reason: 'cancelled' | 'timed_out',
  ): Promise<RpcResult<{ readonly stopping: boolean }>> {
    return cancelJob(this.env.ACTIONS_JOBS_DO, jobId, reason);
  }
}

const JobIdParam = z.uuid();

const app = new Hono<AppEnv>()
  .get('/healthz', (c) => c.json({ ok: true }))
  .use('/v1/admin/*', async (c, next) => {
    const token = adminToken(c.env);
    if (token === null)
      return c.json({ error: { code: 'misconfigured', message: 'no ADMIN_TOKEN' } }, 503);
    if (c.req.header('authorization') !== `Bearer ${token}`) {
      return c.json({ error: { code: 'unauthorized', message: 'admin token required' } }, 401);
    }
    await next();
  })
  .post('/v1/admin/jobs', async (c) => {
    const result = await startJob(c.env.ACTIONS_JOBS_DO, await c.req.json());
    return result.ok ? c.json(result.value, 202) : c.json({ error: result.error }, 400);
  })
  .get('/v1/admin/jobs/:jobId', async (c) => {
    const jobId = JobIdParam.safeParse(c.req.param('jobId'));
    if (!jobId.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const job = await c.env.ACTIONS_JOBS_DO.getByName(jobId.data).describe();
    if (job === null) return c.json({ error: { code: 'not_found' } }, 404);
    return c.body(job, 200, { 'content-type': 'application/json' });
  })
  .post('/v1/admin/jobs/:jobId/cancel', async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const reason =
      typeof body === 'object' && body !== null ? Reflect.get(body, 'reason') : undefined;
    const result = await cancelJob(
      c.env.ACTIONS_JOBS_DO,
      c.req.param('jobId'),
      String(reason ?? 'cancelled'),
    );
    return result.ok ? c.json(result.value) : c.json({ error: result.error }, 400);
  })
  .get('/v1/admin/logs', async (c) => {
    // Standalone stacks: the stored batches of a job, `?prefix=standalone/<owner>/<repo>/<run>/<job>/`.
    const prefix = c.req.query('prefix') ?? '';
    if (!prefix.startsWith('standalone/'))
      return c.json({ error: { code: 'invalid_request' } }, 400);
    const listed = await c.env.ACTIONS_LOGS.list({ prefix, limit: 1000 });
    const batches = await Promise.all(
      listed.objects
        .filter((object) => object.key.endsWith('.json.gz'))
        .map(async (object) => {
          const stored = await c.env.ACTIONS_LOGS.get(object.key);
          return stored === null ? null : JSON.parse(await gunzip(await stored.arrayBuffer()));
        }),
    );
    const result = await c.env.ACTIONS_LOGS.get(`${prefix}result.json`);
    return c.json({ batches, result: result === null ? null : await result.json() });
  })
  .notFound((c) => c.text('not found', 404));
