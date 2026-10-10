/**
 * The Gitstalk OIDC issuer: discovery, JWKS and the job-facing token endpoint, as a Hono app a
 * Worker mounts at the issuer's path (`app.route('/_actions/oidc', createOidcApp(...))`).
 *
 * GitHub contract (https://docs.github.com/en/actions/reference/security/oidc and
 * https://github.com/actions/toolkit/blob/main/packages/core/src/oidc-utils.ts): the job reads
 * `ACTIONS_ID_TOKEN_REQUEST_URL` (which already has a query string) and
 * `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, calls `GET <url>&audience=<aud>` with
 * `Authorization: bearer <token>` and expects `{ "value": "<jwt>" }`.
 */
import { Hono } from 'hono';

import { encodeJson } from './base64url';
import type { IdTokenClaims } from './claims';
import { buildClaims, DEFAULT_TOKEN_TTL_SECONDS, MAX_TOKEN_TTL_SECONDS } from './claims';
import type { IdTokenJob } from './job-identity';
import { isUntrustedPreland } from './job-identity';
import type { RequestTokenSecrets } from './request-token';
import {
  MAX_REQUEST_TOKEN_TTL_SECONDS,
  signRequestToken,
  verifyRequestToken,
} from './request-token';
import type { SigningKeySet } from './signing-keys';
import { loadSigningKeys, publicJwks, signJws } from './signing-keys';

/** Where the issuer lives under a host's origin when `OIDC_ISSUER_URL` is not set. */
export const DEFAULT_ISSUER_PATH = '/_actions/oidc';
const TOKEN_API_VERSION = '2.0';
const MAX_AUDIENCE_LENGTH = 256;

export type OidcConfig = {
  /** The `iss` claim and the discovery document's `issuer`; no trailing slash. */
  readonly issuerUrl: string;
  readonly keys: SigningKeySet;
  readonly requestSecrets: RequestTokenSecrets;
  readonly nowMs: () => number;
  /** Life of an identity token in seconds; at most 600. */
  readonly tokenTtlSeconds?: number;
  /** Lets the control plane refuse a request token once its job ended. Default: expiry only. */
  readonly isJobActive?: (jobId: string) => Promise<boolean>;
};

/** The Worker bindings the issuer reads (secrets and one var); a host's generated `Env` satisfies this. */
export type OidcEnvironment = {
  readonly OIDC_SIGNING_KEYS?: string;
  readonly OIDC_REQUEST_SECRET?: string;
  readonly OIDC_REQUEST_SECRET_PREVIOUS?: string;
  /** Self-hosters set this to the public URL of the issuer; default `<origin>/_actions/oidc`. */
  readonly OIDC_ISSUER_URL?: string;
};

/** Thrown when the issuer is not configured (secrets missing). The route answers 503. */
export class OidcNotConfiguredError extends Error {}

export function issuerUrlFor(environment: OidcEnvironment, origin: string): string {
  return (environment.OIDC_ISSUER_URL ?? `${origin}${DEFAULT_ISSUER_PATH}`).replace(/\/+$/, '');
}

export async function loadOidcConfig(
  environment: OidcEnvironment,
  origin: string,
  extras: Pick<OidcConfig, 'isJobActive' | 'tokenTtlSeconds'> = {},
): Promise<OidcConfig> {
  const { OIDC_SIGNING_KEYS: signingKeys, OIDC_REQUEST_SECRET: current } = environment;
  if (signingKeys === undefined || current === undefined || current.length < 32) {
    throw new OidcNotConfiguredError(
      'OIDC_SIGNING_KEYS and OIDC_REQUEST_SECRET (32+ chars) are required',
    );
  }
  const previous = environment.OIDC_REQUEST_SECRET_PREVIOUS;
  return {
    issuerUrl: issuerUrlFor(environment, origin),
    keys: await loadSigningKeys(signingKeys),
    requestSecrets: previous === undefined ? { current } : { current, previous },
    nowMs: () => Date.now(),
    ...extras,
  };
}

// For the control plane ------------------------------------------------------------------------

export type MintOptions = {
  readonly issuerUrl: string;
  readonly secrets: RequestTokenSecrets;
  /** The job's timeout plus its grace period, in seconds (capped at 65 minutes). */
  readonly lifetimeSeconds: number;
  readonly nowMs: number;
  /** Mint for pre-land checks of beans from untrusted pushers (default: no). */
  readonly allowUntrustedPreland?: boolean;
};

/**
 * The `ACTIONS_ID_TOKEN_REQUEST_URL` and `_TOKEN` for a job, or null when the job gets none:
 * its workflow did not ask for `id-token: write`, or it is an untrusted pre-land check and the
 * control plane did not allow it (like a fork pull request on GitHub, decision D4).
 */
