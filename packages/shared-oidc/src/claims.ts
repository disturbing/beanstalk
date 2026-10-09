/**
 * The claims of a Beanstalk identity token, mirroring GitHub's
 * (https://docs.github.com/en/actions/reference/security/oidc) plus three of ours that let a
 * cloud trust policy tell stalk runs from pre-land checks: `trust`, `pusher` and `bean`.
 *
 * `sub` by run kind:
 *  - stalk run:                  `repo:<owner>/<repo>:ref:refs/heads/<branch>`
 *  - run with an environment:    `repo:<owner>/<repo>:environment:<env>`
 *  - pre-land, maintainer's bean: `repo:<owner>/<repo>:pull_request`
 *  - pre-land, any other pusher:  `repo:<owner>/<repo>:preland-untrusted:<pusher>`; it matches neither
 *    `...:ref:*`, `...:environment:*` nor `...:pull_request`, so a policy written for the stalk
 *    cannot be satisfied by it, and an environment never applies to it.
 */
import type { IdTokenJob } from './job-identity';
import { isUntrustedPreland } from './job-identity';

/** GitHub caps token life at minutes; ours is never longer than 10. */
export const MAX_TOKEN_TTL_SECONDS = 600;
export const DEFAULT_TOKEN_TTL_SECONDS = 300;

export type Trust = 'stalk' | 'preland' | 'preland_untrusted';

export type IdTokenClaims = {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly repository: string;
  readonly repository_id: string;
  readonly repository_owner: string;
  readonly repository_owner_id: string;
  readonly repository_visibility: 'public' | 'private' | 'internal';
  readonly ref: string;
  readonly ref_type: 'branch';
  readonly sha: string;
  readonly head_ref: string;
  readonly base_ref: string;
  readonly workflow: string;
  readonly workflow_ref: string;
  readonly workflow_sha: string;
  readonly job_workflow_ref: string;
  readonly job_workflow_sha: string;
  readonly run_id: string;
  readonly run_number: string;
  readonly run_attempt: string;
  readonly actor: string;
  readonly actor_id: string;
  readonly event_name: string;
  readonly environment?: string;
  readonly runner_environment: 'beanstalk-hosted';
  readonly trust: Trust;
  readonly pusher?: string;
  readonly bean?: string;
  readonly exp: number;
  readonly iat: number;
  readonly nbf: number;
  readonly jti: string;
};

export type ClaimsInput = {
  readonly job: IdTokenJob;
  readonly issuer: string;
  readonly audience: string;
  readonly nowSeconds: number;
  readonly ttlSeconds: number;
};

export function buildClaims(input: ClaimsInput): IdTokenClaims {
  const { job, issuer, audience, nowSeconds } = input;
  const { repository, run } = job;
  const fullName = `${repository.owner}/${repository.name}`;
  const ref = run.kind === 'stalk' ? run.ref : `refs/heads/bean/${run.bean}`;
  const workflowRef = `${fullName}/${job.workflowPath}@${job.workflowRef}`;
  const ttl = Math.min(Math.max(1, input.ttlSeconds), MAX_TOKEN_TTL_SECONDS);
  const environment = isUntrustedPreland(job) ? undefined : job.environment;
  return {
    iss: issuer,
    aud: audience,
    sub: subjectOf(job, fullName),
    repository: fullName,
    repository_id: repository.id,
    repository_owner: repository.owner,
    repository_owner_id: repository.ownerId,
    repository_visibility: repository.visibility,
    ref,
    ref_type: 'branch',
    sha: run.sha,
    head_ref: run.kind === 'preland' ? `bean/${run.bean}` : '',
    base_ref: run.kind === 'preland' ? run.baseRef : '',
    workflow: job.workflowName,
    workflow_ref: workflowRef,
    workflow_sha: run.sha,
    job_workflow_ref: workflowRef,
    job_workflow_sha: run.sha,
    run_id: job.runId,
    run_number: String(job.runNumber),
    run_attempt: String(job.runAttempt),
    actor: job.actor,
    actor_id: job.actorId,
    event_name: run.kind === 'stalk' ? run.event : 'pull_request',
    ...(environment === undefined ? {} : { environment }),
    runner_environment: 'beanstalk-hosted',
    trust: trustOf(job),
    ...(run.kind === 'preland' ? { pusher: run.pusher, bean: run.bean } : {}),
    iat: nowSeconds,
    nbf: nowSeconds,
    exp: nowSeconds + ttl,
    jti: crypto.randomUUID(),
  };
}

function subjectOf(job: IdTokenJob, fullName: string): string {
  const { run } = job;
  if (run.kind === 'preland') {
    if (run.pusher !== 'maintainer') return `repo:${fullName}:preland-untrusted:${run.pusher}`;
    return job.environment === undefined
      ? `repo:${fullName}:pull_request`
      : `repo:${fullName}:environment:${job.environment}`;
  }
  return job.environment === undefined
    ? `repo:${fullName}:ref:${run.ref}`
    : `repo:${fullName}:environment:${job.environment}`;
}

function trustOf(job: IdTokenJob): Trust {
  if (job.run.kind === 'stalk') return 'stalk';
  return isUntrustedPreland(job) ? 'preland_untrusted' : 'preland';
}
