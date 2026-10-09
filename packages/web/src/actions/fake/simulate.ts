/**
 * A scripted run seen at a moment: from a workflow's scripts, when the run started, whether it
 * fails and when it was cancelled, what its jobs, steps, annotations and log lines are at
 * `nowMs`. Pure, so the fake control plane needs no store for runs: asking again later shows
 * the run further along, which is what makes the staging run page stream.
 */
import type {
  Annotation,
  Conclusion,
  Job,
  LogLine,
  RunActor,
  RunDetail,
  RunEvent,
  RunStatus,
  Step,
} from '../actions-contract';
import type { JobScript, ScriptLine, WorkflowScript } from './fixture-workflows';

/** From the run's creation to its first jobs starting (a container booting). */
const QUEUE_MS = 3000;
/** From the jobs a job needs finishing to it starting. */
const JOB_GAP_MS = 1500;

export type RunPlan = {
  readonly id: string;
  readonly number: number;
  readonly script: WorkflowScript;
  readonly event: RunEvent;
  readonly startMs: number;
  readonly fails: boolean;
  readonly cancelAtMs: number | null;
  readonly sha: string;
  readonly title: string;
  readonly bean: string | null;
  readonly actor: RunActor;
  readonly inputs: Readonly<Record<string, string>>;
};

type Outcome = 'success' | 'failure' | 'skipped';

type StepTimes = {
  readonly startMs: number;
  readonly endMs: number;
  readonly outcome: Outcome;
  readonly lines: readonly ScriptLine[];
};

type JobTimes = {
  readonly script: JobScript;
  readonly startMs: number;
  readonly endMs: number;
  readonly outcome: Outcome;
  readonly steps: readonly StepTimes[];
};

/** The run as the control plane would report it at `nowMs`. */
export function runAt(plan: RunPlan, nowMs: number): RunDetail {
  const times = timelineOf(plan);
  const seenMs = Math.min(nowMs, plan.cancelAtMs ?? Number.POSITIVE_INFINITY);
  const cancelled = plan.cancelAtMs !== null && plan.cancelAtMs <= nowMs;
  const jobs = times.map((job) => jobAt(job, seenMs, cancelled));
  const status = runStatusOf(jobs);
  const started = jobs.flatMap((job) =>
    job.startedAt === null ? [] : [Date.parse(job.startedAt)],
  );
  const ended = jobs.flatMap((job) =>
    job.completedAt === null ? [] : [Date.parse(job.completedAt)],
  );
  const conclusion = status === 'completed' ? runConclusionOf(jobs) : null;
  return {
    id: plan.id,
    number: plan.number,
    attempt: 1,
    workflowId: plan.script.workflow.id,
    workflowName: plan.script.workflow.name,
    workflowPath: plan.script.workflow.path,
    event: plan.event,
    status,
    conclusion,
    branch: 'stalk',
    sha: plan.sha,
    title: plan.title,
    bean: plan.bean,
    actor: plan.actor,
    createdAt: iso(plan.startMs),
    startedAt: started.length === 0 ? null : iso(Math.min(...started)),
    completedAt: status === 'completed' && ended.length > 0 ? iso(Math.max(...ended)) : null,
    billedMinutes: billedMinutesOf(times, seenMs),
    reason: null,
    jobs,
    annotations: annotationsAt(plan, times, seenMs),
    summary: conclusion === 'success' ? plan.script.summary : null,
    inputs: plan.inputs,
    canRerun: plan.script.workflow.triggers.some((t) => t.event === 'workflow_dispatch'),
    modelUsage: null,
  };
}

/** The job's log lines written by `nowMs` (after a cancel, up to the cancel). */
export function logAt(plan: RunPlan, jobId: string, nowMs: number): readonly LogLine[] {
  const job = timelineOf(plan).find((times) => times.script.id === jobId);
  if (job === undefined) return [];
  const seenMs = Math.min(nowMs, plan.cancelAtMs ?? Number.POSITIVE_INFINITY);
  const timed = job.steps.flatMap((step, index) =>
    step.lines.map((line) => ({ at: step.startMs + line[0], step: index + 1, text: line[1] })),
  );
  const cancelledStep = job.steps.findIndex(
    (step) =>
      plan.cancelAtMs !== null && step.startMs <= plan.cancelAtMs && plan.cancelAtMs < step.endMs,
  );
  const withCancel =
    cancelledStep === -1 || plan.cancelAtMs === null
      ? timed
      : [
          ...timed.filter((line) => line.at < (plan.cancelAtMs ?? 0)),
          {
            at: plan.cancelAtMs,
            step: cancelledStep + 1,
            text: 'Error: The operation was canceled.',
          },
        ];
  return withCancel
    .filter((line) => line.at <= seenMs)
    .map((line, index) => ({ n: index + 1, step: line.step, text: line.text }));
}

