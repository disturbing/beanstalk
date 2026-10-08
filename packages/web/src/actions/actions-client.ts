/**
 * The web's one adapter onto Actions: `ActionsViewRpc` (the actions Worker's binding, or the
 * fixture fake on staging) scoped to one person and one repository, every answer validated.
 * A binding without the methods reads as "not running on this deployment".
 */
import { z } from 'zod';

import type { RpcResult } from '@beanstalk/shared-race/rpc';

import type { Outcome } from '../repositories/registry-client';
import type {
  ActionsActor,
  ActionsViewRpc,
  DispatchRequest,
  PutSecretInput,
  RunFilter,
} from './actions-contract';
import {
  LogPage,
  RunDetail,
  RunPage,
  SecretList,
  SecretSummary,
  Workflow,
} from './actions-contract';

/** Where the answers come from: the actions Worker, or fixtures (staging only, said on the page). */
export type ActionsMode = 'live' | 'fixtures';

export type ActionsClient = {
  readonly mode: ActionsMode;
  /** Whether pre-land access can change without sending the value again. */
  readonly canToggleSecretWithoutValue: boolean;
  workflows(): Promise<Outcome<readonly Workflow[]>>;
  runs(filter: RunFilter): Promise<Outcome<RunPage>>;
  run(runId: string): Promise<Outcome<RunDetail>>;
  log(runId: string, jobId: string, after: number): Promise<Outcome<LogPage>>;
  dispatch(request: DispatchRequest): Promise<Outcome<{ readonly runId: string }>>;
  cancel(runId: string): Promise<Outcome<{ readonly cancelled: boolean }>>;
  secrets(): Promise<Outcome<SecretList>>;
  putSecret(input: PutSecretInput): Promise<Outcome<SecretSummary>>;
  deleteSecret(name: string): Promise<Outcome<{ readonly deleted: boolean }>>;
};

export function actionsClient(
  rpc: ActionsViewRpc,
  scope: { readonly actor: ActionsActor; readonly repoId: string; readonly mode: ActionsMode },
): ActionsClient {
  const { actor, repoId } = scope;
  return {
    mode: scope.mode,
    canToggleSecretWithoutValue: true,
    workflows: () => call(z.array(Workflow), rpc.listWorkflows(actor, repoId)),
    runs: (filter) => call(RunPage, rpc.listRuns(actor, repoId, filter)),
    run: (runId) => call(RunDetail, rpc.getRun(actor, repoId, runId)),
    log: (runId, jobId, after) =>
      call(LogPage, rpc.logChunks(actor, repoId, { runId, jobId, after })),
    dispatch: (request) =>
      call(z.object({ runId: z.string() }), rpc.dispatchWorkflow(actor, repoId, request)),
    cancel: (runId) =>
      call(z.object({ cancelled: z.boolean() }), rpc.cancelRun(actor, repoId, runId)),
    secrets: () => call(SecretList, rpc.listSecrets(actor, repoId)),
    putSecret: (input) => call(SecretSummary, rpc.putSecret(actor, repoId, input)),
    deleteSecret: (name) =>
      call(z.object({ deleted: z.boolean() }), rpc.deleteSecret(actor, repoId, name)),
  };
}

async function call<S extends z.ZodType>(
  schema: S,
  pending: Promise<RpcResult<unknown>>,
): Promise<Outcome<z.infer<S>>> {
  const result = await pending;
  if (!result.ok)
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  const parsed = schema.safeParse(result.value);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: 'upstream_failed',
        message: 'Actions answered in a shape this page does not know.',
      },
    };
  return { ok: true, value: parsed.data };
}
