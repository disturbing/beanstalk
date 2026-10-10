import type { NextResponse, Workspace } from '@gitstalk/shared-race/driver';

import type { EngineReply, EngineWorkspace } from '../engine/model';
import type { RunRepos } from './run-jobs';

type ReplyContext = { readonly repos: RunRepos; readonly gitBase: string };

/**
 * The engine's reply as the driver receives it: workspace fields in the wire's snake case,
 * with gateway git URLs (`<origin>/git/<namespace>/<repo>.git`), never Artifacts URLs. A
 * bean is a branch of the run repo, so `bean_url` and `repo_url` name the same repo.
 */
export function toDriverReply(reply: EngineReply, context: ReplyContext): NextResponse {
  if (!('invocation' in reply)) return reply;
  const { workspace, ...invocation } = reply.invocation;
  return { invocation: { ...invocation, workspace: toWorkspace(workspace, context) } };
}

function toWorkspace(workspace: EngineWorkspace, context: ReplyContext): Workspace {
  const repoUrl = `${context.gitBase}/${context.repos.repo.name}.git`;
  return {
    bean: workspace.branch,
    bean_url: repoUrl,
    repo_url: repoUrl,
    branch: workspace.branch,
    base_sha: workspace.baseSha,
    head_sha: workspace.headSha,
    merge: workspace.merge,
    acceptance: workspace.acceptance,
    protect: workspace.protect,
    union_paths: workspace.unionPaths,
    commit_message: workspace.commitMessage,
  };
}
