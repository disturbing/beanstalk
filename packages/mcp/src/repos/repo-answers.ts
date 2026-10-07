/**
 * What the repository tools answer: the gateway's repository RPC, plus the git commands and
 * next steps an agent acts on. Each answer leads with a one-line `summary`.
 */
import { z } from 'zod';

import type { AgentPrincipal, AgentReposRpc } from '@beanstalk/shared-race/agent-repos';
import type { PushedBeanStatus } from '@beanstalk/shared-race/rpc';

import { ToolError } from '../mcp/tool-result';
import { runStatus } from '../tools/run-status';
import type { ToolScope } from '../tools/tool-context';
import { RepositoryAnswer, parsed, valueOf } from './agent-gateway';

const DEFAULT_WAIT_SECONDS = 300;
const SENT_BACK: ReadonlySet<string> = new Set(['red', 'conflict']);
const IN_FLIGHT: ReadonlySet<string> = new Set(['checking', 'waiting']);

/** The session's person and the gateway's repository RPC; only sessions have the tools. */
export function sessionOf(scope: ToolScope): {
  readonly agents: AgentReposRpc;
  readonly principal: AgentPrincipal;
} {
  if (scope.session === undefined || scope.agents === undefined)
    throw new ToolError('repository tools need a signed-in agent session');
  return { agents: scope.agents, principal: scope.session.principal };
}

export async function repoList(scope: ToolScope): Promise<object> {
  const { agents, principal } = sessionOf(scope);
  const repositories = z
    .array(RepositoryAnswer.loose())
    .parse(valueOf(await agents.agentRepositories(principal)));
  return {
    repositories: repositories.map((repository) => ({
      ...repository,
      clone_url: cloneUrl(scope, repository.git_path),
    })),
    summary:
      repositories.length === 0
        ? 'You own no repositories yet; create one on the web, or name a public one as owner/name.'
        : `${repositories.length} repositories: ${repositories.map((repository) => repository.repo).join(', ')}`,
  };
}

export async function repoStatus(scope: ToolScope, repo: string): Promise<object> {
  const { agents, principal } = sessionOf(scope);
  const ctx = await scope.context(repo);
  const [lines, pushed] = await Promise.all([
    runStatus(ctx),
    agents.agentPushedBeans(principal, repo),
  ]);
  const beans = valueOf(pushed);
  const inFlight = beans.filter((bean) => IN_FLIGHT.has(bean.phase)).map(beanLine);
  const sentBack = beans.filter((bean) => SENT_BACK.has(bean.phase)).map(beanLine);
  return {
    repo,
    stalk: lines.stalk.sha,
    sprout: lines.sprout.sha,
    window: lines.window,
    in_flight: inFlight,
    sent_back: sentBack,
    recent_reds: lines.red_validations.recent,
    open_cards: lines.open_cards,
    landed: beans.filter((bean) => bean.phase === 'landed' || bean.phase === 'green').length,
    preview_url: lines.preview_url,
    summary: [
      `${inFlight.length} in flight`,
      `${sentBack.length} sent back`,
      `window ${lines.window.unvalidated}${lines.window.size === null ? '' : `/${lines.window.size}`}`,
      `${lines.red_validations.count} red validations`,
      `${lines.open_cards.length} open cards`,
    ].join(', '),
  };
}

export async function openBean(
  scope: ToolScope,
  input: {
    readonly repo: string;
    readonly bean: string;
    readonly intent: string;
    readonly task?: string | undefined;
  },
): Promise<object> {
  const { agents, principal } = sessionOf(scope);
  const { repo, bean, intent, task } = input;
  const repository = parsed(await agents.agentRepository(principal, repo), RepositoryAnswer);
  const opened = valueOf(
    await agents.agentOpenBean(principal, repo, {
      bean,
      intent,
      ...(task === undefined ? {} : { task }),
    }),
  );
  const branch = opened.branch;
  return {
    ...opened,
    clone_url: cloneUrl(scope, repository.git_path),
    start: `git fetch origin sprout && git switch -c ${branch} origin/sprout`,
    push: `git push -o wait origin HEAD:refs/heads/${branch}`,
    summary: `Reserved ${branch} until ${opened.expires_at}${opened.task === null ? '' : ` for task ${opened.task}`}. Start from the sprout, commit, then push; the reserved intent is the bean's.`,
  };
}

