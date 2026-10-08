/**
 * The adapter from the gateway's Actions control plane (`ActionsRpc` from
 * `@beanstalk/shared-race/actions`, served on the gateway's `Actions` entrypoint) to the
 * pages' model (`actions-contract.ts`), as one `ActionsClient` scoped to a person and a
 * repository. It translates names (`workflowPath`, `minutesBilled`, `waiting`,
 * `infrastructure_failure`), numbers log lines across the stored chunks, checks that a run
 * belongs to the repository in the URL, and computes this month's minutes from the runs.
 * Every answer is validated against the pages' schemas after translation.
 */
import type {
  ActionsRpc,
  JobView,
  RunDetail as GatewayRunDetail,
  RunSummary as GatewayRunSummary,
  WorkflowSummary,
} from '@beanstalk/shared-race/actions';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import type { Outcome } from '../repositories/registry-client';
import type { ActionsClient } from './actions-client';
import type {
  ActionsActor,
  ActionsUsage,
  Conclusion,
  Job,
  LogLine,
  RunFilter,
  RunStatus,
  RunSummary,
  Workflow,
  WorkflowTrigger,
} from './actions-contract';
import {
  Conclusion as ConclusionSchema,
  LogPage,
  RunDetail,
  RunPage,
  SecretList,
  SecretSummary,
  Workflow as WorkflowSchema,
} from './actions-contract';

/** The beta's limits (`25` D9): the gateway does not report them, so the meter states them. */
const MINUTES_INCLUDED = 100;
const JOB_TIMEOUT_MINUTES = 60;
/** Pages of runs read to add up a month's minutes (100 runs a page). */
const USAGE_PAGES = 5;
/** Pages of stored log chunks read for one job. */
const LOG_PAGES = 200;

/** The gateway's `Actions` binding as `ActionsRpc` (every method present), else null. */
export function asGatewayActions(binding: unknown): ActionsRpc | null {
  if (typeof binding !== 'object' || binding === null) return null;
  return isGatewayActions(binding) ? binding : null;
}

function isGatewayActions(binding: object): binding is ActionsRpc {
  const methods = [
    'listWorkflows',
    'dispatchWorkflow',
    'listRuns',
    'getRun',
    'cancelRun',
    'logStream',
    'logChunks',
    'listSecrets',
    'putSecret',
    'deleteSecret',
  ];
  return methods.every((method) => typeof Reflect.get(binding, method) === 'function');
}

export function gatewayActionsClient(
  rpc: ActionsRpc,
  scope: { readonly actor: ActionsActor; readonly repoId: string },
): ActionsClient {
  const viewer = scope.actor?.id ?? null;
  const { repoId } = scope;
  const runOf = async (runId: string): Promise<Outcome<GatewayRunDetail>> => {
    const found = await settle(rpc.getRun(viewer, runId));
    if (found.ok && found.value.repoId !== repoId) return notFound('No such run.');
    return found;
  };
  return {
    mode: 'live',
    canToggleSecretWithoutValue: false,
    workflows: async () => {
      const listed = await settle(rpc.listWorkflows(viewer, repoId));
      if (!listed.ok) return listed;
      const lastRuns = await Promise.all(
        listed.value.map((workflow) =>
          settle(rpc.listRuns(viewer, repoId, { workflowPath: workflow.path, limit: 1 })),
        ),
      );
      return parsed(
        WorkflowSchema.array(),
        listed.value.map((workflow, index) => {
          const last = lastRuns[index];
          const run = last?.ok === true ? last.value.runs[0] : undefined;
          return workflowOf(workflow, run === undefined ? null : runSummaryOf(run));
        }),
      );
    },
    runs: async (filter) => {
      const page = await settle(rpc.listRuns(viewer, repoId, gatewayFilterOf(filter)));
      if (!page.ok) return page;
      const runs = page.value.runs.map(runSummaryOf).filter((run) => matchesFilter(run, filter));
      return parsed(RunPage, { runs, next: page.value.next });
    },
    run: async (runId) => {
      const [found, workflows] = await Promise.all([
        runOf(runId),
        settle(rpc.listWorkflows(viewer, repoId)),
      ]);
      if (!found.ok) return found;
      const workflow = workflows.ok
        ? workflows.value.find((candidate) => candidate.path === found.value.workflowPath)
        : undefined;
      return parsed(RunDetail, runDetailOf(found.value, workflow));
    },
    log: async (runId, jobId, after) => {
      const found = await runOf(runId);
      if (!found.ok) return found;
      const lines = await storedLines(rpc, viewer, { runId, jobId });
      if (!lines.ok) return lines;
      return parsed(LogPage, {
        lines: lines.value.lines.filter((line) => line.n > after),
        complete: lines.value.complete,
      });
    },
    dispatch: async (request) => {
      const started = await settle(
        rpc.dispatchWorkflow(viewer, repoId, {
          workflowPath: request.workflow,
          ref: request.ref,
          inputs: request.inputs,
        }),
      );
      return started.ok ? { ok: true, value: { runId: started.value.id } } : started;
    },
    cancel: async (runId) => {
      const found = await runOf(runId);
      if (!found.ok) return found;
      const cancelled = await settle(rpc.cancelRun(viewer, runId));
      return cancelled.ok ? { ok: true, value: { cancelled: true } } : cancelled;
    },
    secrets: async () => {
      const [listed, usage] = await Promise.all([
        settle(rpc.listSecrets(viewer, repoId)),
        monthUsage(rpc, viewer, repoId),
      ]);
      if (!listed.ok) return listed;
      return parsed(SecretList, {
        secrets: listed.value.map(secretOf),
        usage,
      });
    },
    putSecret: async (input) => {
      if (input.value === null)
        return {
          ok: false,
          error: {
            code: 'invalid_request',
            message: 'Save the secret again with its value to change pre-land access.',
          },
        };
      const saved = await settle(
        rpc.putSecret(viewer, repoId, {
          name: input.name,
          value: input.value,
          prelandAllowed: input.availableToPreland,
        }),
      );
      return saved.ok ? parsed(SecretSummary, secretOf(saved.value)) : saved;
    },
    deleteSecret: (name) => settle(rpc.deleteSecret(viewer, repoId, name)),
  };
}

