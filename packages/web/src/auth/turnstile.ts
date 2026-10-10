/**
 * Turnstile for the sign-in and sign-up endpoints (`@gitstalk/shared-identity/turnstile`),
 * from this deployment's vars and its `TURNSTILE_SECRET_KEY` secret. The secret is optional
 * per deployment, so it is not in the generated Env and is read (and checked) here only. On
 * only when both are configured; otherwise sign-in and sign-up go on without a check.
 */
import { env } from 'cloudflare:workers';

import { clientIp } from '@gitstalk/shared-identity/request-context';
import type { TurnstileAction, TurnstileSetup } from '@gitstalk/shared-identity/turnstile';
import { turnstileGate, turnstileSetup } from '@gitstalk/shared-identity/turnstile';

import { log } from '../log';
import { problem } from './http';

/** The form field the widget fills in (Turnstile's own name). */
export const TURNSTILE_FIELD = 'cf-turnstile-response';

/** The site key the pages render the widget with; null while Turnstile is off. */
export function turnstileSiteKey(): string | null {
  const setup = setupFor(null);
  return setup.kind === 'on' ? setup.siteKey : null;
}

/**
 * Null when the request may go on (Turnstile off, or a good token); otherwise the reason it
 * may not, which the caller turns into its own kind of answer (JSON or a redirect).
 */
export async function turnstileRefusal(
  request: Request,
  token: unknown,
  action: TurnstileAction,
): Promise<string | null> {
  const setup = setupFor(new URL(request.url).hostname);
  if (setup.kind === 'off' && setup.missing !== null)
    log.warn('turnstile half configured, so it is off', { action, missing: setup.missing });
  const verdict = await turnstileGate(setup, { token, action, ip: clientIp(request) });
  if (verdict.ok) return null;
  log.warn('turnstile refused', { action, reason: verdict.reason });
  return verdict.reason;
}

/** The JSON answer for a refused check: the page resets its widget and the person retries. */
export function turnstileProblem(reason: string): Response {
  return reason === 'unavailable'
    ? problem(503, 'turnstile_unavailable', 'The human check is not answering. Try again soon.')
    : problem(403, 'turnstile', 'Complete the check above, then try again.');
}

/** `host`: the request's, for the verifier's default hostname (null when only rendering). */
function setupFor(host: string | null): TurnstileSetup {
  const secret: unknown = Reflect.get(env, 'TURNSTILE_SECRET_KEY');
  return turnstileSetup(env, typeof secret === 'string' ? secret : undefined, host ?? '');
}