export async function beanStatus(
  scope: ToolScope,
  input: { readonly repo: string; readonly bean: string },
): Promise<object> {
  const { agents, principal } = sessionOf(scope);
  const bean = valueOf(await agents.agentBean(principal, input.repo, input.bean));
  return withNext(bean, input.bean);
}

export async function beanWait(
  scope: ToolScope,
  input: {
    readonly repo: string;
    readonly bean: string;
    readonly until?: 'verdict' | 'stalk' | undefined;
    readonly timeout_s?: number | undefined;
  },
): Promise<object> {
  const { agents, principal } = sessionOf(scope);
  const waited = valueOf(
    await agents.agentWaitBean(principal, input.repo, input.bean, {
      until: input.until ?? 'verdict',
      seconds: input.timeout_s ?? DEFAULT_WAIT_SECONDS,
    }),
  );
  return withNext(waited, input.bean);
}

export async function taskList(scope: ToolScope, repo: string): Promise<object> {
  const { agents, principal } = sessionOf(scope);
  const backlog = valueOf(await agents.agentBacklog(principal, repo));
  const open = backlog.tasks.filter((task) => task.state === 'open').length;
  return {
    ...backlog,
    summary:
      backlog.file === null
        ? `${repo} has no backlog (.beanstalk/backlog.md or BACKLOG.md); land one as a bean to start one`
        : `${backlog.tasks.length} tasks in ${backlog.file}, ${open} open`,
  };
}

export async function taskClaim(
  scope: ToolScope,
  input: { readonly repo: string; readonly task: string },
): Promise<object> {
  const { agents, principal } = sessionOf(scope);
  const claimed = valueOf(await agents.agentClaimTask(principal, input.repo, input.task));
  return {
    ...claimed,
    summary: `Task ${claimed.task.id} is yours until ${claimed.task.until ?? 'its bean lands'}. Next: bean_open with task ${claimed.task.id}.`,
  };
}

/** The clone URL of a repository on the gateway. */
export function cloneUrl(scope: ToolScope, gitPath: string): string {
  return new URL(gitPath, scope.gitOrigin).toString();
}

function beanLine(bean: PushedBeanStatus) {
  return {
    bean: bean.bean,
    title: bean.title,
    actor: bean.actor,
    phase: bean.phase,
    reason: bean.reason,
    task: bean.task,
  };
}

/** The answer with the one next step its phase calls for. */
function withNext<T extends { readonly phase: string }>(
  bean: T,
  name: string,
): T & { next: string } {
  return { ...bean, next: nextStep(bean.phase, name) };
}

function nextStep(phase: string, bean: string): string {
  const branch = `bean/${bean.replace(/^beans?\//, '')}`;
  switch (phase) {
    case 'open':
      return `commit on ${branch}, then git push -o wait origin HEAD:refs/heads/${branch}`;
    case 'checking':
    case 'waiting':
      return 'the pre-land check is running: bean_wait, or git push -o wait next time';
    case 'landed':
      return 'landed on the sprout; it reaches the stalk when the sprout validates (bean_wait until: stalk)';
    case 'green':
      return 'done: on the stalk';
    case 'red':
      return `git fetch origin sprout && git rebase origin/sprout; fix the code so the failing tests pass, keeping the collided beans' intent; git push -f -o wait origin HEAD:refs/heads/${branch}`;
    case 'conflict':
      return `git fetch origin sprout && git rebase origin/sprout; resolve keeping both intents; git push -f -o wait origin HEAD:refs/heads/${branch}`;
    case 'parked':
      return 'a person decides (decision card); wait, do not work around it';
    case 'dropped':
      return 'dropped: read the reason; start a new bean if the change is still needed';
    default:
      return 'read the reason';
  }
}
