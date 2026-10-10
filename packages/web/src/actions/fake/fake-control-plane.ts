/**
 * `ActionsViewRpc` answered from fixtures, for staging and tests until the actions Worker exists.
 * Runs are generated from the clock (CI every seven minutes as the stalk moves, Deploy after
 * every other move, the nightly e2e at 03:00 UTC), so one is often running and its log grows
 * between requests. Dispatches, cancels and secret names go to the caller's overlay store.
 */
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { RunSummary } from '../actions-contract';
import type {
  ActionsActor,
  ActionsViewRpc,
  ActionsUsage,
  DispatchRequest,
  LogPage,
  PutSecretInput,
  RunActor,
  RunDetail,
  RunFilter,
  RunPage,
  SecretList,
  SecretSummary,
  Workflow,
} from '../actions-contract';
import type { DispatchedRun, OverlayStore, RepoOverlay } from './fake-overlay';
import { repoOverlayOf, withRepoOverlay } from './fake-overlay';
import type { WorkflowScript } from './fixture-workflows';
import { FIXTURE_COMMITS, FIXTURE_PEOPLE, WORKFLOW_SCRIPTS } from './fixture-workflows';
import type { RunPlan } from './simulate';
import { logAt, runAt } from './simulate';

const CI_CYCLE_S = 420;
const CI_OFFSET_S = 20;
const DAY_S = 86_400;
const E2E_AT_S = 3 * 3600;
/** Run numbers count from here, so they read like a repository a few weeks old. */
const EPOCH_S = Date.UTC(2026, 8, 1) / 1000;
/** How far back a filtered list looks before it stops. */
const MAX_SCAN = 400;

const FIXTURE_SECRETS: readonly SecretSummary[] = [
  {
    name: 'CLOUDFLARE_API_TOKEN',
    updatedAt: '2026-10-05T09:12:00.000Z',
    updatedBy: 'coop',
    availableToPreland: false,
  },
  {
    name: 'NPM_TOKEN',
    updatedAt: '2026-09-28T16:40:00.000Z',
    updatedBy: 'dana',
    availableToPreland: false,
  },
  {
    name: 'TEST_DATABASE_URL',
    updatedAt: '2026-09-22T11:03:00.000Z',
    updatedBy: 'coop',
    availableToPreland: true,
  },
];

export function fakeControlPlane(deps: {
  readonly store: OverlayStore;
  readonly nowMs: () => number;
}): ActionsViewRpc {
  const overlayOf = (repoId: string) => repoOverlayOf(deps.store.read(), repoId);
  const save = (repoId: string, next: RepoOverlay) =>
    deps.store.write(withRepoOverlay(deps.store.read(), repoId, next));
  const planOf = (repoId: string, runId: string) => findPlan(runId, overlayOf(repoId));
  return {
    listWorkflows: async (_actor, repoId) => {
      const now = deps.nowMs();
      const workflows = WORKFLOW_SCRIPTS.map((script): Workflow => {
        const last = runsBelow(overlayOf(repoId), now, { workflow: script.workflow.id, limit: 1 });
        return { ...script.workflow, lastRun: last.runs[0] ?? null };
      });
      return ok(workflows);
    },
    dispatchWorkflow: async (actor, repoId, request) => dispatch(actor, repoId, request),
    listRuns: async (_actor, repoId, filter) =>
      ok(runsBelow(overlayOf(repoId), deps.nowMs(), filter)),
    getRun: async (_actor, repoId, runId) => {
      const plan = planOf(repoId, runId);
      return plan === null ? notFound('No such run.') : ok(runAt(plan, deps.nowMs()));
    },
    cancelRun: async (actor, repoId, runId) => cancel(actor, repoId, runId),
    logChunks: async (_actor, repoId, where) => {
      const plan = planOf(repoId, where.runId);
      if (plan === null) return notFound('No such run.');
      const now = deps.nowMs();
      const job = runAt(plan, now).jobs.find((candidate) => candidate.id === where.jobId);
      if (job === undefined) return notFound('No such job.');
      const lines = logAt(plan, where.jobId, now).filter((line) => line.n > where.after);
      return ok({ lines, complete: job.status === 'completed' } satisfies LogPage);
    },
    listSecrets: async (_actor, repoId) => {
      const overlay = overlayOf(repoId);
      const list: SecretList = {
        secrets: [...(overlay.secrets ?? FIXTURE_SECRETS)].toSorted((a, b) =>
          a.name.localeCompare(b.name),
        ),
        usage: usageOf(overlay, deps.nowMs()),
      };
      return ok(list);
    },
    putSecret: async (actor, repoId, input) => putSecret(actor, repoId, input),
    deleteSecret: async (actor, repoId, name) => {
      if (actor === null) return forbidden();
      const overlay = overlayOf(repoId);
      const secrets = overlay.secrets ?? FIXTURE_SECRETS;
      if (!secrets.some((secret) => secret.name === name)) return notFound('No such secret.');
      save(repoId, { ...overlay, secrets: secrets.filter((secret) => secret.name !== name) });
      return ok({ deleted: true });
    },
  };

  async function dispatch(
    actor: ActionsActor,
    repoId: string,
    request: DispatchRequest,
  ): Promise<RpcResult<unknown>> {
    if (actor === null) return forbidden();
    const script = WORKFLOW_SCRIPTS.find((candidate) => candidate.workflow.id === request.workflow);
    if (script === undefined) return notFound('No such workflow.');
    if (!script.workflow.triggers.some((trigger) => trigger.event === 'workflow_dispatch'))
      return invalid('This workflow has no workflow_dispatch trigger.');
    const overlay = overlayOf(repoId);
    const atMs = deps.nowMs();
    const id = `${script.key}-${Math.floor(atMs / 1000)}-d`;
    const run: DispatchedRun = {
      id,
      workflow: script.workflow.id,
      atMs,
      by: actor.handle,
      inputs: request.inputs,
    };
    save(repoId, { ...overlay, dispatched: [...overlay.dispatched, run] });
    return ok({ runId: id });
  }

  async function cancel(
    actor: ActionsActor,
    repoId: string,
    runId: string,
  ): Promise<RpcResult<unknown>> {
    if (actor === null) return forbidden();
    const overlay = overlayOf(repoId);
    const plan = findPlan(runId, overlay);
    if (plan === null) return notFound('No such run.');
    const now = deps.nowMs();
    if (runAt(plan, now).status === 'completed') return invalid('The run has already finished.');
    save(repoId, { ...overlay, cancelled: { ...overlay.cancelled, [runId]: now } });
    return ok({ cancelled: true });
  }

  async function putSecret(
    actor: ActionsActor,
    repoId: string,
    input: PutSecretInput,
  ): Promise<RpcResult<unknown>> {
    if (actor === null) return forbidden();
    const overlay = overlayOf(repoId);
    const secrets = overlay.secrets ?? FIXTURE_SECRETS;
    const exists = secrets.some((secret) => secret.name === input.name);
    if (!exists && input.value === null) return notFound('No such secret.');
    // The value is accepted and dropped: the fake keeps names only.
    const updated: SecretSummary = {
      name: input.name,
      updatedAt: new Date(deps.nowMs()).toISOString(),
      updatedBy: actor.handle,
      availableToPreland: input.availableToPreland,
    };
    save(repoId, {
      ...overlay,
      secrets: [...secrets.filter((secret) => secret.name !== input.name), updated],
    });
    return ok(updated);
  }
}

