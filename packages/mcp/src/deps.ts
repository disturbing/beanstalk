/**
 * What the app needs from the outside world, so tests can hand it a fake gateway: the
 * GATEWAY binding narrowed to the gateway's RPC, and a logger.
 */
import type { GatewayRpc } from '@beanstalk/shared-race/rpc';

import { asGatewayBinding } from '@beanstalk/shared-ask/forge/gateway-rpc';

import type { Logger } from './log';
import { createLogger, isLogLevel } from './log';

export type Deps = {
  /** The gateway's RPC, or undefined when the binding does not expose it. */
  readonly gateway: GatewayRpc | undefined;
  readonly log: Logger;
};

/** Production dependencies, read from the Worker's bindings. */
export function depsFromEnv(env: Env): Deps {
  return {
    gateway: asGatewayBinding(env.GATEWAY),
    log: createLogger(isLogLevel(env.LOG_LEVEL) ? env.LOG_LEVEL : 'info', {
      worker: 'beanstalk-mcp',
    }),
  };
}
