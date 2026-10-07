import { env } from 'cloudflare:workers';

import { recordAudit } from '@beanstalk/shared-identity/audit';
import { SESSION_COOKIE, clearCookie } from '@beanstalk/shared-identity/cookies';
import { clientIp } from '@beanstalk/shared-identity/request-context';
import {
  getWebSession,
  revokeAllSessions,
  revokeSession,
} from '@beanstalk/shared-identity/sessions';

import { seeOther, signedInForm } from '../../../src/auth/http';

/** Signs out this browser, or every browser (`everywhere=1`). */
export async function POST(request: Request): Promise<Response> {
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const { session, form } = checked;
  const now = Date.now();
  const everywhere = form.get('everywhere') === '1';
  if (everywhere) await revokeAllSessions(env, session.user.id, now);
  else await revokeSession(env, session.sessionHash, now);
  await recordAudit(
    env,
    {
      action: everywhere ? 'session.signout_all' : 'session.signout',
      actorUserId: session.user.id,
      ip: clientIp(request),
    },
    now,
  );
  return seeOther(request, '/', [clearCookie(SESSION_COOKIE)]);
}