/** Runs newest first, below the `before` cursor (a start second), matching the filter. */
function runsBelow(overlay: RepoOverlay, nowMs: number, filter: Partial<RunFilter>): RunPage {
  const limit = filter.limit ?? 25;
  if (filter.branch !== undefined && filter.branch !== 'stalk' && filter.branch !== 'main')
    return { runs: [], next: null };
  const beforeS =
    filter.before === undefined ? Math.floor(nowMs / 1000) + 1 : Number(filter.before);
  const plans = candidatePlans(overlay, nowMs, beforeS).filter(
    (plan) => filter.workflow === undefined || plan.script.workflow.id === filter.workflow,
  );
  const runs: RunDetail[] = [];
  let lastStartS: number | null = null;
  for (const plan of plans.slice(0, MAX_SCAN)) {
    const run = runAt(plan, nowMs);
    lastStartS = Math.floor(plan.startMs / 1000);
    if (matchesStatus(run, filter.status)) runs.push(run);
    if (runs.length === limit) break;
  }
  return {
    runs: runs.map((run) => RunSummary.parse(run)),
    next: runs.length === limit && lastStartS !== null ? String(lastStartS) : null,
  };
}

function matchesStatus(run: RunDetail, status: RunFilter['status']): boolean {
  if (status === undefined) return true;
  if (status === 'in_progress' || status === 'queued') return run.status === status;
  return run.conclusion === status;
}

/** Every run that started before `beforeS`, newest first (enough of each kind to fill a scan). */
function candidatePlans(overlay: RepoOverlay, nowMs: number, beforeS: number): readonly RunPlan[] {
  const topS = Math.min(beforeS - 1, Math.floor(nowMs / 1000));
  const plans: RunPlan[] = [];
  const latestK = Math.floor((topS - CI_OFFSET_S) / CI_CYCLE_S);
  for (let k = latestK; k > latestK - MAX_SCAN / 2; k -= 1) {
    plans.push(pushPlan('ci', k, overlay));
    if (k % 2 === 0 && !ciFails(k)) plans.push(pushPlan('deploy', k, overlay));
  }
  const today = Math.floor((topS - E2E_AT_S) / DAY_S);
  for (let day = today; day > today - 30; day -= 1) plans.push(schedulePlan(day, overlay));
  for (const run of overlay.dispatched) {
    const plan = dispatchedPlan(run, overlay);
    if (plan !== null) plans.push(plan);
  }
  return plans
    .filter((plan) => plan.startMs / 1000 < beforeS && plan.startMs <= nowMs)
    .toSorted((a, b) => b.startMs - a.startMs);
}

