/**
 * Small pieces the account route handlers share: the relying party for passkeys, the
 * same-origin check, safe `next` paths, cookie headers and JSON errors.
 */
import { z } from 'zod';

import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  setCookie,
} from '@beanstalk/shared-identity/cookies';
import type { RelyingParty } from '@beanstalk/shared-identity/passkeys';
import { isSameOrigin, siteOrigin } from '@beanstalk/shared-identity/request-context';
import type { NewSession, WebSession } from '@beanstalk/shared-identity/sessions';
import { isValidCsrf } from '@beanstalk/shared-identity/sessions';

/** Where to go after signing in: a path on this site only, never `//host` or a scheme. */
export const NextPath = z
  .string()
  .regex(/^\/(?![/\\])[\w\-./?=&%]*$/)
  .catch('/');

export function relyingParty(request: Request): RelyingParty {
  return { ...siteOrigin(request), name: 'Beanstalk' };
}

/** Refuses cross-site state changes (see `isSameOrigin`). */
export function crossSiteRefusal(request: Request): Response | null {
  return isSameOrigin(request)
    ? null
    : problem(403, 'forbidden', 'cross-site requests are refused');
}

export function problem(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export function sessionCookie(session: NewSession, now: number): string {
  return setCookie(SESSION_COOKIE, session.secret, Math.floor((session.expiresAt - now) / 1000));
}

export function challengeCookie(handle: string): string {
  return setCookie(CHALLENGE_COOKIE, handle, 300);
}

export function clearChallengeCookie(): string {
  return clearCookie(CHALLENGE_COOKIE);
}

/** A 303 to a path on this site, with cookies to set. */
export function seeOther(
  request: Request,
  path: string,
  cookies: readonly string[] = [],
): Response {
  const response = new Response(null, {
    status: 303,
    headers: { location: new URL(path, request.url).toString() },
  });
  for (const cookie of cookies) response.headers.append('set-cookie', cookie);
  response.headers.set('cache-control', 'no-store');
  return response;
}

/**
 * A signed-in person's form POST: same origin, a live session, and the session's CSRF token
 * in the `csrf` field. Answers the form, or the response refusing it.
 */
export async function signedInForm(
  request: Request,
  getSession: (cookieHeader: string | null) => Promise<WebSession | null>,
): Promise<{ readonly session: WebSession; readonly form: FormData } | Response> {
  const refused = crossSiteRefusal(request);
  if (refused !== null) return refused;
  const session = await getSession(request.headers.get('cookie'));
  if (session === null) return seeOther(request, '/login');
  const form = await request.formData();
  if (!(await isValidCsrf(session, form.get('csrf'))))
    return problem(403, 'forbidden', 'Reload the page and try again.');
  return { session, form };
}
