/**
 * The `ActionsExecutor` contract over the job objects: `startJob` validates the spec and hands it
 * to the job's own ActionsJobContainer (named by the job id, so a repeated call answers the
 * same handle and a job never shares a container); `cancelJob` asks that object to stop.
 */
import { z } from 'zod';

import type { JobHandle, RpcResult } from './contract';
import { JobSpecSchema } from './contract';

type JobObjects = Env['ACTIONS_JOBS_DO'];

export async function startJob(jobs: JobObjects, spec: unknown): Promise<RpcResult<JobHandle>> {
  const parsed = JobSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return failure('invalid_request', 400, z.prettifyError(parsed.error).slice(0, 1000));
  }
  const handle = await jobs.getByName(parsed.data.jobId).accept(parsed.data);
  return { ok: true, value: handle };
}

export async function cancelJob(
  jobs: JobObjects,
  jobId: string,
  reason: string,
): Promise<RpcResult<{ readonly stopping: boolean }>> {
  if (!z.uuid().safeParse(jobId).success)
    return failure('invalid_request', 400, 'jobId is not a UUID');
  if (reason !== 'cancelled' && reason !== 'timed_out') {
    return failure('invalid_request', 400, 'reason is cancelled or timed_out');
  }
  const answer = await jobs.getByName(jobId).cancel(reason);
  if (answer === null) return failure('not_found', 404, `no job ${jobId} on this executor`);
  return { ok: true, value: answer };
}

function failure<T>(code: string, status: number, message: string): RpcResult<T> {
  return { ok: false, error: { code, status, message } };
}
