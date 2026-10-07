import type { RunId } from '@beanstalk/shared-race/ids';

import type { GatewayConfig } from './config';
import { readConfig, readSecrets } from './config';
import type { Logger } from './log';
import { createLogger } from './log';
import type { Registry } from './repos/registry';
import { d1Registry } from './repos/registry';
import type { RunDO } from './run/run-do';
import type { RunIndex } from './run/run-index';
import { RUN_INDEX_NAME } from './run/run-index';
import type { RunStreamDO } from './stream/run-stream-do';

/** What the routes use, built per request from the Worker's env (it depends on nothing else) (the composition root). */
export type Deps = {
  readonly config: GatewayConfig;
  readonly log: Logger;
  readonly adminToken: string;
  readonly tokenSecret: string;
  readonly run: (run: RunId) => DurableObjectStub<RunDO>;
  /** The run index: the run list, the kill switch and the repo sweep. */
  readonly runIndex: () => DurableObjectStub<RunIndex>;
  /** The run's streaming diffs (`stream_diffs`): posts, viewers' sockets, the stream RPC. */
  readonly streams: (run: RunId) => DurableObjectStub<RunStreamDO>;
  readonly now: () => number;
  /** The repository registry (`repos/registry.ts`): names, owners, visibility, engines. */
  readonly registry: Registry;
};

export function createDeps(env: Env): Deps {
  const config = readConfig(env);
  const { adminToken, tokenSecret } = readSecrets(env);
  return {
    config,
    log: createLogger(config.logLevel, { component: 'gateway' }),
    adminToken,
    tokenSecret,
    run: (run) => env.RUNS.getByName(run),
    runIndex: () => env.RUN_INDEX.getByName(RUN_INDEX_NAME),
    streams: (run) => env.RUN_STREAMS.getByName(run),
    now: () => Date.now(),
    registry: d1Registry(env.FORGE),
  };
}
