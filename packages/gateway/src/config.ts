import { z } from 'zod';

import type { LogLevel } from './log';
import { isLogLevel } from './log';

/** The gateway's settings, read once per request from the Worker's vars. */
export type GatewayConfig = {
  readonly logLevel: LogLevel;
  /** The Artifacts namespace of the ARTIFACTS binding; the git proxy serves `/git/<namespace>/`. */
  readonly namespace: string;
  readonly runTokenTtlSeconds: number;
  /** TTL of the Artifacts tokens the gateway mints for the proxy and the runner (≤ 10 min). */
  readonly artifactsTokenTtlSeconds: number;
};

const Seconds = z.coerce.number().int().min(60);

const Vars = z.object({
  LOG_LEVEL: z.string().refine(isLogLevel, 'debug, info, warn or error'),
  ARTIFACTS_NAMESPACE: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/),
  RUN_TOKEN_TTL_SECONDS: Seconds.max(24 * 3600),
  ARTIFACTS_TOKEN_TTL_SECONDS: Seconds.max(600),
});

/**
 * Parses the vars from `wrangler.jsonc`. Throws on a misconfigured deployment (a bug in
 * the config, not a request error).
 */
export function readConfig(env: Pick<Env, keyof z.infer<typeof Vars>>): GatewayConfig {
  const vars = Vars.parse(env);
  return {
    logLevel: isLogLevel(vars.LOG_LEVEL) ? vars.LOG_LEVEL : 'info',
    namespace: vars.ARTIFACTS_NAMESPACE,
    runTokenTtlSeconds: vars.RUN_TOKEN_TTL_SECONDS,
    artifactsTokenTtlSeconds: vars.ARTIFACTS_TOKEN_TTL_SECONDS,
  };
}
