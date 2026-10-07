import { env } from 'cloudflare:workers';

import { PREAUTH_COOKIE, setCookie } from '@beanstalk/shared-identity/cookies';
import { MAGIC_LINK_SECONDS, requestMagicLink } from '@beanstalk/shared-identity/magic-links';
import { isWithinLimits } from '@beanstalk/shared-identity/rate-limit';
import { clientIp, siteOrigin } from '@beanstalk/shared-identity/request-context';
import { randomSecret } from '@beanstalk/shared-identity/secrets';
import { Email, Handle } from '@beanstalk/shared-identity/users';

import { crossSiteRefusal, problem, seeOther } from '../../../../src/auth/http';
import { emailSignIn } from '../../../../src/auth/services';
import { log } from '../../../../src/log';

/**
 * Asks for an email sign-in link (or a sign-up link, with a handle). 404 while email sign-in
 * is off. Same origin, rate limited per IP and per address; the answer never says whether
 * the address has an account.
 */
export async function POST(request: Request): Promise<Response> {
  const config = emailSignIn();
  if (config === null) return problem(404, 'not_found', 'email sign-in is not available');
  const refused = crossSiteRefusal(request);
  if (refused !== null) return refused;
  const form = await request.formData();
  const email = Email.safeParse(form.get('email'));
  const handleField = form.get('handle');
  const handle =
    typeof handleField === 'string' && handleField.trim() !== ''
      ? Handle.safeParse(handleField)
      : null;
  const back = handle === null ? '/login' : '/signup';
  if (!email.success) return seeOther(request, `${back}?email_error=address`);
  if (handle !== null && !handle.success) return seeOther(request, `${back}?email_error=handle`);
  const ip = clientIp(request);
  if (
    !(await isWithinLimits(env.SIGNIN_RATE_LIMIT, [`ip:${ip ?? 'unknown'}`, `email:${email.data}`]))
  )
    return seeOther(request, `${back}?email_error=rate`);
  const browserSecret = randomSecret();
  try {
    await requestMagicLink(env, config, {
      email: email.data,
      handle: handle?.data ?? null,
      origin: siteOrigin(request).origin,
      browserSecret,
      ip,
      now: Date.now(),
    });
  } catch (error: unknown) {
    log.error('magic link not sent', { error });
    return seeOther(request, `${back}?email_error=send`);
  }
  return seeOther(request, `${back}?email_sent=1`, [
    setCookie(PREAUTH_COOKIE, browserSecret, MAGIC_LINK_SECONDS),
  ]);
}
