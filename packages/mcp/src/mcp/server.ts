/**
 * Run reads plus optional contributor collaboration. Capabilities follow the caller's token.
 * A fresh server per request (the stateless handler's contract). No code mode and no
 * `execute` tool: the owner deferred code mode as highly experimental.
 */
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { LineRef } from '@beanstalk/shared-ask/ask/view-spec';
import { ForgeError } from '@beanstalk/shared-ask/forge/forge-errors';

import { askRepo } from '../tools/ask-repo';
import { changeStatus } from '../tools/change-status';
import { checksGet } from '../tools/checks-get';
import { previewLink } from '../tools/preview-link';
import { runStatus } from '../tools/run-status';
import type { ToolContext } from '../tools/tool-context';
import { parseBean } from '../tools/tool-context';
import { workOverlaps } from '../tools/work-overlaps';
import { withInbox } from '../tools/collaboration';
import { registerCollaboration } from './collaboration-tools';
import { answer, failure } from './tool-result';

export const TOOL_NAMES = [
  'ask_repo',
  'work_overlaps',
  'change_status',
  'checks_get',
  'run_status',
  'preview_link',
] as const;

/** Every tool only reads; reads of the same run state answer the same. */
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const Bean = z.string().min(1).max(64).describe('A bean id (t032) or its branch (beans/t032)');
const RepoPath = z.string().min(1).max(300);

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'beanstalk', version: '0.1.0' });
  registerAsk(server, ctx);
  registerWorkOverlaps(server, ctx);
  registerBeanTools(server, ctx);
  registerRunTools(server, ctx);
  registerCollaboration(server, ctx);
  return server;
}

function registerAsk(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'ask_repo',
    {
      title: 'Ask the repo',
      description:
        "Ask a question about this run's repo in plain words (what is in flight in billing? what tests cover checkout? show bean t032). Answers with the explorer's view as JSON: the view spec, resolved files, beans, decisions and a preview_url.",
      inputSchema: z.object({
        question: z.string().trim().min(1).max(300),
        ref: LineRef.optional().describe('sprout (staged line, default) or stalk (stable line)'),
      }),
      annotations: { ...READ_ONLY, title: 'Ask the repo' },
    },
    async ({ question, ref }) =>
      answer(() => withInbox(ctx, () => askRepo(ctx, question, ref ?? null))),
  );
}

function registerWorkOverlaps(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'work_overlaps',
    {
      title: 'Work overlapping these paths',
      description:
        'Before editing: the beans in flight, awaiting validation, or green in the last 15 minutes that change these files or folders, with title, intent, slot, status and files. Read their intents and fit your change to theirs.',
      inputSchema: z.object({ paths: z.array(RepoPath).min(1).max(50) }),
      annotations: { ...READ_ONLY, title: 'Work overlapping these paths' },
    },
    async ({ paths }) => answer(() => withInbox(ctx, () => workOverlaps(ctx, paths))),
  );
}

function registerBeanTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'change_status',
    {
      title: 'Status of a bean',
      description:
        'Where a bean stands after it was submitted: in flight, landed on the sprout awaiting validation, green on the stalk, sent back, deciding, reverted or dropped; with the next step and recent steps.',
      inputSchema: z.object({ bean: Bean }),
      annotations: { ...READ_ONLY, title: 'Status of a bean' },
    },
    async ({ bean }) => forBean(bean, (id) => changeStatus(ctx, id), ctx),
  );
  server.registerTool(
    'checks_get',
    {
      title: 'Checks of a bean',
      description:
        "A bean's pre-land checks as structured failures (file, test). Flags reds inherited from the sprout (not your fault) and protected acceptance tests (fix the code, never the test).",
      inputSchema: z.object({ bean: Bean }),
      annotations: { ...READ_ONLY, title: 'Checks of a bean' },
    },
    async ({ bean }) => forBean(bean, (id) => checksGet(ctx, id)),
  );
}

function registerRunTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'run_status',
    {
      title: 'Status of the run',
      description:
        'The run at a glance: sprout and stalk heads, the window of unvalidated landings, beans in flight, open decision cards, red validations and cost.',
      inputSchema: z.object({}),
      annotations: { ...READ_ONLY, title: 'Status of the run' },
    },
    async () => answer(() => withInbox(ctx, () => runStatus(ctx))),
  );
  server.registerTool(
    'preview_link',
    {
      title: 'Explorer link',
      description:
        'A web link to see a bean (bean) or a line (ref: sprout or stalk) of this run in the explorer. Give one of the two.',
      inputSchema: z.object({ bean: Bean.optional(), ref: LineRef.optional() }),
      annotations: { ...READ_ONLY, title: 'Explorer link' },
    },
    async ({ bean, ref }) => {
      if (bean !== undefined && ref !== undefined) return failure('give bean or ref, not both');
      if (bean !== undefined)
        return forBean(bean, async (id) =>
          previewLink(ctx.webUrl, ctx.run, { kind: 'bean', bean: id }),
        );
      return answer(async () =>
        previewLink(
          ctx.webUrl,
          ctx.run,
          ref === undefined ? { kind: 'run' } : { kind: 'ref', ref },
        ),
      );
    },
  );
}

async function forBean<T extends object>(
  bean: string,
  read: (id: NonNullable<ReturnType<typeof parseBean>>) => Promise<T | undefined>,
  ctx?: ToolContext,
): Promise<CallToolResult> {
  const id = parseBean(bean);
  if (id === undefined) return failure(`"${bean}" is not a bean id (like t032 or beans/t032)`);
  const resolve = async () => {
    const found = await read(id);
    if (found === undefined) throw new ForgeError(`this run has no bean ${id}`, 'not_found');
    return found;
  };
  return answer(() => (ctx === undefined ? resolve() : withInbox(ctx, resolve)));
}
