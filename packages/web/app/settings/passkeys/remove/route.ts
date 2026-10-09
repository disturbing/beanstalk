import { env } from 'cloudflare:workers';

import { removePasskey } from '@beanstalk/shared-identity/passkeys';
import { clientIp } from '@beanstalk/shared-identity/request-context';
import { getWebSession } from '@beanstalk/shared-identity/sessions';

import { seeOther, signedInForm } from '../../../../src/auth/http';

/** Removes one passkey; never the last way to sign in. */
export async function POST(request: Request): Promise<Response> {
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const passkeyId = checked.form.get('passkey');
  if (typeof passkeyId !== 'string') return seeOther(request, '/settings');
  const outcome = await removePasskey(env, {
    user: checked.session.user,
    passkeyId,
    ip: clientIp(request),
    now: Date.now(),
  });
  return seeOther(request, `/settings/passkeys?passkey=${outcome}`);
}
