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
} from '@beanstalk/shared-race/actions';
import { SecretName as SecretNameSchema, WorkflowPath } from '@beanstalk/shared-race/actions';

import type { NeedResult } from './job-graph';
import type { JobRow, RunRecord } from './run-store';
import { STALK_REF_NAME } from './triggers';

export function jobSpecOf(input: {
  readonly run: RunRecord;
  readonly job: JobRow;
  readonly ids: { readonly runId: ActionsRunId; readonly jobId: ActionsJobId };
  readonly needs: Readonly<Record<string, NeedResult>>;
  readonly secretNames: readonly string[];
  readonly tokens: { readonly job: string; readonly report: string };
  readonly publicUrl: string;
}): JobSpec {
  const { request } = input.run;
  const { repo } = request;
  const fullName = `${repo.ownerHandle}/${repo.name}`;
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
    event: request.event,
    eventPayload: request.eventPayload,
    context: {
      sha: request.sha,
      ref: `refs/heads/${STALK_REF_NAME}`,
      refName: STALK_REF_NAME,
      actor: request.actor,
      serverUrl: input.publicUrl,
      apiUrl: `${input.publicUrl}/api/v3`,
      runAttempt: 1,
    },
    checkout: {
      url: `${input.publicUrl}/${fullName}`,
      token: input.tokens.job,
      sha: request.sha,
    },
    needs: input.needs,
    inputs: request.inputs,
    env: { BEANSTALK_LINE: 'stalk', BEANSTALK_REPOSITORY_ID: repo.id, CI: 'true' },
    secretNames: input.secretNames.map((name): SecretName => SecretNameSchema.parse(name)),
    steps: input.job.steps,
    outputs: input.job.outputs,
    timeoutMinutes: input.job.timeoutMinutes,
    image: input.job.image ?? 'ubuntu-24.04',
    report: { token: input.tokens.report },
  };
}
