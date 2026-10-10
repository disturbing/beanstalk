/**
 * A run's job DAG, pure (the run DO stores it and applies the answers): jobs expanded from the
 * workflow (one per matrix leg), when each may start (`needs` all done, `if:` true), what the
 * needed jobs report to `needs.<key>`, and the run's conclusion.
 */
import type { ActionsConclusion, ActionsStatus, JobStepSpec } from '@gitstalk/shared-race/actions';

import type { ExpressionContexts } from './expressions';
import { evaluateCondition, interpolate } from './expressions';
import type { MatrixLeg } from './matrix';
import type { JobPlan, WorkflowFile } from './workflow-file';

/** One job of a run as planned: a job key and, for a matrix, one leg. */
export type PlannedJob = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly matrix: MatrixLeg | null;
  readonly needs: readonly string[];
  readonly condition: string;
  readonly image: string | null;
  readonly timeoutMinutes: number;
  readonly steps: readonly JobStepSpec[];
  readonly outputs: Readonly<Record<string, string>>;
  readonly secretNames: readonly string[];
  readonly contentsWrite: boolean;
  readonly idTokenWrite: boolean;
};

/** A job's state, as the DAG needs it. */
export type JobState = {
  readonly key: string;
  readonly status: ActionsStatus;
  readonly conclusion: ActionsConclusion | null;
  readonly outputs: Readonly<Record<string, string>>;
};

export type NeedResult = {
  readonly result: ActionsConclusion;
  readonly outputs: Readonly<Record<string, string>>;
};

/** Every job of the workflow, legs expanded, ids fresh, timeouts capped at `maxTimeout`. */
export function planJobs(
  workflow: WorkflowFile,
  input: {
    readonly contexts: ExpressionContexts;
    readonly maxTimeoutMinutes: number;
    readonly newId: () => string;
  },
): PlannedJob[] {
  return workflow.jobs.flatMap((job) => {
    const legs = job.matrix.kind === 'legs' ? job.matrix.legs : [null];
    return legs.map((leg) => plannedJob(job, leg, input));
  });
}

function plannedJob(
  job: JobPlan,
  leg: MatrixLeg | null,
  input: {
    readonly contexts: ExpressionContexts;
    readonly maxTimeoutMinutes: number;
    readonly newId: () => string;
  },
): PlannedJob {
  return {
    id: input.newId(),
    key: job.key,
    name: displayName(job, leg, input.contexts),
    matrix: leg,
    needs: job.needs,
    condition: job.condition,
    image: job.image,
    timeoutMinutes: Math.min(
      job.timeoutMinutes ?? input.maxTimeoutMinutes,
      input.maxTimeoutMinutes,
    ),
    steps: job.steps,
    outputs: job.outputs,
    secretNames: job.secretNames,
    contentsWrite: job.contentsWrite,
    idTokenWrite: job.idTokenWrite,
  };
}

/** GitHub's display name: `name:` with `matrix` filled in, or `key (v1, v2)` for a leg. */
function displayName(job: JobPlan, leg: MatrixLeg | null, contexts: ExpressionContexts): string {
  if (job.nameTemplate !== null)
    return interpolate(job.nameTemplate, { ...contexts, matrix: leg ?? {} });
  if (leg === null) return job.key;
  return `${job.key} (${Object.values(leg).map(String).join(', ')})`;
}

/**
 * What a needed job key reports: all legs folded into one result (failure wins, then
 * cancelled; skipped only when every leg was skipped) and their outputs merged. Null while
 * any leg is not done.
 */
export function needResult(jobs: readonly JobState[], key: string): NeedResult | null {
  const legs = jobs.filter((job) => job.key === key);
  if (legs.length === 0 || legs.some((job) => job.status !== 'completed')) return null;
  const conclusions = legs.map((job) => job.conclusion ?? 'failure');
  const outputs: Record<string, string> = {};
  for (const job of legs) Object.assign(outputs, job.outputs);
  return { result: foldConclusions(conclusions), outputs };
}

export type Readiness =
  | { readonly kind: 'blocked' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'start' }
  | { readonly kind: 'error'; readonly reason: string };

/** Whether a queued job may start now: its needs done and its `if:` true. */
export function readiness(
  job: Pick<PlannedJob, 'needs' | 'condition'>,
  jobs: readonly JobState[],
  run: { readonly contexts: ExpressionContexts; readonly cancelled: boolean },
): Readiness {
  const needs: Record<string, NeedResult> = {};
  for (const key of job.needs) {
    const result = needResult(jobs, key);
    if (result === null) return { kind: 'blocked' };
    needs[key] = result;
  }
  const results = Object.values(needs).map((need) => need.result);
  const evaluated = evaluateCondition(
    job.condition,
    { ...run.contexts, needs },
    {
      needsSucceeded: results.every((result) => result === 'success'),
      needsFailed: results.some(isFailure),
      runCancelled: run.cancelled,
    },
  );
  if (!evaluated.ok) return { kind: 'error', reason: `if: ${evaluated.error}` };
  return evaluated.value ? { kind: 'start' } : { kind: 'skip' };
}

/** The run's conclusion once every job is done; null while one is not. */
export function runConclusion(
  jobs: readonly JobState[],
  cancelled: boolean,
): ActionsConclusion | null {
  if (jobs.some((job) => job.status !== 'completed')) return null;
  if (cancelled) return 'cancelled';
  return foldConclusions(jobs.map((job) => job.conclusion ?? 'failure'));
}

function foldConclusions(conclusions: readonly ActionsConclusion[]): ActionsConclusion {
  if (conclusions.some(isFailure)) return 'failure';
  if (conclusions.includes('infrastructure_failure')) return 'infrastructure_failure';
  if (conclusions.includes('cancelled')) return 'cancelled';
  if (conclusions.length > 0 && conclusions.every((conclusion) => conclusion === 'skipped'))
    return 'skipped';
  return 'success';
}

function isFailure(conclusion: ActionsConclusion): boolean {
  return conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure';
}
