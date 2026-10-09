/**
 * `ActionsRpc` (the gateway's `Actions` entrypoint): every call is checked by `mayUseEngine`
 * through `accessResult` — `read` to see workflows, runs and logs, `actions` (maintain) to
 * dispatch, cancel and manage secrets — and then served from D1, the repository's
 * ActionsRepoDO, the run's ActionsRunDO or R2. Repositories the viewer may not see are
 * `not_found`, as everywhere.
 */
import type { ActionsRpc, RunSummary } from '@beanstalk/shared-race/actions';
import {
  ACTIONS_CONCLUSIONS,
  ACTIONS_EVENTS,
  ACTIONS_STATUSES,
  ActionsJobId,
  ActionsRunId,
  DispatchInputSchema,
  PutSecretInputSchema,
  RunFilterSchema,
  WorkflowPath,
} from '@beanstalk/shared-race/actions';
import type { RepositoryAction, RepositoryForViewer } from '@beanstalk/shared-race/collaborators';
import type { Viewer } from '@beanstalk/shared-race/repos';
import type { RpcError, RpcResult } from '@beanstalk/shared-race/rpc';
import { z } from 'zod';

import { readConfig, readSecrets } from '../config';
import { createLogger } from '../log';
import { accessResult, viewerPrincipal } from '../repos/access';
import { d1Collaborators } from '../repos/collaborators';
import { d1Registry } from '../repos/registry';
import { readActionsConfig, secretsKeyOf } from './actions-config';
import { readLogChunks } from './log-chunks';
import { SecretsNotConfiguredError, d1Secrets } from './secrets';
import { issueLogTicket } from './tickets';
import { namesStalk } from './triggers';
import { listIndexed } from './workflow-index';

const DEFAULT_PAGE = 25;

