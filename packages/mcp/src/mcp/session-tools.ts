/**
 * Tools only a person's agent session has (OAuth or a personal token): who am I, and a
 * short-lived git credential. The credential is a `bss_` token, at most an hour, never wider
 * than the session's scopes (read, write), revoked with the session's grant. It is visible
 * to the model that asked for it: the trade-off docs/claude-opus/16 §3.3 accepts until the
 * `bean` CLI's credential helper (Phase 6).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { ToolContext } from '../tools/tool-context';
import { answer, failure } from './tool-result';

export const SESSION_TOOL_NAMES = ['whoami', 'git_credential'] as const;

export function registerSessionTools(server: McpServer, ctx: ToolContext): void {
  const { session } = ctx;
  if (session === undefined) return;
  server.registerTool(
    'whoami',
    {
      title: 'Who this session is',
      description:
        'The Beanstalk account this agent session acts for: handle, the client the person approved, the scopes granted (read, collaborate, write) and the run these tools read.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      answer(async () => ({
        handle: session.handle,
        client: session.clientName,
        via: session.via,
        scopes: session.scopes,
        run: ctx.run,
        web: ctx.webUrl,
      })),
  );
  server.registerTool(
    'git_credential',
    {
      title: 'Short-lived git credential',
      description:
        "A one-hour git credential (bss_ token) for Beanstalk's git endpoint, acting as this session's person with its read/write scopes. Use it as the password with any user name (https://x:<token>@host/git/...). Keep it out of files and commits. Repositories open to people arrive with persistent repositories; race repos still take run tokens.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const minted = await session.mintGitToken();
      if (minted === null) return failure('this session has neither read nor write scope for git');
      return answer(async () => ({ ...minted, username: session.handle }));
    },
  );
}