function timelineOf(plan: RunPlan): readonly JobTimes[] {
  const done = new Map<string, JobTimes>();
  for (const script of plan.script.jobs) {
    const needs = script.needs.flatMap((id) => {
      const found = done.get(id);
      return found === undefined ? [] : [found];
    });
    const readyMs =
      needs.length === 0
        ? plan.startMs + QUEUE_MS
        : Math.max(...needs.map((need) => need.endMs)) + JOB_GAP_MS;
    const blocked = needs.some((need) => need.outcome !== 'success');
    done.set(script.id, blocked ? skippedJob(script, readyMs) : jobTimes(plan, script, readyMs));
  }
  return [...done.values()];
}

function skippedJob(script: JobScript, atMs: number): JobTimes {
  const steps = script.steps.map((): StepTimes => ({
    startMs: atMs,
    endMs: atMs,
    outcome: 'skipped',
    lines: [],
  }));
  return { script, startMs: atMs, endMs: atMs, outcome: 'skipped', steps };
}

function jobTimes(plan: RunPlan, script: JobScript, startMs: number): JobTimes {
  const failure =
    plan.fails && plan.script.failure?.jobId === script.id ? plan.script.failure : null;
  const steps: StepTimes[] = [];
  let cursor = startMs;
  let failed = false;
  for (const [index, step] of script.steps.entries()) {
    if (failed) {
      steps.push({ startMs: cursor, endMs: cursor, outcome: 'skipped', lines: [] });
    } else if (failure !== null && failure.step === index + 1) {
      const kept = step.lines.filter((line) => line[0] < (failure.lines[0]?.[0] ?? failure.atMs));
      steps.push({
        startMs: cursor,
        endMs: cursor + failure.atMs,
        outcome: 'failure',
        lines: [...kept, ...failure.lines],
      });
      cursor += failure.atMs;
      failed = true;
    } else {
      steps.push({
        startMs: cursor,
        endMs: cursor + step.ms,
        outcome: 'success',
        lines: step.lines,
      });
      cursor += step.ms;
    }
  }
  return { script, startMs, endMs: cursor, outcome: failed ? 'failure' : 'success', steps };
}

type Moment = {
  readonly status: RunStatus;
  readonly conclusion: Conclusion | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
};

/** Where a span (a job or a step) is at `seenMs`, given how it ends and whether it was cancelled. */
function momentOf(
  span: { readonly startMs: number; readonly endMs: number; readonly outcome: Outcome },
  seenMs: number,
  cancelled: boolean,
): Moment {
  if (span.outcome === 'skipped' && seenMs >= span.endMs)
    return {
      status: 'completed',
      conclusion: 'skipped',
      startedAt: null,
      completedAt: iso(span.endMs),
    };
  if (seenMs < span.startMs)
    return cancelled
      ? { status: 'completed', conclusion: 'cancelled', startedAt: null, completedAt: iso(seenMs) }
      : { status: 'queued', conclusion: null, startedAt: null, completedAt: null };
  if (seenMs >= span.endMs)
    return {
      status: 'completed',
      conclusion: span.outcome,
      startedAt: iso(span.startMs),
      completedAt: iso(span.endMs),
    };
  return cancelled
    ? {
        status: 'completed',
        conclusion: 'cancelled',
        startedAt: iso(span.startMs),
        completedAt: iso(seenMs),
      }
    : { status: 'in_progress', conclusion: null, startedAt: iso(span.startMs), completedAt: null };
}

function jobAt(job: JobTimes, seenMs: number, cancelled: boolean): Job {
  const steps = job.steps.map((step, index): Step => ({
    number: index + 1,
    name: job.script.steps[index]?.name ?? `Step ${index + 1}`,
    ...momentOf(step, seenMs, cancelled),
  }));
  return {
    id: job.script.id,
    name: job.script.name,
    needs: [...job.script.needs],
    runsOn: job.script.runsOn,
    ...momentOf(job, seenMs, cancelled),
    steps,
    outputs: {},
  };
}

function runStatusOf(jobs: readonly Job[]): RunStatus {
  if (jobs.every((job) => job.status === 'completed')) return 'completed';
  if (jobs.every((job) => job.status === 'queued')) return 'queued';
  return 'in_progress';
}

function runConclusionOf(jobs: readonly Job[]): Conclusion {
  if (jobs.some((job) => job.conclusion === 'failure')) return 'failure';
  if (jobs.some((job) => job.conclusion === 'cancelled')) return 'cancelled';
  return 'success';
}

function billedMinutesOf(jobs: readonly JobTimes[], seenMs: number): number {
  return jobs
    .filter((job) => job.outcome !== 'skipped' && job.startMs <= seenMs)
    .reduce((sum, job) => sum + Math.ceil((Math.min(job.endMs, seenMs) - job.startMs) / 60_000), 0);
}

function annotationsAt(plan: RunPlan, jobs: readonly JobTimes[], seenMs: number): Annotation[] {
  const finished = new Set(jobs.filter((job) => job.endMs <= seenMs).map((job) => job.script.id));
  const failure = plan.script.failure;
  const failed =
    plan.fails && failure !== null && finished.has(failure.jobId)
      ? [{ ...failure.annotation, jobId: failure.jobId }]
      : [];
  return [...failed, ...plan.script.warnings.filter((warning) => finished.has(warning.jobId))];
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