const RunRow = z.object({
  id: z.string(),
  repo_id: z.string(),
  number: z.number(),
  workflow_path: z.string(),
  workflow_name: z.string(),
  event: z.enum(ACTIONS_EVENTS),
  ref: z.string(),
  sha: z.string(),
  status: z.enum(ACTIONS_STATUSES),
  conclusion: z.enum(ACTIONS_CONCLUSIONS).nullable(),
  reason: z.string().nullable(),
  actor: z.string(),
  created_at: z.string(),
  created_ms: z.number(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  minutes_billed: z.number(),
});

export function actionsRpc(env: Env): ActionsRpc {
  const db = env.FORGE;
  const log = createLogger(readConfig(env).logLevel, { component: 'actions-rpc' });
  const config = readActionsConfig(env);
  const secrets = d1Secrets(db, secretsKeyOf(env));
  const access = async (viewer: Viewer, repoId: string, action: RepositoryAction) =>
    accessResult(
      d1Collaborators(db, () => Date.now(), env),
      await d1Registry(db).byId(repoId),
      {
        principal: viewerPrincipal(viewer),
        action,
        what: repoId,
      },
    );
  /** A run's row, once the viewer may do `action` with its repository. */
  const runFor = async (viewer: Viewer, runId: string, action: RepositoryAction) => {
    const id = ActionsRunId.safeParse(runId);
    const row = id.success ? await runRow(db, id.data) : null;
    if (row === null) return failed<RunSummary>(notFound(`run ${runId}`));
    const allowed = await access(viewer, row.repoId, action);
    return allowed.ok ? ok(row) : allowed;
  };
  const guarded = async <T>(work: () => Promise<RpcResult<T>>): Promise<RpcResult<T>> => {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof SecretsNotConfiguredError)
        return failed({ code: 'not_configured', status: 503, message: error.message });
      log.error('actions rpc failed', { error });
      return failed({ code: 'internal', status: 500, message: 'internal error' });
    }
  };

  return {
    listWorkflows: (viewer, repoId) =>
      guarded(async () => {
        const allowed = await access(viewer, repoId, 'read');
        return allowed.ok ? ok(await listIndexed(db, repoId)) : allowed;
      }),
    dispatchWorkflow: (viewer, repoId, input) =>
      guarded(async () => {
        const allowed = await access(viewer, repoId, 'actions');
        if (!allowed.ok) return allowed;
        const parsed = DispatchInputSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid dispatch');
        if (!namesStalk(parsed.data.ref, allowed.value.default_branch))
          return invalid(
            'workflows run on the stalk: ref must be stalk, main or the default branch',
          );
        return env.ACTIONS_REPOS.getByName(repoId).dispatch({
          repoId,
          workflowPath: parsed.data.workflowPath,
          inputs: parsed.data.inputs,
          actor: await handleOf(env, viewer),
        });
      }),
    listRuns: (viewer, repoId, filter) =>
      guarded(async () => {
        const allowed = await access(viewer, repoId, 'read');
        if (!allowed.ok) return allowed;
        const parsed = RunFilterSchema.safeParse(filter);
        if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid filter');
        return ok(await listRuns(db, repoId, parsed.data));
      }),
    getRun: (viewer, runId) =>
      guarded(async () => {
        const row = await runFor(viewer, runId, 'read');
        if (!row.ok) return row;
        const detail = await env.ACTIONS_RUNS.getByName(row.value.id).detail();
        return detail === null ? failed(notFound(`run ${runId}`)) : ok(detail);
      }),
    cancelRun: (viewer, runId) =>
      guarded(async () => {
        const row = await runFor(viewer, runId, 'actions');
        if (!row.ok) return row;
        const summary = await env.ACTIONS_RUNS.getByName(row.value.id).cancel();
        return summary === null ? failed(notFound(`run ${runId}`)) : ok(summary);
      }),
    logStream: (viewer, runId, jobId) =>
      guarded(async () => {
        const row = await runFor(viewer, runId, 'read');
        if (!row.ok) return row;
        const job = ActionsJobId.safeParse(jobId);
        const completed = job.success
          ? await env.ACTIONS_RUNS.getByName(row.value.id).jobCompleted(job.data)
          : null;
        if (!job.success || completed === null) return failed(notFound(`job ${jobId}`));
        const ticket = await issueLogTicket(
          readSecrets(env).tokenSecret,
          { run: row.value.id, job: job.data },
          Date.now(),
        );
        const url = `${config.publicUrl.replace(/^http/, 'ws')}/v1/actions/runs/${row.value.id}/jobs/${job.data}/logs`;
        return ok({ url, token: ticket.token, expiresAt: ticket.expiresAt });
      }),
    logChunks: (viewer, runId, jobId, after) =>
      guarded(async () => {
        const row = await runFor(viewer, runId, 'read');
        if (!row.ok) return row;
        const job = ActionsJobId.safeParse(jobId);
        const completed = job.success
          ? await env.ACTIONS_RUNS.getByName(row.value.id).jobCompleted(job.data)
          : null;
        const record = await d1Registry(db).byId(row.value.repoId);
        if (!job.success || completed === null || record === null)
          return failed(notFound(`job ${jobId}`));
        return ok(
          await readLogChunks(
            env.ACTIONS_LOGS,
            { ownerId: record.owner.id, repoId: record.id, runId: row.value.id, jobId: job.data },
            { after: Math.max(0, Math.floor(after ?? 0)), complete: completed },
          ),
        );
      }),
    listSecrets: (viewer, repoId) =>
      guarded(async () => {
        const allowed = await access(viewer, repoId, 'actions');
        return allowed.ok ? ok(await secrets.list(repoId)) : allowed;
      }),
    putSecret: (viewer, repoId, input) =>
      guarded(async () => {
        const allowed = await access(viewer, repoId, 'actions');
        if (!allowed.ok) return allowed;
        const parsed = PutSecretInputSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid secret');
        const actor = await handleOf(env, viewer);
        const saved = await secrets.put(repoId, parsed.data, {
          actor,
          at: new Date().toISOString(),
        });
        await audit(db, {
          repo: allowed.value,
          viewer,
          actor,
          action: 'actions-secret-set',
          detail: saved.name,
        });
        return ok(saved);
      }),
    deleteSecret: (viewer, repoId, name) =>
      guarded(async () => {
        const allowed = await access(viewer, repoId, 'actions');
        if (!allowed.ok) return allowed;
        const deleted = await secrets.delete(repoId, name);
        if (deleted)
          await audit(db, {
            repo: allowed.value,
            viewer,
            actor: await handleOf(env, viewer),
            action: 'actions-secret-deleted',
            detail: name.toUpperCase(),
          });
        return ok({ deleted });
      }),
  };
}

