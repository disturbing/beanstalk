import { env } from 'cloudflare:workers';

import { clientIp } from '@gitstalk/shared-identity/request-context';
import { getWebSession } from '@gitstalk/shared-identity/sessions';
import { revokeUserToken } from '@gitstalk/shared-identity/user-tokens';

import { seeOther, signedInForm } from '../../../../src/auth/http';

/** Revokes one of the signed-in person's tokens (audited). */
export async function POST(request: Request): Promise<Response> {
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const tokenId = checked.form.get('token');
  if (typeof tokenId === 'string')
    await revokeUserToken(env, { userId: checked.session.user.id, tokenId, ip: clientIp(request) });
  return seeOther(request, '/settings/tokens?revoked=1');
}