/** A run id back to its plan: `<key>-<start second>` for push and schedule, `-d` for dispatches. */
function findPlan(runId: string, overlay: RepoOverlay): RunPlan | null {
  const dispatched = overlay.dispatched.find((run) => run.id === runId);
  if (dispatched !== undefined) return dispatchedPlan(dispatched, overlay);
  const match = /^(ci|deploy|e2e)-(\d{9,11})$/.exec(runId);
  if (match === null) return null;
  const startS = Number(match[2]);
  if (match[1] === 'e2e') {
    const day = Math.floor((startS - E2E_AT_S) / DAY_S);
    return day * DAY_S + E2E_AT_S === startS ? schedulePlan(day, overlay) : null;
  }
  const k = (startS - CI_OFFSET_S) / CI_CYCLE_S;
  if (!Number.isInteger(k)) return null;
  if (match[1] === 'deploy' && (k % 2 !== 0 || ciFails(k))) return null;
  return pushPlan(match[1] === 'ci' ? 'ci' : 'deploy', k, overlay);
}

function pushPlan(key: 'ci' | 'deploy', k: number, overlay: RepoOverlay): RunPlan {
  const startS = k * CI_CYCLE_S + CI_OFFSET_S;
  const id = `${key}-${startS}`;
  const commit = commitOf(k);
  return {
    id,
    number:
      key === 'ci'
        ? k - Math.floor(EPOCH_S / CI_CYCLE_S)
        : Math.floor((k - EPOCH_S / CI_CYCLE_S) / 2),
    script: scriptOf(key),
    event: 'push',
    startMs: startS * 1000,
    fails: key === 'ci' && ciFails(k),
    cancelAtMs: overlay.cancelled[id] ?? null,
    ...commit,
    inputs: {},
  };
}

function schedulePlan(day: number, overlay: RepoOverlay): RunPlan {
  const startS = day * DAY_S + E2E_AT_S;
  const id = `e2e-${startS}`;
  const k = Math.floor((startS - CI_OFFSET_S) / CI_CYCLE_S);
  return {
    id,
    number: day - Math.floor(EPOCH_S / DAY_S),
    script: scriptOf('e2e'),
    event: 'schedule',
    startMs: startS * 1000,
    fails: hash(day) % 3 !== 0,
    cancelAtMs: overlay.cancelled[id] ?? null,
    ...commitOf(k),
    actor: { kind: 'schedule' },
    inputs: {},
  };
}

function dispatchedPlan(run: DispatchedRun, overlay: RepoOverlay): RunPlan | null {
  const script = WORKFLOW_SCRIPTS.find((candidate) => candidate.workflow.id === run.workflow);
  if (script === undefined) return null;
  const k = Math.floor((run.atMs / 1000 - CI_OFFSET_S) / CI_CYCLE_S);
  return {
    id: run.id,
    number: k - Math.floor(EPOCH_S / CI_CYCLE_S) + 1,
    script,
    event: 'workflow_dispatch',
    startMs: run.atMs,
    fails: false,
    cancelAtMs: overlay.cancelled[run.id] ?? null,
    ...commitOf(k),
    actor: { kind: 'person', handle: run.by },
    inputs: run.inputs,
  };
}

function commitOf(k: number): {
  readonly sha: string;
  readonly title: string;
  readonly bean: string;
  readonly actor: RunActor;
} {
  const commit = FIXTURE_COMMITS[k % FIXTURE_COMMITS.length] ?? FIXTURE_COMMITS[0];
  const person = FIXTURE_PEOPLE[k % FIXTURE_PEOPLE.length] ?? 'coop';
  return {
    sha: shaOf(k),
    title: commit?.title ?? 'Update',
    bean: commit?.bean ?? 'update',
    actor:
      k % 4 === 3
        ? { kind: 'session', name: `session a${k % 9}` }
        : { kind: 'person', handle: person },
  };
}

function usageOf(overlay: RepoOverlay, nowMs: number): ActionsUsage {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  const dispatched = overlay.dispatched
    .filter((run) => new Date(run.atMs).toISOString().startsWith(month))
    .flatMap((run) => {
      const plan = dispatchedPlan(run, overlay);
      return plan === null ? [] : [runAt(plan, nowMs).billedMinutes];
    });
  return {
    month,
    minutesUsed: 64 + dispatched.reduce((sum, minutes) => sum + minutes, 0),
    minutesIncluded: 100,
    jobTimeoutMinutes: 60,
  };
}

function scriptOf(key: string): WorkflowScript {
  const script = WORKFLOW_SCRIPTS.find((candidate) => candidate.key === key);
  if (script === undefined) throw new Error(`fixture workflow ${key} is missing`);
  return script;
}

function ciFails(k: number): boolean {
  return hash(k) % 5 === 0;
}

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function shaOf(k: number): string {
  return [0, 1, 2, 3, 4]
    .map((i) =>
      hash(k * 7 + i)
        .toString(16)
        .padStart(8, '0'),
    )
    .join('');
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

function notFound(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'not_found', status: 404, message } };
}

function invalid(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'invalid_state', status: 409, message } };
}

function forbidden(): RpcResult<never> {
  return {
    ok: false,
    error: { code: 'forbidden', status: 403, message: 'Sign in as a maintainer.' },
  };
}
