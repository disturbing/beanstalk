import { env } from 'cloudflare:workers';

import { PREAUTH_COOKIE, clearCookie, readCookie } from '@gitstalk/shared-identity/cookies';
import { consumeMagicLink } from '@gitstalk/shared-identity/magic-links';
import { clientIp, userAgent } from '@gitstalk/shared-identity/request-context';

import { problem, seeOther, sessionCookie } from '../../../src/auth/http';
import { emailSignIn } from '../../../src/auth/services';

/** Opens a magic link: single use, 15 minutes, only in the browser that asked for it. */
export async function GET(request: Request): Promise<Response> {
  if (emailSignIn() === null) return problem(404, 'not_found', 'email sign-in is not available');
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const now = Date.now();
  const outcome = await consumeMagicLink(env, {
    token,
    browserSecret: readCookie(request.headers.get('cookie'), PREAUTH_COOKIE),
    userAgent: userAgent(request),
    ip: clientIp(request),
    now,
  });
  if (!outcome.ok)
    return seeOther(request, `/login?email_error=${outcome.reason}`, [clearCookie(PREAUTH_COOKIE)]);
  return seeOther(request, outcome.created ? '/settings' : '/', [
    sessionCookie(outcome.session, now),
    clearCookie(PREAUTH_COOKIE),
  ]);
}