function workflowOf(workflow: WorkflowSummary, lastRun: RunSummary | null): Workflow {
  const triggers: WorkflowTrigger[] = [
    ...workflow.triggers.map((trigger): WorkflowTrigger => {
      switch (trigger.kind) {
        case 'push':
          return { event: 'push', branches: [...trigger.branches] };
        case 'workflow_dispatch':
          return {
            event: 'workflow_dispatch',
            inputs: trigger.inputs.map((input) => ({ ...input, options: [...input.options] })),
          };
        case 'schedule':
          return { event: 'schedule', crons: [...trigger.crons] };
        default:
          return assertNever(trigger);
      }
    }),
    ...workflow.unsupportedEvents.map((name): WorkflowTrigger => ({
      event: 'other',
      name,
      support: 'later',
      reason: 'Beanstalk does not start runs for this event yet.',
    })),
  ];
  const problem = workflow.problems[0];
  return {
    id: workflow.path,
    name: workflow.name,
    path: workflow.path,
    triggers,
    notes: workflow.compatibility
      .filter((note) => note.verdict !== 'runs')
      .map((note) => ({
        level: note.verdict === 'never-runs' ? 'never' : 'differs',
        text: `${note.feature}: ${note.detail}`,
      })),
    error:
      problem === undefined
        ? null
        : `${problem.message}${problem.line === null ? '' : ` (line ${problem.line}${problem.column === null ? '' : `, column ${problem.column}`})`}`,
    lastRun,
  };
}

function runSummaryOf(run: GatewayRunSummary): RunSummary {
  return {
    id: run.id,
    number: run.number,
    attempt: 1,
    workflowId: run.workflowPath,
    workflowName: run.workflowName,
    event: run.event,
    status: statusOf(run.status),
    conclusion: conclusionOf(run.conclusion),
    branch: 'stalk',
    sha: run.sha,
    title: '',
    bean: null,
    actor: run.actor === 'schedule' ? { kind: 'schedule' } : { kind: 'person', handle: run.actor },
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    billedMinutes: run.minutesBilled,
    reason: run.reason,
  };
}

function runDetailOf(run: GatewayRunDetail, workflow: WorkflowSummary | undefined) {
  return {
    ...runSummaryOf(run),
    jobs: run.jobs.map((job) => jobOf(job, run.jobs)),
    annotations: [],
    summary: null,
    inputs: { ...run.inputs },
    workflowPath: run.workflowPath,
    canRerun: workflow?.triggers.some((trigger) => trigger.kind === 'workflow_dispatch') ?? false,
  };
}

/** A job, its `needs` turned from job keys into the ids of those jobs (every matrix leg). */
function jobOf(job: JobView, all: readonly JobView[]): Job {
  return {
    id: job.id,
    name: job.name,
    needs: all.filter((other) => job.needs.includes(other.key)).map((other) => other.id),
    runsOn: '',
    status: statusOf(job.status),
    conclusion: conclusionOf(job.conclusion),
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    steps: job.steps.map((step) => ({
      ...step,
      status: statusOf(step.status),
      conclusion: conclusionOf(step.conclusion),
    })),
  };
}

