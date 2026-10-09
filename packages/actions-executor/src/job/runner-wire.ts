/**
 * The wire contract with the job runner in the container (packages/actions-runner,
 * `src/wire.rs`): the job request this side sends, and the batches and result the runner posts
 * to `executor.internal`. Bump `ACTIONS_RUNNER_API_VERSION` with the runner's `API_VERSION`.
 */
import { z } from 'zod';

import type { JobSpec } from '../contract';

export const ACTIONS_RUNNER_API_VERSION = 1;
/** The virtual host the runner posts its batches and result to. */
export const EXECUTOR_HOST = 'executor.internal';
/** `runs-on` labels the image answers (`ubuntu-22.04` runs on 24.04: "runs differently"). */
export const RUNNER_LABELS = ['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04'] as const;

export const RunnerLineSchema = z.object({
  seq: z.number().int().min(0),
  at: z.number().int(),
  kind: z.enum([
    'output',
    'step-start',
    'step-end',
    'annotation',
    'group-start',
    'group-end',
    'summary',
    'debug',
    'runner',
  ]),
  stage: z.string().optional(),
  stepId: z.string().optional(),
  step: z.string().optional(),
  level: z.enum(['debug', 'info', 'notice', 'warning', 'error']),
  text: z.string(),
  result: z.string().optional(),
  durationMs: z.number().int().optional(),
  annotation: z
    .object({
      level: z.string(),
      message: z.string(),
      title: z.string().optional(),
      file: z.string().optional(),
      line: z.number().int().optional(),
    })
    .loose()
    .optional(),
});
export type RunnerLine = z.infer<typeof RunnerLineSchema>;

export const RunnerBatchSchema = z.object({
  jobId: z.string(),
  index: z.number().int().min(0),
  lines: z.array(RunnerLineSchema).max(20_000),
});
export type RunnerBatch = z.infer<typeof RunnerBatchSchema>;

export const RunnerResultSchema = z
  .object({
    jobId: z.string(),
    conclusion: z.enum(['success', 'failure', 'cancelled', 'skipped']),
    reason: z
      .enum(['steps', 'timeout', 'cancelled', 'workflow', 'unsupported', 'runner'])
      .optional(),
    error: z.string().optional(),
    exitCode: z.number().int().optional(),
    outputs: z.record(z.string(), z.string()),
    unresolvedOutputs: z.array(z.string()),
    startedAt: z.number().int(),
    finishedAt: z.number().int(),
    lines: z.number().int(),
    batches: z.number().int(),
    actVersion: z.string(),
    imageVersion: z.string(),
  })
  .loose();
export type RunnerResult = z.infer<typeof RunnerResultSchema>;

/** `GET /v1/status`: the runner's slot, used when a result post was lost. */
export const RunnerStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle') }),
  z.object({ state: z.literal('running'), jobId: z.string(), startedAt: z.number() }),
  z.object({ state: z.literal('finished'), result: RunnerResultSchema }),
]);

/** The job request for the runner: the spec, the secret values, and Beanstalk's own hosts. */
export function jobRequestOf(spec: JobSpec, secrets: Readonly<Record<string, string>>): unknown {
  const labels = [...new Set([...RUNNER_LABELS, spec.image])];
  return {
    jobId: spec.jobId,
    workflowPath: spec.workflowPath,
    jobName: spec.jobName,
    eventName: spec.event,
    eventPayload: spec.eventPayload,
    github: {
      repository: spec.repo.fullName,
      ref: spec.context.ref,
      sha: spec.checkout.sha || spec.context.sha,
      serverUrl: spec.context.serverUrl,
      apiUrl: spec.context.apiUrl,
      runId: spec.runId,
      runNumber: String(spec.runNumber),
      runAttempt: String(spec.context.runAttempt),
      actor: spec.context.actor,
    },
    token: spec.checkout.token,
    env: spec.env,
    vars: spec.vars ?? {},
    secrets,
    inputs: spec.inputs,
    outputs: spec.outputs,
    matrix: spec.matrix ?? {},
    needs: Object.fromEntries(
      Object.entries(spec.needs).map(([job, need]) => [
        job,
        { result: needsResult(need.result), outputs: need.outputs },
      ]),
    ),
    timeoutSeconds: spec.timeoutMinutes * 60,
    runnerLabels: labels,
  };
}

/** GitHub's `needs.<job>.result` vocabulary: success, failure, cancelled or skipped. */
function needsResult(conclusion: string): string {
  if (conclusion === 'success' || conclusion === 'cancelled' || conclusion === 'skipped')
    return conclusion;
  return 'failure';
}