export async function mintIdTokenRequest(
  job: IdTokenJob,
  options: MintOptions,
): Promise<{ readonly url: string; readonly token: string } | null> {
  if (!job.idTokenWrite) return null;
  if (isUntrustedPreland(job) && options.allowUntrustedPreland !== true) return null;
  const lifetime = Math.min(Math.max(1, options.lifetimeSeconds), MAX_REQUEST_TOKEN_TTL_SECONDS);
  const expSeconds = Math.floor(options.nowMs / 1000) + lifetime;
  const token = await signRequestToken(job, options.secrets, expSeconds);
  const base = options.issuerUrl.replace(/\/+$/, '');
  return { url: `${base}/token?api-version=${TOKEN_API_VERSION}`, token };
}

// The identity token ---------------------------------------------------------------------------

/** Signs the claims for `job` and `audience` with the active key. */
export async function issueIdToken(
  config: OidcConfig,
  job: IdTokenJob,
  audience: string,
): Promise<{ readonly jwt: string; readonly claims: IdTokenClaims }> {
  const claims = buildClaims({
    job,
    issuer: config.issuerUrl,
    audience,
    nowSeconds: Math.floor(config.nowMs() / 1000),
    ttlSeconds: Math.min(
      config.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS,
      MAX_TOKEN_TTL_SECONDS,
    ),
  });
  const { active } = config.keys;
  const signingInput = `${encodeJson({ alg: active.alg, kid: active.kid, typ: 'JWT' })}.${encodeJson(claims)}`;
  return { jwt: `${signingInput}.${await signJws(active, signingInput)}`, claims };
}

/** GitHub's default: the repository owner's URL, on our host. */
export function defaultAudience(config: OidcConfig, job: IdTokenJob): string {
  return `${new URL(config.issuerUrl).origin}/${job.repository.owner}`;
}

function validAudience(audience: string): boolean {
  if (audience.length === 0 || audience.length > MAX_AUDIENCE_LENGTH) return false;
  // No whitespace or control characters (code units up to space, and DEL).
  for (let index = 0; index < audience.length; index += 1) {
    const code = audience.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

// Routes ---------------------------------------------------------------------------------------

export type OidcConfigSource = (request: Request) => Promise<OidcConfig>;

export function createOidcApp(configFor: OidcConfigSource): Hono {
  const app = new Hono();

  app.get('/.well-known/openid-configuration', async (c) => {
    const config = await configFor(c.req.raw);
    const algorithms = [...new Set(config.keys.all.map((key) => key.alg))];
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({
      issuer: config.issuerUrl,
      jwks_uri: `${config.issuerUrl}/.well-known/jwks`,
      subject_types_supported: ['public'],
      response_types_supported: ['id_token'],
      claims_supported: CLAIMS_SUPPORTED,
      id_token_signing_alg_values_supported: algorithms,
      scopes_supported: ['openid'],
    });
  });

  app.get('/.well-known/jwks', async (c) => {
    const config = await configFor(c.req.raw);
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(publicJwks(config.keys));
  });

  app.get('/token', async (c) => {
    c.header('Cache-Control', 'no-store');
    const config = await configFor(c.req.raw);
    const bearer = /^bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '');
    const verified =
      bearer?.[1] === undefined
        ? null
        : await verifyRequestToken(
            bearer[1],
            config.requestSecrets,
            Math.floor(config.nowMs() / 1000),
          );
    if (verified === null) {
      c.header('WWW-Authenticate', 'Bearer realm="beanstalk-oidc"');
      return c.json({ message: 'invalid or expired request token' }, 401);
    }
    const { job } = verified;
    if (!job.idTokenWrite || (config.isJobActive && !(await config.isJobActive(job.jobId)))) {
      return c.json({ message: 'the job is not allowed to request identity tokens' }, 403);
    }
    const audience = c.req.query('audience') ?? defaultAudience(config, job);
    if (!validAudience(audience)) return c.json({ message: 'invalid audience' }, 400);
    const { jwt } = await issueIdToken(config, job, audience);
    return c.json({ count: jwt.length, value: jwt });
  });

  app.onError((error, c) => {
    if (error instanceof OidcNotConfiguredError)
      return c.json({ message: 'issuer not configured' }, 503);
    // Never echo the cause: it may name key handling.
    return c.json({ message: 'identity token service error' }, 500);
  });

  return app;
}

const CLAIMS_SUPPORTED = [
  'iss',
  'aud',
  'sub',
  'exp',
  'iat',
  'nbf',
  'jti',
  'repository',
  'repository_id',
  'repository_owner',
  'repository_owner_id',
  'repository_visibility',
  'ref',
  'ref_type',
  'sha',
  'head_ref',
  'base_ref',
  'workflow',
  'workflow_ref',
  'workflow_sha',
  'job_workflow_ref',
  'job_workflow_sha',
  'run_id',
  'run_number',
  'run_attempt',
  'actor',
  'actor_id',
  'event_name',
  'environment',
  'runner_environment',
  'trust',
  'pusher',
  'bean',
];
