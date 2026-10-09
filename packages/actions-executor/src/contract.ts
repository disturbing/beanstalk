/**
 * The executor's side of the Actions contract (`@beanstalk/shared-race/actions`, owned by the
 * control plane): the types come from there; this module adds the boundary schema `startJob`
 * validates a `JobSpec` with, since the contract exports schemas only for what the sink receives.
 */
import { z } from 'zod';

import type { JobResult, JobSpec } from '@beanstalk/shared-race/actions';
import {
  ACTIONS_CONCLUSIONS,
  ActionsJobId,
  ActionsRunId,
  SecretName,
  WorkflowPath,
} from '@beanstalk/shared-race/actions';

export type {
  ActionsConclusion,
  ActionsExecutor,
  ActionsJobSink,
  JobHandle,
  JobLogBatch,
  JobResult,
  JobSpec,
  JobStepSpec,
  LogLine,
  StepView,
} from '@beanstalk/shared-race/actions';
export type { RpcResult } from '@beanstalk/shared-race/rpc';

/** A finished job's conclusion as `JobResult` allows it. */
export type JobConclusion = JobResult['conclusion'];

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

/** `JobSpec`, validated at the RPC boundary. */
export const JobSpecSchema = z.object({
  jobId: ActionsJobId,
  repo: z.object({ id: z.string(), owner: z.string(), name: z.string(), fullName: z.string() }),
  runId: ActionsRunId,
  runNumber: z.number().int(),
  workflowPath: WorkflowPath,
  workflowName: z.string(),
  jobName: z.string().min(1).max(100),
  displayName: z.string(),
  matrix: z.record(z.string(), Scalar).nullable(),
  event: z.enum(['push', 'workflow_dispatch', 'schedule']),
  eventPayload: z.record(z.string(), z.unknown()),
  context: z.object({
    sha: z.string(),
    ref: z.string(),
    refName: z.string(),
    actor: z.string(),
    serverUrl: z.string(),
    apiUrl: z.string(),
    runAttempt: z.number().int(),
  }),
  checkout: z.object({ url: z.url(), token: z.string().min(1), sha: z.string() }),
  needs: z.record(
    z.string(),
    z.object({ result: z.enum(ACTIONS_CONCLUSIONS), outputs: z.record(z.string(), z.string()) }),
  ),
  inputs: z.record(z.string(), z.string()),
  env: z.record(z.string(), z.string()),
  secretNames: z.array(SecretName),
  // A gateway older than variables sends none.
  vars: z.record(z.string(), z.string()).default({}),
  steps: z.array(
    z.object({
      number: z.number().int(),
      id: z.string().nullable(),
      name: z.string(),
      uses: z.string().nullable(),
      run: z.string().nullable(),
    }),
  ),
  outputs: z.record(z.string(), z.string()),
  timeoutMinutes: z.number().int().min(1).max(360),
  image: z.string(),
  report: z.object({ token: z.string().min(1) }),
  depsCache: z.object({ scope: z.string().min(1).max(255), canSave: z.boolean() }).optional(),
});
/** A `JobSpec` from an RPC argument, or why it is not one. */
export function parseJobSpec(
  value: unknown,
):
  | { readonly ok: true; readonly spec: JobSpec }
  | { readonly ok: false; readonly error: z.ZodError } {
  const parsed = JobSpecSchema.safeParse(value);
  return parsed.success ? { ok: true, spec: parsed.data } : { ok: false, error: parsed.error };
}
