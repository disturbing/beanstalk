import type { RunId } from '@beanstalk/shared-race/ids';

import type { GatewayConfig } from './config';
import { readConfig } from './config';
import type { Logger } from './log';
import { createLogger } from './log';
import type { RunDO } from './run/run-do';

/** What the routes use, built once per request from the Worker's env (the composition root). */
export type Deps = {
  readonly config: GatewayConfig;
  readonly log: Logger;
  readonly adminToken: string;
  readonly tokenSecret: string;
  readonly run: (run: RunId) => DurableObjectStub<RunDO>;
  readonly now: () => number;
};

export function createDeps(env: Env): Deps {
  const config = readConfig(env);
  return {
    config,
    log: createLogger(config.logLevel, { component: 'gateway' }),
    adminToken: env.ADMIN_TOKEN,
    tokenSecret: env.RUN_TOKEN_SECRET,
    run: (run) => env.RUNS.getByName(run),
    now: () => Date.now(),
  };
}
