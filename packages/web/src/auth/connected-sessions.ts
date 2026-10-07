/**
 * A person's connected agent sessions for Home and Settings: the MCP Worker's grant list,
 * plus approvals from the last two minutes that the list (eventually consistent KV) does not
 * show yet, read from the audit log in D1. Null when the MCP Worker does not answer.
 */
import { env } from 'cloudflare:workers';

import type { AgentSession } from '@beanstalk/shared-identity/agent-sessions';
import {
  AgentSession as AgentSessionSchema,
  withSettlingSessions,
} from '@beanstalk/shared-identity/agent-sessions';

import { log } from '../log';
import { agentSessionsRpc } from './services';

export async function connectedSessions(userId: string): Promise<readonly AgentSession[] | null> {
  let listed: readonly AgentSession[];
  try {
    const parsed = AgentSessionSchema.array().safeParse(
      await agentSessionsRpc().agentSessions(userId),
    );
    if (!parsed.success) {
      log.error('connected agents answered in an unknown shape', {
        issues: parsed.error.issues.length,
      });
      return null;
    }
    listed = parsed.data;
  } catch (error: unknown) {
    log.error('connected agents unavailable', { error });
    return null;
  }
  return withSettlingSessions(env, { userId, listed, now: Date.now() });
}