function statusOf(status: 'queued' | 'waiting' | 'in_progress' | 'completed'): RunStatus {
  return status === 'waiting' ? 'queued' : status;
}

function conclusionOf(conclusion: string | null): Conclusion | null {
  if (conclusion === null) return null;
  if (conclusion === 'infrastructure_failure') return 'infra_lost';
  const known = ConclusionSchema.safeParse(conclusion);
  return known.success ? known.data : 'failure';
}

function gatewayFilterOf(filter: RunFilter) {
  const status =
    filter.status === 'in_progress' || filter.status === 'queued' ? filter.status : undefined;
  return {
    limit: filter.limit,
    ...(filter.workflow === undefined ? {} : { workflowPath: filter.workflow }),
    ...(status === undefined ? {} : { status }),
    ...(filter.before === undefined ? {} : { cursor: filter.before }),
  };
}

/** What the gateway cannot filter (a conclusion, a line) is filtered here, on the page read. */
function matchesFilter(run: RunSummary, filter: RunFilter): boolean {
  if (filter.branch !== undefined && filter.branch !== 'stalk' && filter.branch !== 'main')
    return false;
  if (filter.status === undefined || filter.status === 'in_progress' || filter.status === 'queued')
    return true;
  return run.conclusion === filter.status;
}

/** Every stored chunk of the job, its lines numbered from 1; job lines (no step) under step 0. */
async function storedLines(
  rpc: ActionsRpc,
  viewer: string | null,
  where: { readonly runId: string; readonly jobId: string },
): Promise<Outcome<{ readonly lines: readonly LogLine[]; readonly complete: boolean }>> {
  const lines: LogLine[] = [];
  let after = 0;
  for (let page = 0; page < LOG_PAGES; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each page starts where the last one ended
    const chunks = await settle(rpc.logChunks(viewer, where.runId, where.jobId, after));
    if (!chunks.ok) return chunks;
    for (const chunk of chunks.value.chunks)
      for (const line of chunk.lines)
        lines.push({ n: lines.length + 1, step: line.step ?? 0, text: line.text });
    if (chunks.value.next === null)
      return { ok: true, value: { lines, complete: chunks.value.complete } };
    after = chunks.value.next;
  }
  return { ok: true, value: { lines, complete: false } };
}

/** This month's billed minutes, from the runs created this month (newest first). */
async function monthUsage(
  rpc: ActionsRpc,
  viewer: string | null,
  repoId: string,
): Promise<ActionsUsage | null> {
  const month = new Date().toISOString().slice(0, 7);
  let minutes = 0;
  let cursor: string | undefined;
  for (let page = 0; page < USAGE_PAGES; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each page follows the previous cursor
    const runs = await settle(
      rpc.listRuns(viewer, repoId, { limit: 100, ...(cursor === undefined ? {} : { cursor }) }),
    );
    if (!runs.ok) return null;
    const thisMonth = runs.value.runs.filter((run) => run.createdAt.startsWith(month));
    minutes += thisMonth.reduce((sum, run) => sum + run.minutesBilled, 0);
    if (runs.value.next === null || thisMonth.length < runs.value.runs.length) break;
    cursor = runs.value.next;
  }
  return {
    month,
    minutesUsed: minutes,
    minutesIncluded: MINUTES_INCLUDED,
    jobTimeoutMinutes: JOB_TIMEOUT_MINUTES,
  };
}

function secretOf(secret: {
  readonly name: string;
  readonly prelandAllowed: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
}) {
  return {
    name: secret.name,
    updatedAt: secret.updatedAt,
    updatedBy: secret.updatedBy,
    availableToPreland: secret.prelandAllowed,
  };
}

/** A gateway call as an outcome: its refusal, or a thrown binding error as "unavailable". */
async function settle<T>(pending: Promise<RpcResult<T>>): Promise<Outcome<T>> {
  try {
    const result = await pending;
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: { code: result.error.code, message: result.error.message } };
  } catch {
    return {
      ok: false,
      error: { code: 'unavailable', message: 'The Actions control plane did not answer.' },
    };
  }
}

function parsed<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): Outcome<T> {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        error: {
          code: 'upstream_failed',
          message: 'Actions answered in a shape this page does not know.',
        },
      };
}

function notFound(message: string): Outcome<never> {
  return { ok: false, error: { code: 'not_found', message } };
}

function assertNever(value: never): never {
  throw new Error(`unexpected trigger ${JSON.stringify(value)}`);
}