async function runRow(db: D1Database, runId: ActionsRunId): Promise<RunSummary | null> {
  const raw = await db.prepare('SELECT * FROM actions_runs WHERE id = ?').bind(runId).first();
  const row = RunRow.safeParse(raw);
  return row.success ? summaryOfRow(row.data) : null;
}

async function listRuns(
  db: D1Database,
  repoId: string,
  filter: z.infer<typeof RunFilterSchema>,
): Promise<{ runs: RunSummary[]; next: string | null }> {
  const limit = filter.limit ?? DEFAULT_PAGE;
  const clauses = ['repo_id = ?'];
  const bindings: (string | number)[] = [repoId];
  if (filter.workflowPath !== undefined) {
    clauses.push('workflow_path = ?');
    bindings.push(filter.workflowPath);
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?');
    bindings.push(filter.status);
  }
  const cursor = filter.cursor === undefined ? Number.NaN : Number(filter.cursor);
  if (Number.isFinite(cursor)) {
    clauses.push('created_ms < ?');
    bindings.push(cursor);
  }
  const { results } = await db
    .prepare(
      `SELECT * FROM actions_runs WHERE ${clauses.join(' AND ')} ORDER BY created_ms DESC, number DESC LIMIT ?`,
    )
    .bind(...bindings, limit + 1)
    .all();
  const rows = results.map((raw) => RunRow.parse(raw));
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    runs: page.map(summaryOfRow),
    next: rows.length > limit && last !== undefined ? String(last.created_ms) : null,
  };
}

function summaryOfRow(row: z.infer<typeof RunRow>): RunSummary {
  return {
    id: ActionsRunId.parse(row.id),
    repoId: row.repo_id,
    number: row.number,
    workflowPath: WorkflowPath.parse(row.workflow_path),
    workflowName: row.workflow_name,
    event: row.event,
    ref: row.ref,
    sha: row.sha,
    status: row.status,
    conclusion: row.conclusion,
    reason: row.reason,
    actor: row.actor,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    minutesBilled: row.minutes_billed,
  };
}

/** The signed-in person's handle (for `actor` and `updatedBy`). */
async function handleOf(env: Env, viewer: Viewer): Promise<string> {
  if (viewer === null) return 'anonymous';
  const row = await env.IDENTITY_DB.prepare('SELECT handle FROM users WHERE id = ?')
    .bind(viewer)
    .first<{ handle: string }>();
  return row?.handle ?? viewer;
}

async function audit(
  db: D1Database,
  entry: {
    readonly repo: RepositoryForViewer;
    readonly viewer: Viewer;
    readonly actor: string;
    readonly action: string;
    readonly detail: string;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO repository_audit (repo_id, at, actor_id, actor_handle, action, detail) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      entry.repo.id,
      new Date().toISOString(),
      entry.viewer ?? '',
      entry.actor,
      entry.action,
      entry.detail,
    )
    .run();
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

function failed<T>(error: RpcError): RpcResult<T> {
  return { ok: false, error };
}

function invalid<T>(message: string): RpcResult<T> {
  return failed({ code: 'invalid_request', status: 400, message });
}

function notFound(what: string): RpcError {
  return { code: 'not_found', status: 404, message: `${what} not found` };
}
