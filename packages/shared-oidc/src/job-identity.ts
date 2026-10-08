/**
 * What the issuer knows about a job when its control plane mints the request token. It is frozen
 * into the request token, so a job can never ask for a token about a different run, ref or
 * repository than the one it was started for.
 *
 * A job is either a run of the stalk (`push`, `workflow_dispatch`, `schedule`) or a pre-land check
 * of a bean (GitHub's `pull_request` shape). Pre-land checks of beans pushed by anything but a
 * maintainer are untrusted (decision D4): they get no secrets, and no identity token unless the
 * control plane says otherwise, and then one whose `sub` can never match a stalk trust policy.
 */
import { z } from 'zod';

export const PUSHER_KINDS = ['maintainer', 'collaborator', 'agent', 'deploy_token'] as const;
export type PusherKind = (typeof PUSHER_KINDS)[number];

const Repository = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().min(1),
  visibility: z.enum(['public', 'private']),
});

const StalkRun = z.object({
  kind: z.literal('stalk'),
  event: z.enum(['push', 'workflow_dispatch', 'schedule']),
  /** `refs/heads/<name>`: the stalk under its base branch's name. */
  ref: z.string().startsWith('refs/'),
  sha: z.string().regex(/^[0-9a-f]{40,64}$/),
});

const PrelandRun = z.object({
  kind: z.literal('preland'),
  /** The bean's name, without `bean/`. */
  bean: z.string().min(1),
  /** Who pushed the bean; anything but `maintainer` makes the run untrusted. */
  pusher: z.enum(PUSHER_KINDS),
  /** The base branch's short name (the stalk under its public name). */
  baseRef: z.string().min(1),
  sha: z.string().regex(/^[0-9a-f]{40,64}$/),
});

export const IdTokenJob = z.object({
  jobId: z.string().min(1),
  runId: z.string().min(1),
  runNumber: z.number().int().nonnegative(),
  runAttempt: z.number().int().positive(),
  repository: Repository,
  /** Path of the workflow file, `.github/workflows/<name>.yml`. */
  workflowPath: z.string().min(1),
  workflowName: z.string().min(1),
  /** The ref the workflow file was read at, for `workflow_ref` (`refs/heads/...`). */
  workflowRef: z.string().startsWith('refs/'),
  actor: z.string().min(1),
  actorId: z.string().min(1),
  /** `environment:` of the job, when it names one the run may use. */
  environment: z.string().min(1).optional(),
  /** `permissions: id-token: write`. Without it no request token is minted. */
  idTokenWrite: z.boolean(),
  run: z.discriminatedUnion('kind', [StalkRun, PrelandRun]),
});
export type IdTokenJob = z.infer<typeof IdTokenJob>;

/** True when a trust policy should treat the run like a fork pull request on GitHub. */
export function isUntrustedPreland(job: IdTokenJob): boolean {
  return job.run.kind === 'preland' && job.run.pusher !== 'maintainer';
}
