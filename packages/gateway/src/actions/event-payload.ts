/**
 * Event payloads in GitHub's shape (a subset), so `${{ github.event.* }}` and actions that
 * read `GITHUB_EVENT_PATH` see what they expect (doc 25 §2). The stalk is `refs/heads/main`.
 */
import { STALK_REF_NAME } from './triggers';

/** The repository as a run sees it. */
export type RepoFacts = {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerHandle: string;
  readonly name: string;
  readonly engineId: string;
  readonly defaultBranch: string;
  readonly visibility: 'public' | 'private';
};

export const STALK_REF = `refs/heads/${STALK_REF_NAME}`;
const ZERO_SHA = '0'.repeat(40);

/** `github.event.repository` and `sender`, shared by every event. */
export function repositoryPayload(repo: RepoFacts, publicUrl: string): Record<string, unknown> {
  const fullName = `${repo.ownerHandle}/${repo.name}`;
  return {
    id: repo.id,
    name: repo.name,
    full_name: fullName,
    private: repo.visibility === 'private',
    owner: { login: repo.ownerHandle, id: repo.ownerId },
    default_branch: STALK_REF_NAME,
    html_url: `${publicUrl}/${fullName}`,
    clone_url: `${publicUrl}/${fullName}.git`,
  };
}

/** `push`: the stalk moved from `before` to `after`. */
export function pushPayload(input: {
  readonly repo: RepoFacts;
  readonly publicUrl: string;
  readonly before: string | null;
  readonly after: string;
  readonly actor: string;
  readonly beans: readonly string[];
}): Record<string, unknown> {
  return {
    ref: STALK_REF,
    before: input.before ?? ZERO_SHA,
    after: input.after,
    created: input.before === null,
    deleted: false,
    forced: false,
    base_ref: null,
    compare: `${input.publicUrl}/${input.repo.ownerHandle}/${input.repo.name}/compare/${input.before ?? ''}...${input.after}`,
    head_commit: {
      id: input.after,
      message: input.beans.length > 0 ? `Beans: ${input.beans.join(', ')}` : '',
    },
    commits: [],
    pusher: { name: input.actor },
    repository: repositoryPayload(input.repo, input.publicUrl),
    sender: { login: input.actor },
  };
}

/** `workflow_dispatch`: a person ran the workflow with these inputs. */
export function dispatchPayload(input: {
  readonly repo: RepoFacts;
  readonly publicUrl: string;
  readonly workflowPath: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly actor: string;
}): Record<string, unknown> {
  return {
    ref: STALK_REF,
    workflow: input.workflowPath,
    inputs: input.inputs,
    repository: repositoryPayload(input.repo, input.publicUrl),
    sender: { login: input.actor },
  };
}

/** `schedule`: the cron line that fired. */
export function schedulePayload(input: {
  readonly repo: RepoFacts;
  readonly publicUrl: string;
  readonly cron: string;
}): Record<string, unknown> {
  return { schedule: input.cron, repository: repositoryPayload(input.repo, input.publicUrl) };
}
