/**
 * Actions settings from the gateway's vars (wrangler.jsonc): the public origin, which executor
 * runs jobs, and the per-repository limits (D9; self-hosters change the vars). Read once per
 * request or Durable Object; a misconfigured deployment throws.
 */
import { z } from 'zod';

export type ActionsConfig = {
  /** This Worker's origin (`https://…`): live log sockets. */
  readonly publicUrl: string;
  /**
   * Where git and repository pages are served (the web host, as on GitHub): the jobs'
   * `GITHUB_SERVER_URL`, so unmodified `actions/checkout` fetches `<server>/<owner>/<repo>`.
   */
  readonly serverUrl: string;
  /**
   * The OIDC token endpoint for `id-token: write` jobs (`ACTIONS_ID_TOKEN_REQUEST_URL`), once
   * the OIDC issuer is deployed (`ACTIONS_OIDC_REQUEST_URL`); null until then.
   */
  readonly oidcRequestUrl: string | null;
  /** `stub`: the built-in echo executor; `service`: the ACTIONS_EXECUTOR binding. */
  readonly executorMode: 'stub' | 'service';
  readonly monthlyMinutes: number;
  readonly jobTimeoutMinutes: number;
  readonly concurrentJobs: number;
  /** Legs a job's matrix may expand to. */
  readonly maxMatrixLegs: number;
};

const Vars = z.object({
  PUBLIC_URL: z.url(),
  WEB_URL: z.union([z.url(), z.literal('')]).default(''),
  ACTIONS_EXECUTOR_MODE: z.enum(['stub', 'service']),
  ACTIONS_MONTHLY_MINUTES: z.coerce.number().int().min(0),
  ACTIONS_JOB_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(360),
  ACTIONS_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(64),
});

/** Matrix legs per job at most (doc 25 §6.1: `include` of up to N). */
export const MAX_MATRIX_LEGS = 16;

export function readActionsConfig(env: Pick<Env, keyof z.infer<typeof Vars>>): ActionsConfig {
  const vars = Vars.parse(env);
  return {
    publicUrl: vars.PUBLIC_URL.replace(/\/+$/, ''),
    serverUrl: (vars.WEB_URL === '' ? vars.PUBLIC_URL : vars.WEB_URL).replace(/\/+$/, ''),
    oidcRequestUrl: optionalUrl(Reflect.get(env, 'ACTIONS_OIDC_REQUEST_URL')),
    executorMode: vars.ACTIONS_EXECUTOR_MODE,
    monthlyMinutes: vars.ACTIONS_MONTHLY_MINUTES,
    jobTimeoutMinutes: vars.ACTIONS_JOB_TIMEOUT_MINUTES,
    concurrentJobs: vars.ACTIONS_CONCURRENT_JOBS,
    maxMatrixLegs: MAX_MATRIX_LEGS,
  };
}

/** The `ACTIONS_SECRETS_KEY` secret, or null when it is not set. */
export function secretsKeyOf(env: Partial<Pick<Env, 'ACTIONS_SECRETS_KEY'>>): string | null {
  const key = env.ACTIONS_SECRETS_KEY;
  return typeof key === 'string' && key !== '' ? key : null;
}

function optionalUrl(value: unknown): string | null {
  const parsed = z.url().safeParse(value);
  return parsed.success ? parsed.data : null;
}
