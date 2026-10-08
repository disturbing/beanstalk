/**
 * The executor's side of the Actions contract. Lane 1 owns the contract in
 * `packages/shared-race/src/actions.ts` (on its branch at the time of writing, commit 6e8505d);
 * this file mirrors the parts the executor speaks, field for field, so the two merge by
 * replacing these declarations with imports from `@beanstalk/shared-race/actions`. Keep it in
 * step with that file; the boundary schemas here validate what the executor receives.
 */
import { z } from 'zod';

import type { RpcResult } from '@beanstalk/shared-race/rpc';

export type { RpcResult };

export const ACTIONS_STATUSES = ['queued', 'waiting', 'in_progress', 'completed'] as const;
export type ActionsStatus = (typeof ACTIONS_STATUSES)[number];

export const ACTIONS_CONCLUSIONS = [
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'infrastructure_failure',
  'startup_failure',
] as const;
export type ActionsConclusion = (typeof ACTIONS_CONCLUSIONS)[number];

/** One log line as the control plane stores and shows it. */
export type LogLine = { readonly step: number | null; readonly at: string; readonly text: string };

export type StepView = {
  readonly number: number;
  readonly name: string;
  readonly status: ActionsStatus;
  readonly conclusion: ActionsConclusion | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
};

export type JobStepSpec = {
  readonly number: number;
  readonly id: string | null;
  readonly name: string;
  readonly uses: string | null;
  readonly run: string | null;
};

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

/** `JobSpec`, validated at the RPC boundary (the shape of lane 1's type). */
export const JobSpecSchema = z.object({
  jobId: z.uuid(),
  repo: z.object({ id: z.string(), owner: z.string(), name: z.string(), fullName: z.string() }),
  runId: z.uuid(),
  runNumber: z.number().int(),
  workflowPath: z.string().regex(/^\.github\/workflows\/[A-Za-z0-9._-]{1,100}\.ya?ml$/),
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
  secretNames: z.array(z.string()),
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
});
export type JobSpec = z.infer<typeof JobSpecSchema>;

export type JobHandle = {
  readonly jobId: string;
  /** The executor's own reference (the container Durable Object's id), for its logs. */
  readonly executorRef: string;
  readonly acceptedAt: string;
};

export type JobConclusion = Extract<
  ActionsConclusion,
  'success' | 'failure' | 'cancelled' | 'timed_out' | 'infrastructure_failure'
>;

export type JobResult = {
  readonly conclusion: JobConclusion;
  readonly outputs: Readonly<Record<string, string>>;
  readonly durationMs: number;
  /** Whole minutes, rounded up per job as GitHub bills them. */
  readonly minutesBilled: number;
  readonly steps: readonly StepView[];
  readonly error: string | null;
};

/** One batch for the sink: `seq` from 1, in order, one gzip chunk in R2 each. */
export type JobLogBatch = {
  readonly seq: number;
  readonly lines: readonly LogLine[];
  readonly steps: readonly StepView[];
};

export type ActionsExecutor = {
  startJob(spec: JobSpec): Promise<RpcResult<JobHandle>>;
  cancelJob(
    jobId: string,
    reason: 'cancelled' | 'timed_out',
  ): Promise<RpcResult<{ readonly stopping: boolean }>>;
};

/** The gateway's `ActionsJobs` entrypoint, called with the job's `report.token`. */
export type ActionsJobSink = {
  actionsJobSecrets(reportToken: string): Promise<RpcResult<Readonly<Record<string, string>>>>;
  actionsJobLogs(
    reportToken: string,
    batch: JobLogBatch,
  ): Promise<RpcResult<{ readonly cancelRequested: boolean }>>;
  actionsJobFinished(
    reportToken: string,
    result: JobResult,
  ): Promise<RpcResult<{ readonly accepted: true }>>;
};
