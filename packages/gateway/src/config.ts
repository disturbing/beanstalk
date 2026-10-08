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
  /** The web app people sign in to, named in the hint a credential-less request gets (may be empty). */
  readonly webUrl: string;
  /** The runner container class's `max_instances`: the pool races and repositories share. */
  readonly runnerMaxInstances: number;
};

const Seconds = z.coerce.number().int().min(60);

const Vars = z.object({
  LOG_LEVEL: z.string().refine(isLogLevel, 'debug, info, warn or error'),
  ARTIFACTS_NAMESPACE: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/),
  RUN_TOKEN_TTL_SECONDS: Seconds.max(24 * 3600),
  ARTIFACTS_TOKEN_TTL_SECONDS: Seconds.max(600),
  WEB_URL: z.union([z.url(), z.literal('')]).default(''),
  /** Must match `containers[].max_instances` in wrangler.jsonc. */
  RUNNER_MAX_INSTANCES: z.coerce.number().int().min(4).max(1000).default(48),
});

/** The secrets the gateway signs and authenticates with. */
export type GatewaySecrets = {
  readonly adminToken: string;
  readonly tokenSecret: string;
};

/** Bytes of entropy a secret needs: a short one is guessable or a weak HMAC key. */
const MIN_SECRET_CHARS = 32;

const Secrets = z.object({
  ADMIN_TOKEN: z
    .string()
    .min(MIN_SECRET_CHARS, `ADMIN_TOKEN must be at least ${MIN_SECRET_CHARS} characters`),
  RUN_TOKEN_SECRET: z
    .string()
    .min(MIN_SECRET_CHARS, `RUN_TOKEN_SECRET must be at least ${MIN_SECRET_CHARS} characters`),
});

/**
 * Checks the Wrangler secrets. Throws a misconfiguration error naming the secret (never its
 * value) rather than letting an empty key reach `importKey` or the admin comparison.
 */
export function readSecrets(env: Pick<Env, keyof z.infer<typeof Secrets>>): GatewaySecrets {
  const parsed = Secrets.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `misconfigured secrets: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return { adminToken: parsed.data.ADMIN_TOKEN, tokenSecret: parsed.data.RUN_TOKEN_SECRET };
}

/**
 * The Actions job container class's `max_instances` (the executor Worker's
 * `ACTIONS_MAX_INSTANCES`), from this Worker's optional var of the same name; 16 when unset.
 * RunnerCapacity holds Actions job leases (`actions:<repo>`) to it.
 */
export const DEFAULT_ACTIONS_MAX_INSTANCES = 16;

export function actionsMaxInstances(env: object): number {
  const parsed = z.coerce
    .number()
    .int()
    .min(0)
    .max(1000)
    .safeParse(Reflect.get(env, 'ACTIONS_MAX_INSTANCES') ?? DEFAULT_ACTIONS_MAX_INSTANCES);
  return parsed.success ? parsed.data : DEFAULT_ACTIONS_MAX_INSTANCES;
}

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
    webUrl: vars.WEB_URL,
    runnerMaxInstances: vars.RUNNER_MAX_INSTANCES,
  };
}
