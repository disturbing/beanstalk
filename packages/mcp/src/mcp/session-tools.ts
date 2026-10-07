/**
 * Tools only a person's agent session has (OAuth or a personal token): who am I. The
 * repository tools (../repos/repo-tools.ts) carry the rest, `git_credentials` among them.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { ToolScope } from '../tools/tool-context';
import { answer } from './tool-result';

export const SESSION_TOOL_NAMES = ['whoami'] as const;

export function registerSessionTools(server: McpServer, scope: ToolScope): void {
  const { session } = scope;
  if (session === undefined) return;
  server.registerTool(
    'whoami',
    {
      title: 'Who this session is',
      description:
        'The Beanstalk account this agent session acts for: handle, the client the person approved, the scopes granted (read, collaborate, write) and the run tools read when they name no repository.',
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
        run: scope.own?.run ?? null,
        web: scope.webUrl,
      })),
  );
}
