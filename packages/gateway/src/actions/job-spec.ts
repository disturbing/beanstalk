/**
 * The `JobSpec` the executor receives for one job (the shared contract): checkout with the job
 * token, the `github` context, the needed jobs' results, secret names (values come from the
 * sink), the timeout and the image.
 */
import type {
  ActionsJobId,
  ActionsRunId,
  JobSpec,
  SecretName,
} from '@gitstalk/shared-race/actions';
import {
  SecretName as SecretNameSchema,
  WorkflowPath,
  isAutomationPath,
  productVariable,
} from '@gitstalk/shared-race/actions';

import type { NeedResult } from './job-graph';
import type { JobRow, RunRecord } from './run-store';
import { withLegacyNames } from './automation-job';
import { STALK_REF_NAME } from './triggers';

export function jobSpecOf(input: {
  readonly run: RunRecord;
  readonly job: JobRow;
  readonly ids: { readonly runId: ActionsRunId; readonly jobId: ActionsJobId };
  readonly needs: Readonly<Record<string, NeedResult>>;
  readonly secretNames: readonly string[];
  /** `vars.*` for the job (org then repository variables, resolved when the run started). */
  readonly vars: Readonly<Record<string, string>>;
  readonly tokens: { readonly job: string; readonly report: string };
  readonly serverUrl: string;
  /** The model proxy's base URL (doc 25 §7.5), told to automation jobs. */
  readonly modelUrl: string;
  /** `ACTIONS_ID_TOKEN_REQUEST_URL` / `_TOKEN` for an `id-token: write` job (`oidc.ts`), else empty. */
  readonly oidcEnv: Readonly<Record<string, string>>;
}): JobSpec {
  const { request } = input.run;
  const { repo } = request;
  const fullName = `${repo.ownerHandle}/${repo.name}`;
  const isAutomation = isAutomationPath(request.workflow.path);
  return {
    jobId: input.ids.jobId,
    repo: { id: repo.id, owner: repo.ownerHandle, name: repo.name, fullName },
    runId: input.ids.runId,
    runNumber: request.number,
    workflowPath: WorkflowPath.parse(request.workflow.path),
    workflowName: input.run.workflowName,
    jobName: input.job.key,
    displayName: input.job.name,
    matrix: input.job.matrix,
    // An automation's job runs as a dispatch in act; its own event is GITSTALK_EVENT (§7.4).
    event: isAutomation ? 'workflow_dispatch' : request.event,
    eventPayload: request.eventPayload,
    context: {
      sha: request.sha,
      ref: `refs/heads/${STALK_REF_NAME}`,
      refName: STALK_REF_NAME,
      actor: request.actor,
      serverUrl: input.serverUrl,
      apiUrl: `${input.serverUrl}/api/v3`,
      runAttempt: 1,
    },
    checkout: {
      url: `${input.serverUrl}/${fullName}`,
      token: input.tokens.job,
      sha: request.sha,
    },
    needs: input.needs,
    inputs: request.inputs,
    env: {
      ...withLegacyNames({ LINE: 'stalk', REPOSITORY_ID: repo.id }),
      CI: 'true',
      ...npmDefaults(input.vars),
      ...(isAutomation
        ? {
            ...withLegacyNames({ EVENT: request.event }),
            GITSTALK_MODEL_URL: input.modelUrl,
          }
        : {}),
      ...input.oidcEnv,
    },
    secretNames: input.secretNames.map((name): SecretName => SecretNameSchema.parse(name)),
    vars: input.vars,
    steps: input.job.steps,
    outputs: input.job.outputs,
    timeoutMinutes: input.job.timeoutMinutes,
    image: input.job.image ?? 'ubuntu-24.04',
    report: { token: input.tokens.report },
    depsCache: { scope: STALK_REF_NAME, canSave: request.origin.kind === 'stalk' },
    ...(isAutomation ? { workflowSource: request.workflow.source } : {}),
  };
}

/**
 * npm settings every job gets unless the repository or org variable `GITSTALK_NPM_AUDIT` (or `BEANSTALK_NPM_AUDIT`) is
 * `on`: no audit and no funding message inside `npm ci` / `npm install`. The audit runs in the
 * install and checks every advisory against each vulnerable package's full version list on the
 * install's one thread; for fastify's lockfile on a standard-4 that was 93 s of a 97 s `npm ci`,
 * against 10 s without it (doc 27 §12). It changes no installed file and never fails the
 * install; `npm audit` as a step still runs it. A workflow's own `env:` wins over these.
 */
export function npmDefaults(vars: Readonly<Record<string, string>>): Record<string, string> {
  const audit = productVariable(vars, 'NPM_AUDIT')?.trim().toLowerCase();
  if (audit === 'on' || audit === 'true') return {};
  return { NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' };
}
