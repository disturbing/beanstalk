/**
 * The gateway's three Actions entrypoints (named exports of the Worker, reached through
 * service bindings with `entrypoint`):
 *
 * - `Actions`: `ActionsRpc` and `ActionsEntriesRpc` (org secrets, variables) for the web app
 *   and MCP (access by `mayUseEngine`, and org roles for org entries);
 * - `ActionsJobs`: `ActionsJobSink` for the executor, authenticated by each job's report token,
 *   and `RepositoryDirectory` for the executor's daily dependency-cache sweep;
 * - `StubActionsExecutor`: the echo executor (`ACTIONS_EXECUTOR_MODE = "stub"`), which reports
 *   through `ActionsJobs` exactly as the container executor will.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';

import type {
  ActionsExecutor,
  ActionsJobId,
  ActionsJobSink,
  ActionsRpc,
  DispatchInput,
  JobHandle,
  JobLogBatch,
  JobResult,
  JobSpec,
  LogChunkPage,
  LogStreamTicket,
  PutSecretInput,
  RepositoryDirectory,
  RepositoryForgotten,
  RunDetail,
  RunFilter,
  RunPage,
  RunSummary,
  SecretSummary,
  WorkflowSummary,
} from '@gitstalk/shared-race/actions';
import { JobLogBatchSchema, JobResultSchema } from '@gitstalk/shared-race/actions';
import type {
  ActionsEntriesRpc,
  OrgActionsSettings,
  OrgSecretSummary,
  OrgVariableSummary,
  PutOrgSecretInput,
  PutOrgVariableInput,
  PutVariableInput,
  RepoActionsEntries,
  VariableSummary,
} from '@gitstalk/shared-race/actions-secrets';
import type { Viewer } from '@gitstalk/shared-race/repos';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { readConfig } from '../config';
import { createLogger } from '../log';
import { actionsRpc } from './actions-rpc';
import { actionsEntriesRpc } from './entries-rpc';
import { echoJob, stubHangs } from './stub-echo';
import { parseReportToken } from './tickets';

export class Actions extends WorkerEntrypoint<Env> implements ActionsRpc, ActionsEntriesRpc {
  listWorkflows(viewer: Viewer, repoId: string): Promise<RpcResult<readonly WorkflowSummary[]>> {
    return this.#rpc().listWorkflows(viewer, repoId);
  }

  dispatchWorkflow(
    viewer: Viewer,
    repoId: string,
    input: DispatchInput,
  ): Promise<RpcResult<RunSummary>> {
    return this.#rpc().dispatchWorkflow(viewer, repoId, input);
  }

  listRuns(viewer: Viewer, repoId: string, filter: RunFilter): Promise<RpcResult<RunPage>> {
    return this.#rpc().listRuns(viewer, repoId, filter);
  }

  getRun(viewer: Viewer, runId: string): Promise<RpcResult<RunDetail>> {
    return this.#rpc().getRun(viewer, runId);
  }

  cancelRun(viewer: Viewer, runId: string): Promise<RpcResult<RunSummary>> {
    return this.#rpc().cancelRun(viewer, runId);
  }

  logStream(viewer: Viewer, runId: string, jobId: string): Promise<RpcResult<LogStreamTicket>> {
    return this.#rpc().logStream(viewer, runId, jobId);
  }

  logChunks(
    viewer: Viewer,
    runId: string,
    jobId: string,
    after?: number,
  ): Promise<RpcResult<LogChunkPage>> {
    return this.#rpc().logChunks(viewer, runId, jobId, after);
  }

  listSecrets(viewer: Viewer, repoId: string): Promise<RpcResult<readonly SecretSummary[]>> {
    return this.#rpc().listSecrets(viewer, repoId);
  }

  putSecret(
    viewer: Viewer,
    repoId: string,
    input: PutSecretInput,
  ): Promise<RpcResult<SecretSummary>> {
    return this.#rpc().putSecret(viewer, repoId, input);
  }

  deleteSecret(
    viewer: Viewer,
    repoId: string,
    name: string,
  ): Promise<RpcResult<{ readonly deleted: boolean }>> {
    return this.#rpc().deleteSecret(viewer, repoId, name);
  }

  // Secrets and variables beyond the repository's own secrets (actions-secrets contract).

  repoActionsEntries(viewer: Viewer, repoId: string): Promise<RpcResult<RepoActionsEntries>> {
    return this.#entries().repoActionsEntries(viewer, repoId);
  }

  putVariable(
    viewer: Viewer,
    repoId: string,
    input: PutVariableInput,
  ): Promise<RpcResult<VariableSummary>> {
    return this.#entries().putVariable(viewer, repoId, input);
  }

  deleteVariable(
    viewer: Viewer,
    repoId: string,
    name: string,
  ): Promise<RpcResult<{ readonly deleted: boolean }>> {
    return this.#entries().deleteVariable(viewer, repoId, name);
  }

  orgActionsSettings(viewer: Viewer, orgHandle: string): Promise<RpcResult<OrgActionsSettings>> {
    return this.#entries().orgActionsSettings(viewer, orgHandle);
  }

  putOrgSecret(
    viewer: Viewer,
    orgHandle: string,
    input: PutOrgSecretInput,
  ): Promise<RpcResult<OrgSecretSummary>> {
    return this.#entries().putOrgSecret(viewer, orgHandle, input);
  }

  deleteOrgSecret(
    viewer: Viewer,
    orgHandle: string,
    name: string,
  ): Promise<RpcResult<{ readonly deleted: boolean }>> {
    return this.#entries().deleteOrgSecret(viewer, orgHandle, name);
  }

  putOrgVariable(
    viewer: Viewer,
    orgHandle: string,
    input: PutOrgVariableInput,
  ): Promise<RpcResult<OrgVariableSummary>> {
    return this.#entries().putOrgVariable(viewer, orgHandle, input);
  }

  deleteOrgVariable(
    viewer: Viewer,
    orgHandle: string,
    name: string,
  ): Promise<RpcResult<{ readonly deleted: boolean }>> {
    return this.#entries().deleteOrgVariable(viewer, orgHandle, name);
  }

  #rpc(): ActionsRpc {
    return actionsRpc(this.env);
  }

  #entries(): ActionsEntriesRpc {
    return actionsEntriesRpc(this.env);
  }
}

export class ActionsJobs
  extends WorkerEntrypoint<Env>
  implements ActionsJobSink, RepositoryDirectory
{
  /**
   * Whether the registry has the repository, in any state. Only the executor binds this
   * entrypoint; it reveals no more than that a random id is in use.
   */
  async repositoryExists(repoId: string): Promise<RpcResult<{ readonly exists: boolean }>> {
    if (typeof repoId !== 'string' || repoId === '') return invalid('not a repository id');
    const row = await this.env.FORGE.prepare('SELECT 1 FROM repositories WHERE id = ?')
      .bind(repoId)
      .first();
    return { ok: true, value: { exists: row !== null } };
  }

  async actionsJobSecrets(
    reportToken: string,
  ): Promise<RpcResult<Readonly<Record<string, string>>>> {
    const token = parseReportToken(reportToken);
    if (token === null) return unauthorized();
    return this.env.ACTIONS_RUNS.getByName(token.run).jobSecrets(token.job, token.secret);
  }

  async actionsJobLogs(
    reportToken: string,
    batch: JobLogBatch,
  ): Promise<RpcResult<{ readonly cancelRequested: boolean }>> {
    const token = parseReportToken(reportToken);
    if (token === null) return unauthorized();
    const parsed = JobLogBatchSchema.safeParse(batch);
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid log batch');
    return this.env.ACTIONS_RUNS.getByName(token.run).jobLogs(token.job, token.secret, parsed.data);
  }

  async actionsJobFinished(
    reportToken: string,
    result: JobResult,
  ): Promise<RpcResult<{ readonly accepted: true }>> {
    const token = parseReportToken(reportToken);
    if (token === null) return unauthorized();
    const parsed = JobResultSchema.safeParse(result);
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid job result');
    return this.env.ACTIONS_RUNS.getByName(token.run).jobFinished(
      token.job,
      token.secret,
      parsed.data,
    );
  }
}

