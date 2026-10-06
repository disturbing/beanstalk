import type { CallToolResult } from '@modelcontextprotocol/server';

import { isForgeError } from '@beanstalk/shared-ask/forge/forge-errors';

/** Compact JSON answers; expected gateway failures remain tool errors. */
export async function answer(read: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await read()) }] };
  } catch (error: unknown) {
    if (isForgeError(error)) return failure(`the forge could not answer: ${error.message}`);
    throw error;
  }
}

export function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
