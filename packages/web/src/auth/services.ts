/**
 * The account services the web app calls, from its bindings: the MCP Worker's consent and
 * agent-session RPC, and email sign-in (null while no sender domain is configured).
 */
import { env } from 'cloudflare:workers';

import type { AgentSessionsRpc } from '@beanstalk/shared-identity/agent-sessions';
import { isAgentSessionsRpc } from '@beanstalk/shared-identity/agent-sessions';
import type { EmailSignInConfig } from '@beanstalk/shared-identity/magic-links';
import { emailSignInConfig } from '@beanstalk/shared-identity/magic-links';

export function agentSessionsRpc(): AgentSessionsRpc {
  const binding: unknown = env.MCP;
  if (!isAgentSessionsRpc(binding))
    throw new Error('the MCP binding does not answer AgentSessionsRpc');
  return binding;
}

/** Email magic links, or null: off until EMAIL_SENDER_DOMAIN and the EMAIL binding are set. */
export function emailSignIn(): EmailSignInConfig | null {
  const sender: unknown = Reflect.get(env, 'EMAIL');
  return emailSignInConfig({
    EMAIL_SENDER_DOMAIN: env.EMAIL_SENDER_DOMAIN,
    ...(isSender(sender) ? { EMAIL: sender } : {}),
  });
}

function isSender(value: unknown): value is EmailSignInConfig['sender'] {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'send') === 'function'
  );
}
