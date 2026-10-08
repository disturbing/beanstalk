/**
 * The shape the web app expects of the Actions control plane (`ActionsRpc`, owned by
 * `packages/shared-race/src/actions.ts` in the actions lane; `docs/claude-opus/25` §3, §5).
 * Until that module lands, these schemas are the web's reading of it: every answer from the
 * binding (or the fixture fake) is validated against them in `actions-client.ts`, so a
 * difference shows up as one failed parse there, never as a wrong page.
 */
import { z } from 'zod';

import type { RpcResult } from '@beanstalk/shared-race/rpc';

/** GitHub's run and job vocabulary, kept so workflows and people read the same words. */
export const RunStatus = z.enum(['queued', 'in_progress', 'completed']);
export type RunStatus = z.infer<typeof RunStatus>;

/** `infra_lost`: the container went away; never shown as red (`25` §6.3). */
export const Conclusion = z.enum([
  'success',
  'failure',
  'cancelled',
  'timed_out',
  'skipped',
  'infra_lost',
]);
export type Conclusion = z.infer<typeof Conclusion>;

export const RunEvent = z.enum(['push', 'workflow_dispatch', 'schedule']);
export type RunEvent = z.infer<typeof RunEvent>;

export const DispatchInput = z.object({
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(['string', 'boolean', 'choice', 'number', 'environment']),
  required: z.boolean(),
  default: z.string().nullable(),
  options: z.array(z.string()),
});
export type DispatchInput = z.infer<typeof DispatchInput>;

/** One `on:` entry, as the compatibility report reads it (`25` §1.1). */
export const WorkflowTrigger = z.discriminatedUnion('event', [
  z.object({ event: z.literal('push'), branches: z.array(z.string()) }),
  z.object({ event: z.literal('workflow_dispatch'), inputs: z.array(DispatchInput) }),
  z.object({ event: z.literal('schedule'), crons: z.array(z.string()) }),
  z.object({
    event: z.literal('other'),
    name: z.string(),
    support: z.enum(['later', 'never']),
    reason: z.string(),
  }),
]);
export type WorkflowTrigger = z.infer<typeof WorkflowTrigger>;

export const CompatibilityNote = z.object({
  level: z.enum(['differs', 'never']),
  text: z.string(),
});
export type CompatibilityNote = z.infer<typeof CompatibilityNote>;

export const RunActor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), handle: z.string() }),
  z.object({ kind: z.literal('session'), name: z.string() }),
  z.object({ kind: z.literal('schedule') }),
]);
export type RunActor = z.infer<typeof RunActor>;