export class StubActionsExecutor extends WorkerEntrypoint<Env> implements ActionsExecutor {
  async startJob(spec: JobSpec): Promise<RpcResult<JobHandle>> {
    if (!stubHangs(spec)) this.ctx.waitUntil(this.#echo(spec, Date.now()));
    return {
      ok: true,
      value: {
        jobId: spec.jobId,
        executorRef: `stub-${spec.jobId}`,
        acceptedAt: new Date().toISOString(),
      },
    };
  }

  async cancelJob(
    _jobId: ActionsJobId,
    _reason: 'cancelled' | 'timed_out',
  ): Promise<RpcResult<{ readonly stopping: boolean }>> {
    return { ok: true, value: { stopping: true } };
  }

  async forgetRepository(_repoId: string): Promise<RpcResult<RepositoryForgotten>> {
    return { ok: true, value: { purged: true, objectsDeleted: 0 } };
  }

  async #echo(spec: JobSpec, startedMs: number): Promise<void> {
    const sink = this.ctx.exports.ActionsJobs;
    const log = createLogger(readConfig(this.env).logLevel, { component: 'actions-stub' });
    try {
      const secrets = await sink.actionsJobSecrets(spec.report.token);
      const echoed = echoJob(spec, secrets.ok ? secrets.value : {}, {
        startedMs,
        nowIso: new Date().toISOString(),
      });
      await sink.actionsJobLogs(spec.report.token, echoed.batch);
      await sink.actionsJobFinished(spec.report.token, echoed.result);
    } catch (error: unknown) {
      log.error('stub job failed to report', { jobId: spec.jobId, error });
    }
  }
}

function unauthorized<T>(): RpcResult<T> {
  return { ok: false, error: { code: 'unauthorized', status: 401, message: 'not a report token' } };
}

function invalid<T>(message: string): RpcResult<T> {
  return { ok: false, error: { code: 'invalid_request', status: 400, message } };
}
