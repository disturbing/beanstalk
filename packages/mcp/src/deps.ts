/**
 * What the app needs from the outside world, so tests can hand it a fake gateway: the
 * GATEWAY binding narrowed to the gateway's RPC, and a logger.
 */
import type { AgentReposRpc } from '@gitstalk/shared-race/agent-repos';
import type { GatewayRpc } from '@gitstalk/shared-race/rpc';

import { asGatewayBinding } from '@gitstalk/shared-ask/forge/gateway-rpc';

import type { Logger } from './log';
import { createLogger, isLogLevel } from './log';
import { asAgentRepos } from './repos/agent-gateway';

export type Deps = {
  /** The gateway's RPC, or undefined when the binding does not expose it. */
  readonly gateway: GatewayRpc | undefined;
  /** The gateway's repository RPC for agent sessions, or undefined when it lacks it. */
  readonly agents?: AgentReposRpc | undefined;
  readonly log: Logger;
};

/** Production dependencies, read from the Worker's bindings. */
export function depsFromEnv(env: Env): Deps {
  return {
    gateway: asGatewayBinding(env.GATEWAY),
    agents: asAgentRepos(env.GATEWAY),
    log: createLogger(isLogLevel(env.LOG_LEVEL) ? env.LOG_LEVEL : 'info', {
      worker: 'gitstalk-mcp',
    }),
  };
}
