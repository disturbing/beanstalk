import { z } from 'zod';

import type { LogLevel } from './log';
import { isLogLevel } from './log';

/** The SSH Worker's settings, read from its vars. */
export type SshConfig = {
  readonly logLevel: LogLevel;
  readonly poolSize: number;
  readonly maxConnections: number;
  readonly hostKeyFingerprint: string;
  readonly tunnel: 'on' | 'off';
};

const Vars = z.object({
  LOG_LEVEL: z.string().refine(isLogLevel, 'debug, info, warn or error'),
  SSH_POOL_SIZE: z.coerce.number().int().min(1).max(16),
  SSH_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(1024),
  SSH_HOST_KEY_FINGERPRINT: z.string(),
  SSH_TUNNEL: z.enum(['on', 'off']),
});

/** Parses the vars; throws on a misconfigured deployment (a bug in the config). */
export function readConfig(env: z.input<typeof Vars>): SshConfig {
  const vars = Vars.parse(env);
  return {
    logLevel: isLogLevel(vars.LOG_LEVEL) ? vars.LOG_LEVEL : 'info',
    poolSize: vars.SSH_POOL_SIZE,
    maxConnections: vars.SSH_MAX_CONNECTIONS,
    hostKeyFingerprint: vars.SSH_HOST_KEY_FINGERPRINT,
    tunnel: vars.SSH_TUNNEL,
  };
}

/** The pool instance a new connection goes to: any of them, at random. */
export function poolInstance(poolSize: number, random: () => number = Math.random): string {
  return `ssh-${Math.min(poolSize - 1, Math.floor(random() * poolSize))}`;
}
