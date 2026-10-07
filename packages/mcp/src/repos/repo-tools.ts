/**
 * The repository tools of a person's agent session (`docs/claude-opus/22-mcp-repository-tools.md`).
 * Git stays the interface: an agent clones, commits and pushes `bean/<name>` with git. These
 * tools add what git cannot say or do: which repositories the person may use, a reserved bean
 * name with its intent, the verdict with the beans it collided with, a wait that is the twin
 * of `git push -o wait`, a backlog two agents cannot both claim from, and a short-lived git
 * credential for a machine whose git is not set up. Plain, task-shaped tools; no code mode.
 */
import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { MAX_BEAN_WAIT_SECONDS } from '@beanstalk/shared-race/agent-repos';

import { answer } from '../mcp/tool-result';
import type { ToolScope } from '../tools/tool-context';
import { gitCredentials } from './git-credentials';
import {
  beanStatus,
  beanWait,
  openBean,
  repoList,
  repoStatus,
  taskClaim,
  taskList,
  taskRelease,
} from './repo-answers';

export const REPO_TOOL_NAMES = [
  'repo_list',
  'repo_status',
  'bean_open',
  'bean_status',
  'bean_wait',
  'task_list',
  'task_claim',
  'task_release',
  'git_credentials',
] as const;

const READS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Reserving a name or claiming a task again renews it: repeatable, never destructive. */
const RESERVES: ToolAnnotations = { ...READS, readOnlyHint: false };

const Repo = z.string().trim().min(3).max(110).describe('owner/name (repo_list shows yours)');
const BeanName = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .describe('The bean name: its branch is bean/<name> (letters, digits, . _ -; up to 32)');
const TaskId = z.string().trim().min(1).max(64).describe('A task id from task_list');

/** Registers the tools for an agent session; run tokens get none of them. */
export function registerRepoTools(server: McpServer, scope: ToolScope): void {
  if (scope.session === undefined || scope.agents === undefined) return;
  registerRepositoryReads(server, scope);
  registerBeanTools(server, scope);
  registerBacklogTools(server, scope);
  registerCredentials(server, scope);
}

function registerRepositoryReads(server: McpServer, scope: ToolScope): void {
  server.registerTool(
    'repo_list',
    {
      title: 'Your repositories',
      description:
        "The repositories you own on Beanstalk, with your access (write: you may push beans) and clone URL. Others' public repositories are named directly as owner/name.",
      inputSchema: z.object({}),
      annotations: READS,
    },
    async () => answer(() => repoList(scope)),
  );
  server.registerTool(
    'repo_status',
    {
      title: 'Status of a repository',
      description:
        'A repository at a glance: the stalk and sprout heads, the window of landings not yet validated, beans in flight (who, phase), beans sent back red or in conflict, recent red validations and open decision cards.',
      inputSchema: z.object({ repo: Repo }),
      annotations: READS,
    },
    async ({ repo }) => answer(() => repoStatus(scope, repo)),
  );
}

function registerBeanTools(server: McpServer, scope: ToolScope): void {
  server.registerTool(
    'bean_open',
    {
      title: 'Open a bean',
      description:
        "Before starting a change: reserve a bean name with its intent (one sentence on why), optionally for a backlog task (claims it). Returns the branch, the git commands to start from the sprout and to push, and the sprout's head. The reserved intent becomes the bean's intent when you push. Needs the write scope.",
      inputSchema: z.object({
        repo: Repo,
        bean: BeanName,
        intent: z.string().trim().min(1).max(4000).describe('What this change is for, and why'),
        task: TaskId.optional(),
      }),
      annotations: RESERVES,
    },
    async (input) => answer(() => openBean(scope, input)),
  );
  server.registerTool(
    'bean_status',
    {
      title: 'Verdict of a bean',
      description:
        'Where a bean stands after a push: checking, landed (on the sprout), green (on the stalk), red, conflict, parked or dropped; with the failing tests, the landed beans it collided with (their intent and what they changed), the lines the pushes printed, and the next step.',
      inputSchema: z.object({ repo: Repo, bean: BeanName }),
      annotations: READS,
    },
    async (input) => answer(() => beanStatus(scope, input)),
  );
  server.registerTool(
    'bean_wait',
    {
      title: 'Wait for a bean',
      description: `After a git push without -o wait: blocks until the bean's current check finishes (until: verdict, default) or it reaches the stalk (until: stalk), or timeout_s passes (default 300, at most ${MAX_BEAN_WAIT_SECONDS}). Answers as bean_status, with waited_s and timed_out.`,
      inputSchema: z.object({
        repo: Repo,
        bean: BeanName,
        until: z.enum(['verdict', 'stalk']).optional(),
        timeout_s: z.number().int().min(1).max(MAX_BEAN_WAIT_SECONDS).optional(),
      }),
      annotations: READS,
    },
    async (input) => answer(() => beanWait(scope, input)),
  );
}

function registerBacklogTools(server: McpServer, scope: ToolScope): void {
  server.registerTool(
    'task_list',
    {
      title: 'Backlog of a repository',
      description:
        "The repository's backlog (.beanstalk/backlog.md or BACKLOG.md on the sprout): each task's id, title, detail and state: open, claimed (by whom, until when), in_progress (whose bean) or done.",
      inputSchema: z.object({ repo: Repo }),
      annotations: READS,
    },
    async ({ repo }) => answer(() => taskList(scope, repo)),
  );
  server.registerTool(
    'task_claim',
    {
      title: 'Claim a task',
      description:
        'Before working on a backlog task: claim it so no other agent takes it (two hours; claim again or bean_open with task to keep it; a pushed bean for the task holds it until it lands). Refused, with who holds it, when it is taken. Needs the write scope and the write role.',
      inputSchema: z.object({ repo: Repo, task: TaskId }),
      annotations: RESERVES,
    },
    async ({ repo, task }) => answer(() => taskClaim(scope, { repo, task })),
  );
  server.registerTool(
    'task_release',
    {
      title: 'Give a task back',
      description:
        'When you will not do a task you claimed (it turned out done, or you are stopping): drops your claim and the bean names you reserved for it, so another agent can take it. A bean you pushed for it still holds it. Needs the write scope and the write role.',
      inputSchema: z.object({ repo: Repo, task: TaskId }),
      annotations: RESERVES,
    },
    async ({ repo, task }) => answer(() => taskRelease(scope, { repo, task })),
  );
}

function registerCredentials(server: McpServer, scope: ToolScope): void {
  server.registerTool(
    'git_credentials',
    {
      title: 'Git credential for a repository',
      description:
        'Only when git on this machine is not connected to Beanstalk (a push or clone fails with Authentication failed): a short-lived HTTPS credential for one repository (at most an hour; read, plus push beans with the write scope), as git credential approve input. Pipe it to git; never print it, write it to a file, put it in a URL or commit it.',
      inputSchema: z.object({
        repo: Repo,
        ttl_minutes: z.number().int().min(5).max(60).optional(),
      }),
      annotations: { ...READS, readOnlyHint: false, idempotentHint: false },
    },
    async (input) => answer(() => gitCredentials(scope, input)),
  );
}
