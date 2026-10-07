/**
 * Turnstile on sign-in and sign-up: the browser solves a widget, the server redeems its token
 * once at Siteverify and requires success, the surface's action and an expected hostname.
 * On only when BOTH the site key and the secret are configured; with either missing it is off
 * and sign-in and sign-up work exactly as they do without it (the half-configured state is
 * logged, never enforced, so a deploy that sets one before the other locks nobody out).
 * Cloudflare's documented test keys answer without an
 * action and with `hostname: example.com`; their results are accepted only where the
 * deployment says so (`TURNSTILE_TEST_KEYS=allow`, staging), and refused everywhere else.
 */
import { z } from 'zod';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 10_000;
/** Turnstile tokens are at most 2,048 characters. */
const MAX_TOKEN_LENGTH = 2048;

export const TurnstileAction = z.enum(['signin', 'signup']);
export type TurnstileAction = z.infer<typeof TurnstileAction>;

export type TurnstileVerifier = {
  readonly secret: string;
  /** Hostnames the widget may have been solved on (this deployment's own). */
  readonly hostnames: readonly string[];
  readonly allowTestKeys: boolean;
};

/** What the web app reads from its env: a public site key, the secret and two switches. */
export type TurnstileEnv = {
  readonly TURNSTILE_SITE_KEY?: string;
  readonly TURNSTILE_HOSTNAMES?: string;
  readonly TURNSTILE_TEST_KEYS?: string;
};

export type TurnstileSetup =
  /** `missing`: what a half-configured deployment lacks (null when neither is set). */
  | { readonly kind: 'off'; readonly missing: 'site key' | 'secret' | null }
  | { readonly kind: 'on'; readonly siteKey: string; readonly verifier: TurnstileVerifier };

/**
 * The deployment's Turnstile setup. `hostnames` defaults to the request's own host: the
 * widget and the sign-in endpoints are on one origin.
 */
export function turnstileSetup(
  env: TurnstileEnv,
  secret: string | undefined,
  requestHost: string,
): TurnstileSetup {
  const siteKey = (env.TURNSTILE_SITE_KEY ?? '').trim();
  const secretKey = (secret ?? '').trim();
  if (siteKey === '' && secretKey === '') return { kind: 'off', missing: null };
  if (siteKey === '') return { kind: 'off', missing: 'site key' };
  if (secretKey === '') return { kind: 'off', missing: 'secret' };
  const listed = (env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((hostname) => hostname.trim())
    .filter((hostname) => hostname !== '');
  return {
    kind: 'on',
    siteKey,
    verifier: {
      secret: secretKey,
      hostnames: listed.length > 0 ? listed : [requestHost],
      allowTestKeys: env.TURNSTILE_TEST_KEYS === 'allow',
    },
  };
}

/**
 * Whether a sign-in or sign-up may go on: always while Turnstile is off (Siteverify is never
 * asked), else only with a token Siteverify accepts for this action and host.
 */
export async function turnstileGate(
  setup: TurnstileSetup,
  input: {
    readonly token: unknown;
    readonly action: TurnstileAction;
    readonly ip: string | null;
    readonly fetcher?: Fetcher;
  },
): Promise<TurnstileVerdict> {
  if (setup.kind === 'off') return { ok: true };
  return verifyTurnstile(setup.verifier, input);
}

export type TurnstileFailure =
  | 'missing'
  | 'refused'
  | 'unavailable'
  | 'wrong_action'
  | 'wrong_hostname'
  | 'test_key';

export type TurnstileVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: TurnstileFailure };

const SiteverifyAnswer = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
  metadata: z.object({ result_with_testing_key: z.boolean().optional() }).optional(),
});

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** Redeems one token at Siteverify (a token works once). Never throws. */
export async function verifyTurnstile(
  verifier: TurnstileVerifier,
  input: {
    readonly token: unknown;
    readonly action: TurnstileAction;
    readonly ip: string | null;
    readonly fetcher?: Fetcher;
  },
): Promise<TurnstileVerdict> {
  const { token } = input;
  if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH)
    return refused('missing');
  const body = new URLSearchParams({ secret: verifier.secret, response: token });
  if (input.ip !== null) body.set('remoteip', input.ip);
  const answer = await siteverify(input.fetcher ?? fetch, body);
  if (answer === null) return refused('unavailable');
  if (!answer.success) return refused('refused');
  if (answer.metadata?.result_with_testing_key === true)
    return verifier.allowTestKeys ? { ok: true } : refused('test_key');
  if (answer.action !== input.action) return refused('wrong_action');
  if (answer.hostname === undefined || !verifier.hostnames.includes(answer.hostname))
    return refused('wrong_hostname');
  return { ok: true };
}

async function siteverify(
  fetcher: Fetcher,
  body: URLSearchParams,
): Promise<z.infer<typeof SiteverifyAnswer> | null> {
  try {
    const response = await fetcher(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = SiteverifyAnswer.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // Network error, timeout or a body that is not JSON: fail closed.
    return null;
  }
}

function refused(reason: TurnstileFailure): TurnstileVerdict {
  return { ok: false, reason };
}
