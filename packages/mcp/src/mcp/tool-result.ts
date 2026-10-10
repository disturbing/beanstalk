import type { CallToolResult } from '@modelcontextprotocol/server';

import { isForgeError } from '@gitstalk/shared-ask/forge/forge-errors';

/** A failure the agent can act on (a missing repository, a scope, a claimed task), told as is. */
export class ToolError extends Error {
  override readonly name = 'ToolError';
}

/** Compact JSON answers; expected gateway failures remain tool errors. */
export async function answer(read: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await read()) }] };
  } catch (error: unknown) {
    if (error instanceof ToolError) return failure(error.message);
    if (isForgeError(error)) return failure(`the forge could not answer: ${error.message}`);
    throw error;
  }
}

export function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
