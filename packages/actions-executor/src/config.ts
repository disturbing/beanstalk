import { z } from 'zod';

import type { LogLevel } from './log';
import { isLogLevel } from './log';

/** The executor's settings, read from its vars. */
export type ExecutorConfig = {
  readonly logLevel: LogLevel;
  readonly sinkMode: 'service' | 'standalone';
};

const Vars = z.object({
  LOG_LEVEL: z.string().refine(isLogLevel, 'debug, info, warn or error'),
  SINK_MODE: z.enum(['service', 'standalone']),
});

/** Parses the vars; throws on a misconfigured deployment (a bug in the config). */
export function readConfig(env: z.input<typeof Vars>): ExecutorConfig {
  const vars = Vars.parse(env);
  return {
    logLevel: isLogLevel(vars.LOG_LEVEL) ? vars.LOG_LEVEL : 'info',
    sinkMode: vars.SINK_MODE,
  };
}

/** Bytes a secret needs to be a usable admin token. */
const MIN_ADMIN_TOKEN_CHARS = 32;

/** The admin token, or null when it is missing or too short (admin routes then answer 503). */
export function adminToken(env: Env): string | null {
  const token: unknown = Reflect.get(env, 'ADMIN_TOKEN');
  return typeof token === 'string' && token.length >= MIN_ADMIN_TOKEN_CHARS ? token : null;
}