export const RunSummary = z.object({
  id: z.string(),
  number: z.number().int(),
  attempt: z.number().int(),
  workflowId: z.string(),
  workflowName: z.string(),
  event: RunEvent,
  status: RunStatus,
  conclusion: Conclusion.nullable(),
  /** The line the run's commit is on: `stalk` for push and schedule runs. */
  branch: z.string(),
  sha: z.string(),
  title: z.string(),
  /** The bean whose landing moved the stalk to `sha`, when there is one. */
  bean: z.string().nullable(),
  actor: RunActor,
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  /** Each job's minutes rounded up, summed (GitHub's billing rule). */
  billedMinutes: z.number(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const Workflow = z.object({
  /** The file's path, which is its identity. */
  id: z.string(),
  name: z.string(),
  path: z.string(),
  triggers: z.array(WorkflowTrigger),
  notes: z.array(CompatibilityNote),
  /** A file the parser refused: why, with line and column. */
  error: z.string().nullable(),
  lastRun: RunSummary.nullable(),
});
export type Workflow = z.infer<typeof Workflow>;

export const Step = z.object({
  number: z.number().int(),
  name: z.string(),
  status: RunStatus,
  conclusion: Conclusion.nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type Step = z.infer<typeof Step>;

export const Job = z.object({
  id: z.string(),
  name: z.string(),
  /** Ids of the jobs this one waits for. */
  needs: z.array(z.string()),
  runsOn: z.string(),
  status: RunStatus,
  conclusion: Conclusion.nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  steps: z.array(Step),
});
export type Job = z.infer<typeof Job>;

export const Annotation = z.object({
  level: z.enum(['error', 'warning', 'notice']),
  message: z.string(),
  jobId: z.string(),
  path: z.string().nullable(),
  line: z.number().int().nullable(),
});
export type Annotation = z.infer<typeof Annotation>;

export const RunDetail = RunSummary.extend({
  jobs: z.array(Job),
  annotations: z.array(Annotation),
  /** `GITHUB_STEP_SUMMARY` Markdown, all jobs joined; null when none wrote one. */
  summary: z.string().nullable(),
  inputs: z.record(z.string(), z.string()),
  workflowPath: z.string(),
  /** Whether `workflow_dispatch` is on this workflow (re-run dispatches it again). */
  canRerun: z.boolean(),
});
export type RunDetail = z.infer<typeof RunDetail>;

export const RunPage = z.object({ runs: z.array(RunSummary), next: z.string().nullable() });
export type RunPage = z.infer<typeof RunPage>;

export const RunFilter = z.object({
  workflow: z.string().optional(),
  status: z.enum(['success', 'failure', 'cancelled', 'in_progress', 'queued']).optional(),
  branch: z.string().optional(),
  /** The `next` of the previous page. */
  before: z.string().optional(),
  limit: z.number().int().min(1).max(100),
});
export type RunFilter = z.infer<typeof RunFilter>;

/** One masked log line; `n` counts from 1 within its job. */
export const LogLine = z.object({ n: z.number().int(), step: z.number().int(), text: z.string() });
export type LogLine = z.infer<typeof LogLine>;

export const LogPage = z.object({
  lines: z.array(LogLine),
  /** Whether the job has finished and every line is in. */
  complete: z.boolean(),
});
export type LogPage = z.infer<typeof LogPage>;

export const SecretSummary = z.object({
  name: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
  /** Off by default: pre-land checks run code from beans not yet reviewed (`25` §3.4). */
  availableToPreland: z.boolean(),
});
export type SecretSummary = z.infer<typeof SecretSummary>;

export const ActionsUsage = z.object({
  month: z.string(),
  minutesUsed: z.number(),
  minutesIncluded: z.number(),
  jobTimeoutMinutes: z.number(),
});
export type ActionsUsage = z.infer<typeof ActionsUsage>;

export const SecretList = z.object({
  secrets: z.array(SecretSummary),
  usage: ActionsUsage.nullable(),
});
export type SecretList = z.infer<typeof SecretList>;

export const SECRET_NAME = /^[A-Z_][A-Z0-9_]{0,99}$/;

export const PutSecretInput = z.strictObject({
  name: z
    .string()
    .trim()
    .transform((name) => name.toUpperCase())
    .pipe(
      z
        .string()
        .regex(SECRET_NAME, 'Letters, digits and _ only, not starting with a digit.')
        .refine((name) => !name.startsWith('GITHUB_'), 'Names starting GITHUB_ are reserved.'),
    ),
  /** Null keeps the stored value (only the pre-land toggle changes). */
  value: z
    .string()
    .min(1, 'Enter a value.')
    .max(48 * 1024)
    .nullable(),
  availableToPreland: z.boolean(),
});
export type PutSecretInput = z.infer<typeof PutSecretInput>;

export const DispatchRequest = z.strictObject({
  workflow: z.string().min(1),
  ref: z.string().min(1),
  inputs: z.record(z.string(), z.string()),
});
export type DispatchRequest = z.infer<typeof DispatchRequest>;

/** The person asking; null for someone reading a public repository signed out. */
export type ActionsActor = { readonly id: string; readonly handle: string } | null;

/** What the web calls. Every method checks access again (read to view, maintain to act). */
export type ActionsRpc = {
  listWorkflows(actor: ActionsActor, repoId: string): Promise<RpcResult<unknown>>;
  dispatchWorkflow(
    actor: ActionsActor,
    repoId: string,
    request: DispatchRequest,
  ): Promise<RpcResult<unknown>>;
  listRuns(actor: ActionsActor, repoId: string, filter: RunFilter): Promise<RpcResult<unknown>>;
  getRun(actor: ActionsActor, repoId: string, runId: string): Promise<RpcResult<unknown>>;
  cancelRun(actor: ActionsActor, repoId: string, runId: string): Promise<RpcResult<unknown>>;
  /** Stored history (R2 segments, then the live tail): lines after `after`. */
  logChunks(
    actor: ActionsActor,
    repoId: string,
    where: { readonly runId: string; readonly jobId: string; readonly after: number },
  ): Promise<RpcResult<unknown>>;
  listSecrets(actor: ActionsActor, repoId: string): Promise<RpcResult<unknown>>;
  putSecret(
    actor: ActionsActor,
    repoId: string,
    input: PutSecretInput,
  ): Promise<RpcResult<unknown>>;
  deleteSecret(actor: ActionsActor, repoId: string, name: string): Promise<RpcResult<unknown>>;
};
